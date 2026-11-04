// Battle state machine ported from the original BattleSys / CharacterTurn / DeBuffTurn / MonsterTurn.
import { COLS, CRACK, HEAL, ROWS, canMatch, emptyMeta, makeRng, metaAt, newBoard, origRow, pickGem, removeAndFill, type Board, type FallMove, type Match, type Meta, type Rng, type Weights } from './board.ts';
import { comboDamage, matchGemDamage, type TypeRel } from './formulas.ts';
import { runEnemySkill, runAllySkill, type SkillTarget } from './skills.ts';
import { emptyPerks, shapeBonus, shapesOf, type PerkFx } from './perks.ts';

export * from './formulas.ts';

export interface AbilityDef {
  n: string;
  cd: number;
  t: number; // ability type id (201..230 for enemies)
  p: string[];
  r: number; // chance (0-100) to be rolled
  c: number; // uses (0 = unlimited)
  h: number; // only rolled when enemy HP% <= h
  icon: string | null;
}

export interface UnitAbility {
  n: string;
  d: string;
  cd: number;
  t: number; // 101..133
  p: string[];
  icon: string | null;
}

export interface UnitStats {
  uid: number;
  name: string;
  colors: number[];
  hp: number;
  atk: number; // (min+max)/2 truncated, as in the original
  heal: number;
  isDoctor: boolean;
  icon: string | null;
  abilities?: UnitAbility[];
}

export interface EnemyDef {
  hp: number;
  atk: number;
  cd: number;
  def: number;
  color: number;
  name: string;
  img: string | null;
  w: number;
  h: number;
  x: number;
  y: number;
  drops: DropRow[];
  dropMulti?: boolean; // the card's rule: one dice over cumulative chances ("multi") instead of each row in turn ("single")
  abilities?: AbilityDef[];
}

/** A drop card row: [type, id, chance %, follow-on card]. Types: 1 unit or item id, 4 random fragment, 9 outfit id. */
export type DropRow = [type: number, id: number, chance: number, next?: DropCard];
export interface DropCard {
  m: number; // 1 = "multi" rule
  r: DropRow[];
}

/** A timed status effect. Field meaning depends on the kind, see skills.ts. */
export interface Fx {
  turns: number;
  locked: boolean; // negative turns in the data = never expires
  v: number;
  w: number;
  c: number;
  t: number;
  x: number;
  acc: number;
  accC?: Record<number, number>; // reflect: accumulated damage per colour of the hit (for colour-hurt perks)
  icon: string | null;
}

export function mkFx(turns: number, o: Partial<Fx> = {}): Fx {
  return { turns, locked: turns < 0, v: 0, w: 0, c: 0, t: 0, x: 0, acc: 0, icon: null, ...o };
}

export interface EnemyAbil {
  def: AbilityDef;
  now: number;
  max: number;
  uses: number;
}

export type EnemyFxKey = 'stun' | 'poison' | 'bomb' | 'tap' | 'immune' | 'shadow' | 'reflect' | 'shield';
export type PlayerFxKey = 'poison' | 'bomb' | 'tap' | 'move' | 'moveBonus' | 'maxhp';

export interface Enemy extends EnemyDef {
  maxHp: number;
  curCd: number; // countdown of the currently rolled ability (shown to the player)
  alive: boolean;
  abil: EnemyAbil[];
  cur: number;
  fx: Partial<Record<EnemyFxKey, Fx>>;
  abilities: AbilityDef[];
}

export interface UnitState {
  now: number; // charge; an ability is ready when now >= its own cooldown
  max: number; // the longest cooldown (what the charge counts up to)
  maxes: number[]; // cooldown of each ability, in order (the Doctor has two, allies one)
  stun?: Fx;
}

export type TypeRelT = TypeRel;

export type Ev =
  | { k: 'text'; target: 'player' | 'enemy' | 'unit'; idx: number; text: string; color?: string }
  | { k: 'ability'; enemy: number; name: string; icon: string | null }
  | { k: 'hurtPlayer'; amount: number; enemy?: number }
  | { k: 'healPlayer'; amount: number }
  | { k: 'hurtEnemy'; enemy: number; amount: number; color: number }
  | { k: 'healEnemy'; enemy: number; amount: number }
  | { k: 'kill'; enemy: number }
  | { k: 'spawn'; enemy: number }
  | { k: 'board'; kind: 'sync' | 'remove'; cells?: [number, number][] }
  | { k: 'unit'; unit: number };

export interface Hit {
  unit: number;
  color: number;
  enemy: number;
  amount: number;
  all: boolean;
  mult: number;
}

export interface TurnResult {
  hits: Hit[];
  heal: number;
  combo: number;
  enemyAttacks: { enemy: number; amount: number }[];
  playerHpBefore: number;
  playerHpAfter: number;
  killed: number[];
  waveCleared: boolean;
  victory: boolean;
  defeat: boolean;
  events: Ev[];
}

export interface BattleArgs {
  dualSame: number;
  dualDiff: number;
}

/** Preset obstacle cells for a wave: [row, col, obstacleId]. */
export type Grid = [number, number, number][];

export interface BattleOpts {
  board?: Board;
  weights?: Weights;
  rng?: Rng;
  spawnDefs?: Record<number, EnemyDef>;
  grids?: (Grid | null | undefined)[]; // per wave
  timeLimit?: number; // seconds for the whole level (0 / undefined = untimed)
  tutorial?: boolean; // scripted tutorial mode: enemies hold their fire and debuffs are off until it is closed
  presets?: Record<string, PresetBoard>; // named boards the story can switch on ("turnonloadgemdata")
  perks?: PerkFx; // the player's chosen perks
  otb?: OtbFx; // the One Turn Buff for this battle
}

/** A One Turn Buff as fractions (0.05 = +5%). It is applied before perks, as in LevelScene. */
export interface OtbFx {
  atk?: number;
  heal?: number;
  hp?: number;
}

/** A scripted gem layout (testGemdata.txt): `gems[row][col]`, row 0 at the bottom. Refills keep feeding each column. */
export interface PresetBoard {
  rows: number;
  cols: number;
  gems: number[][];
}

const DEFAULT_WEIGHTS: Weights = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
export const BASE_MOVE_MS = 5000;

export class Battle {
  team: UnitStats[];
  unitSt: UnitState[];
  maxHp: number;
  hp: number;
  baseHeal: number;
  enemies: Enemy[] = [];
  waveIndex = 0;
  turn = 0;
  rel: TypeRel;
  args: BattleArgs;
  waves: EnemyDef[][];
  target = -1;
  board: Board;
  meta: Meta;
  weights: Weights;
  rng: Rng;
  spawnDefs: Record<number, EnemyDef>;
  grids: (Grid | null | undefined)[];
  /** Level-wide time budget in ms (0 = untimed). Runs from the first wave; running out is a defeat. */
  timeLimitMs = 0;
  timeLeftMs = 0;
  pFx: Partial<Record<PlayerFxKey, Fx>> = {};
  extraDrop: { color: number; left: number } | null = null;
  tutorialMode = false;
  presets: Record<string, PresetBoard> = {};
  perks: PerkFx = emptyPerks();
  private preset: { def: PresetBoard; next: number[] } | null = null; // per-column read position
  /** A scripted drag: the player may only move `start` along the path to `end`. */
  tut: { start: [number, number]; end: [number, number]; board: Board; meta: Meta } | null = null;
  tutDone = false; // the last scripted drag was completed ("checkgettoend")
  /** events produced while a turn or ability is being resolved */
  evs: Ev[] = [];
  private killedNow: number[] = [];
  private baseMaxHp: number;

  constructor(team: UnitStats[], waves: EnemyDef[][], rel: TypeRel, args: BattleArgs, opts: BattleOpts = {}) {
    const pk = (this.perks = opts.perks ?? emptyPerks());
    const ob = opts.otb ?? {};
    // One Turn Buff: team attack +% (each unit, truncated), before perks
    if (ob.atk) team = team.map((u) => ({ ...u, atk: Math.trunc(u.atk * (1 + ob.atk!)) }));
    // perks: team attack +%, drop-rate points on colours the level already drops
    this.team = pk.atkPct ? team.map((u) => ({ ...u, atk: Math.trunc(u.atk * (1 + pk.atkPct)) })) : team;
    team = this.team;
    this.rel = rel;
    this.args = args;
    this.waves = waves;
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
    if (pk.drop.some((d) => d > 0)) this.weights = this.weights.map(([c, w]) => [c, w + (pk.drop[c] ?? 0)] as [number, number]);
    this.rng = opts.rng ?? makeRng(1);
    this.spawnDefs = opts.spawnDefs ?? {};
    this.grids = opts.grids ?? [];
    this.tutorialMode = !!opts.tutorial;
    this.presets = opts.presets ?? {};
    this.timeLimitMs = Math.max(0, (opts.timeLimit ?? 0) * 1000);
    this.timeLeftMs = this.timeLimitMs;
    this.board = opts.board ?? newBoard(this.weights, this.rng);
    this.meta = emptyMeta();
    // One Turn Buff: team max HP +%; perks then work from the raised total
    const teamHp0 = team.reduce((s, u) => s + u.hp, 0);
    const teamHp = ob.hp ? Math.trunc(teamHp0 * (1 + ob.hp)) : teamHp0;
    this.baseMaxHp = teamHp + pk.hpPcts.reduce((s, p) => s + Math.trunc(teamHp * p), 0);
    this.maxHp = this.baseMaxHp;
    this.hp = this.maxHp;
    const teamHeal0 = team.reduce((s, u) => s + u.heal, 0);
    const teamHeal = ob.heal ? Math.trunc(teamHeal0 * (1 + ob.heal)) : teamHeal0;
    this.baseHeal = teamHeal + pk.healPcts.reduce((s, p) => s + Math.trunc(teamHeal * p), 0);
    this.unitSt = team.map((u) => {
      // perk: the Doctor's cooldowns are a fraction shorter. The Doctor has two abilities that share one charge counter.
      const maxes = (u.abilities ?? []).map((a) => (a.cd > 0 && u.isDoctor ? Math.max(1, a.cd + Math.trunc(a.cd * pk.doctorCd)) : a.cd));
      return { now: 0, max: Math.max(0, ...maxes), maxes };
    });
    this.loadWave(0);
  }

  // ------------------------------------------------------------ helpers used by skills
  rand(): number {
    return this.rng();
  }

  randInt(n: number): number {
    return Math.min(n - 1, Math.floor(this.rng() * n));
  }

  emit(e: Ev): void {
    this.evs.push(e);
  }

  get aliveEnemies(): number[] {
    return this.enemies.flatMap((e, i) => (e.alive ? [i] : []));
  }

  private defaultTarget(): number {
    if (this.target >= 0 && this.enemies[this.target]?.alive) return this.target;
    const a = this.aliveEnemies;
    return a.length ? a[a.length - 1] : -1; // original: last enemy in the list
  }

  /** Enemy picked by the player, else random (original ally-skill targeting). */
  pickTarget(): number {
    if (this.target >= 0 && this.enemies[this.target]?.alive) return this.target;
    const a = this.aliveEnemies;
    return a.length ? a[this.randInt(a.length)] : -1;
  }

  makeEnemy(d: EnemyDef): Enemy {
    const abilities = d.abilities ?? [];
    const abil: EnemyAbil[] = abilities.map((a) => ({ def: a, now: a.cd, max: a.cd, uses: a.c > 0 ? a.c : 999 }));
    // the plain attack is an implicit last ability that always passes its roll
    const atk: AbilityDef = { n: 'Attack', cd: d.cd, t: 0, p: [], r: 100, c: 0, h: 100, icon: null };
    abil.push({ def: atk, now: d.cd, max: d.cd, uses: 999 });
    const e: Enemy = { ...d, abilities, maxHp: d.hp, curCd: d.cd, alive: true, abil, cur: abil.length - 1, fx: {} };
    this.reroll(e);
    return e;
  }

  reroll(e: Enemy): void {
    const hpPct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
    for (let i = 0; i < e.abil.length; i++) {
      const a = e.abil[i];
      const roll = this.rng() * 100;
      if (a.def.r > roll && a.uses > 0 && a.def.h / 100 >= hpPct) {
        e.cur = i;
        break;
      }
    }
    e.curCd = e.abil[e.cur]?.now ?? e.cd;
  }

  loadWave(i: number): void {
    this.waveIndex = i;
    this.target = -1;
    this.enemies = this.waves[i].map((d) => this.makeEnemy(d));
    this.applyGrid(true);
    // perk "Wave Enhance": every gem of the chosen colour is boosted when a wave starts
    for (let col = 1; col <= 6; col++) {
      const pct = this.perks.wave[col];
      if (pct > 0) for (const [r, c] of this.cellsWhere((r, c) => this.board[r][c] === col)) this.metaOf(r, c).dbl = pct;
    }
  }

  /** Place this wave's crack obstacles. Cracks from the previous wave turn back into normal gems. */
  applyGrid(revertOld: boolean): void {
    if (revertOld) {
      for (let r = 0; r < this.board.length; r++) {
        for (let c = 0; c < this.board[r].length; c++) {
          if (this.meta[r][c]?.crack) {
            this.board[r][c] = 1 + this.randInt(6); // original: a random plain colour 1-6
            this.meta[r][c] = null;
          }
        }
      }
    }
    // cells are [col, row, obstacle] with row 0 at the bottom (the original's match_grid[col][row])
    for (const [c, rowData, v] of this.grids[this.waveIndex] ?? []) {
      const r = origRow(rowData);
      if (!this.board[r] || this.board[r][c] === undefined) continue;
      this.board[r][c] = CRACK;
      const g = metaAt(this.meta, r, c);
      g.lock = 6;
      g.lockTurns = 0;
      g.crack = v;
      g.dbl = g.sub = 0;
      g.bomb = null;
      g.blind = false;
    }
  }

  nextWave(): boolean {
    if (this.waveIndex >= this.waves.length - 1) return false;
    this.loadWave(this.waveIndex + 1);
    return true;
  }

  spawn(def: EnemyDef, near: Enemy | null): number {
    if (this.enemies.filter((e) => e.alive).length >= 3) return -1;
    const placed = this.enemies.filter((e) => e.alive).map((e) => e.x);
    const base = near?.x ?? 0;
    let x = base + 200;
    if (placed.some((p) => Math.abs(p - x) < 1)) x = base - 200;
    if (placed.some((p) => Math.abs(p - x) < 1)) x = 0;
    const e = this.makeEnemy({ ...def, x, y: near?.y ?? def.y });
    this.enemies.push(e);
    const idx = this.enemies.length - 1;
    this.emit({ k: 'spawn', enemy: idx });
    return idx;
  }

  hurtEnemy(i: number, amount: number, color: number): void {
    const e = this.enemies[i];
    if (!e || !e.alive) return;
    this.emit({ k: 'hurtEnemy', enemy: i, amount, color });
    if (e.fx.shadow) return; // shadows take no damage
    e.hp -= amount;
    if (e.hp <= 0) this.killEnemy(i);
  }

  healEnemy(i: number, amount: number): void {
    const e = this.enemies[i];
    if (!e || !e.alive || amount <= 0) return;
    e.hp = Math.min(e.maxHp, e.hp + amount);
    this.emit({ k: 'healEnemy', enemy: i, amount });
  }

  killEnemy(i: number): void {
    const e = this.enemies[i];
    if (!e.alive) return;
    e.hp = 0;
    e.alive = false;
    this.killedNow.push(i);
    this.emit({ k: 'kill', enemy: i });
    this.chargeDoctor(this.perks.doctorKill);
  }

  /** Perk: give the Doctor's ability extra charge. */
  chargeDoctor(n: number): void {
    if (n <= 0) return;
    const d = this.team.findIndex((u) => u.isDoctor);
    const s = this.unitSt[d];
    if (s && s.max > 0) s.now = Math.min(s.max, s.now + n);
  }

  /** Damage an enemy attack does to the player after perks (colour resistance, low-HP resistance). */
  perkHurt(dmg: number, enemyColor: number): number {
    const pk = this.perks;
    let extra = Math.trunc(dmg * (pk.colorHurt[enemyColor] ?? 0));
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    for (const [th, pct] of pk.hurtBelow) if (th >= frac) extra += Math.trunc(dmg * pct);
    return Math.max(0, dmg + extra);
  }

  /** Player damage to an enemy: type rate (plus perk colour-to-colour rate), defence (minus perk penetration). */
  damageTo(raw: number, att: number, e: Enemy): number {
    const pk = this.perks;
    let rate = this.rel[att]?.[e.color] ?? 1;
    for (const [from, to, add] of pk.c2c) if (from === att && to === e.color) rate += add;
    const def = e.def + Math.trunc(e.def * (pk.pen[e.color] ?? 0));
    const n = Math.trunc(raw * rate - def);
    return n <= 0 ? 1 : n;
  }

  hurtPlayer(amount: number, enemy?: number): void {
    if (amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.emit({ k: 'hurtPlayer', amount, enemy });
  }

  healPlayer(amount: number): void {
    if (amount <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.emit({ k: 'healPlayer', amount: this.hp - before });
  }

  /** Immune / shadow enemies cannot receive new negative statuses. */
  canDebuff(e: Enemy): boolean {
    return !e.fx.immune && !e.fx.shadow;
  }

  clearEnemyDebuffs(e: Enemy): void {
    delete e.fx.poison;
    delete e.fx.stun;
    delete e.fx.bomb;
    delete e.fx.tap;
  }

  get timed(): boolean {
    return this.timeLimitMs > 0;
  }

  get timeUp(): boolean {
    return this.timed && this.timeLeftMs <= 0;
  }

  /** Advance the level clock (the view calls this with real elapsed time). */
  tickTime(ms: number): void {
    if (this.timed) this.timeLeftMs = Math.max(0, this.timeLeftMs - ms);
  }

  /** "Increase Time Limit" ability: add seconds to the budget. */
  addTime(seconds: number): void {
    if (!this.timed) return;
    this.timeLimitMs += seconds * 1000;
    this.timeLeftMs += seconds * 1000;
  }

  get moveMs(): number {
    let s = BASE_MOVE_MS / 1000 + this.perks.moveTime;
    if (this.pFx.move) s -= this.pFx.move.v;
    if (this.pFx.moveBonus) s += this.pFx.moveBonus.v;
    return Math.max(1, s) * 1000;
  }

  get colorsOnBoard(): number[] {
    const s = new Set<number>();
    for (const row of this.board) for (const c of row) if (c > 0 && c <= 6) s.add(c);
    return [...s];
  }

  // ------------------------------------------------------------ board operations
  /** Remove matched gems (records their power boosts first) and refill the board. */
  removeMatches(ms: Match[]): FallMove[] {
    for (const m of ms) {
      let p = 1;
      for (const [r, c] of m.cells) {
        const g = this.meta[r][c];
        if (g) p += g.dbl - g.sub;
      }
      m.power = Math.max(0, p);
    }
    return removeAndFill(this.board, ms, this.weights, this.rng, this.meta, (c) => this.nextGem(c));
  }

  nextGem(col = 0): number {
    if (this.extraDrop && this.extraDrop.left > 0) {
      this.extraDrop.left--;
      return this.extraDrop.color;
    }
    if (this.preset) {
      // a scripted board keeps feeding each column from its own queue, wrapping at the bottom of the definition
      const { def, next } = this.preset;
      if (col < def.cols) {
        const key = def.gems[next[col] % def.rows]?.[col];
        next[col]++;
        if (key) return key;
      }
    }
    return pickGem(this.weights, this.rng);
  }

  // ------------------------------------------------------------ tutorial scripting
  /** "turnonloadgemdata": rebuild the board from a named layout and keep refilling from it. */
  loadPreset(name: string): boolean {
    const def = this.presets[name];
    if (!def) return false;
    const next = Array<number>(COLS).fill(0);
    for (let c = 0; c < COLS && c < def.cols; c++) {
      for (let row = 0; row < ROWS; row++) {
        this.board[origRow(row)][c] = def.gems[row % def.rows]?.[c] ?? 1;
        next[c]++;
      }
    }
    this.meta = emptyMeta();
    this.preset = { def, next };
    this.tut = null;
    this.applyGrid(false);
    this.emit({ k: 'board', kind: 'sync' });
    return true;
  }

  /**
   * "tutorialgem col,row,col,row": only the gem at the start may be picked up, and only along the path (first across
   * the columns on the start row, then along the end column). Every other gem is frozen (not pickable or swappable).
   */
  openTutorialGem(c1: number, row1: number, c2: number, row2: number): boolean {
    const r1 = origRow(row1);
    const r2 = origRow(row2);
    if (!this.board[r1]?.[c1] || !this.board[r2]?.[c2] || (c1 === c2 && r1 === r2)) return false;
    for (const rw of this.meta) for (const g of rw) if (g?.tut) g.tut = false;
    const path: [number, number][] = [];
    let c = c1;
    let r = r1;
    while (c !== c2) {
      c += c < c2 ? 1 : -1;
      path.push([r, c]);
    }
    while (r !== r2) {
      r += r < r2 ? 1 : -1;
      path.push([r, c]);
    }
    for (const [pr, pc] of path) metaAt(this.meta, pr, pc).lock = 4; // can be swapped, cannot be picked
    for (let rr = 0; rr < ROWS; rr++) {
      for (let cc = 0; cc < COLS; cc++) {
        if (rr === r1 && cc === c1) continue;
        const g = metaAt(this.meta, rr, cc);
        if (g.lock === 0) g.lock = 5; // frozen
      }
    }
    metaAt(this.meta, r1, c1).tut = true;
    this.tut = { start: [r1, c1], end: [r2, c2], board: this.board.map((row) => [...row]), meta: this.meta.map((row) => [...row]) };
    this.tutDone = false;
    return true;
  }

  get tutorialOpen(): boolean {
    return this.tut !== null;
  }

  /** After the drag: did the gem reach the end cell? Success frees the board; failure puts everything back. */
  tutorialFinish(): boolean {
    const t = this.tut;
    if (!t) return true;
    const at = this.meta[t.end[0]]?.[t.end[1]];
    if (at?.tut) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const g = this.meta[r][c];
          if (!g) continue;
          g.tut = false;
          if (g.lock !== 6) g.lock = 0; // GMCureAllGemState: everything back to normal (cracks stay)
        }
      }
      this.tut = null;
      this.tutDone = true;
      return true;
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.board[r][c] = t.board[r][c];
        this.meta[r][c] = t.meta[r][c];
      }
    }
    return false;
  }

  /** "assignskillcd idx n": add n to a unit's skill charge (an index past the team means everyone). */
  assignSkillCd(idx: number, n: number): void {
    const apply = (i: number) => {
      const s = this.unitSt[i];
      if (s && s.max > 0) s.now = Math.min(s.max, s.now + n);
    };
    if (idx < this.team.length) apply(idx);
    else this.team.forEach((_, i) => apply(i));
    this.emit({ k: 'unit', unit: Math.min(idx, this.team.length - 1) });
  }

  /** "changeallgemstate state turns": put every gem into a lock state (cracks excluded). */
  changeAllGemState(state: number, turns: number): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.meta[r][c]?.lock === 6) continue;
        const g = metaAt(this.meta, r, c);
        g.lock = state;
        g.lockTurns = turns;
      }
    }
    this.emit({ k: 'board', kind: 'sync' });
  }

  /** "callmonsterattackbyindex": force one enemy to attack right now (scripted tutorial hit). */
  callMonsterAttack(i: number): Ev[] {
    this.evs = [];
    const e = this.enemies[i];
    if (e?.alive) this.hurtPlayer(e.atk, i);
    return this.evs;
  }

  /** "closetutorialmode": enemies start acting normally. */
  closeTutorialMode(): void {
    this.tutorialMode = false;
  }

  /** Remove arbitrary cells (abilities) and refill. Emits a 'remove' board event. */
  removeCells(cells: [number, number][]): void {
    if (!cells.length) return;
    removeAndFill(this.board, [{ color: 0, cells }], this.weights, this.rng, this.meta, (c) => this.nextGem(c));
    this.emit({ k: 'board', kind: 'remove', cells });
  }

  convertColor(from: number, to: number): void {
    if (from === to || from <= 0 || to <= 0) return;
    let any = false;
    for (let r = 0; r < this.board.length; r++) {
      for (let c = 0; c < this.board[r].length; c++) {
        if (this.board[r][c] === from) {
          this.board[r][c] = to;
          any = true;
        }
      }
    }
    if (any) this.emit({ k: 'board', kind: 'sync' });
  }

  resetBoard(): void {
    this.board = newBoard(this.weights, this.rng);
    this.meta = emptyMeta();
    this.applyGrid(false); // cracks belong to the wave, so they survive a reset
    this.emit({ k: 'board', kind: 'sync' });
  }

  /**
   * Carry on after a defeat (the original's "Continue" after game over): full HP, a fresh board, the team's
   * harmful effects cleared and, in a timed level, a full clock. Enemies and the wave stay as they were.
   */
  continueAfterDefeat(): void {
    this.hp = this.maxHp;
    for (const k of ['poison', 'bomb', 'tap', 'move'] as PlayerFxKey[]) delete this.pFx[k];
    for (const u of this.unitSt) delete u.stun;
    this.timeLeftMs = this.timeLimitMs;
    this.resetBoard();
  }

  // ------------------------------------------------------------ turn resolution
  private tickStatuses(): void {
    const dec = (f?: Fx) => {
      if (f && !f.locked) f.turns--;
    };
    for (const k of Object.keys(this.pFx) as PlayerFxKey[]) dec(this.pFx[k]);
    for (const u of this.unitSt) dec(u.stun);
    for (const e of this.enemies) for (const k of Object.keys(e.fx) as EnemyFxKey[]) dec(e.fx[k]);
    for (let r = 0; r < this.meta.length; r++) {
      for (let c = 0; c < this.meta[r].length; c++) {
        const g = this.meta[r][c];
        if (!g) continue;
        if (g.bomb) g.bomb.turns--;
        if (g.lock > 0 && g.lockTurns > 0) {
          g.lockTurns--;
          if (g.lockTurns <= 0) g.lock = 0;
        }
      }
    }
  }

  private removeExpired(): void {
    const purge = (o: Partial<Record<string, Fx>>) => {
      for (const k of Object.keys(o)) {
        const f = o[k];
        if (f && !f.locked && f.turns <= 0) delete o[k];
      }
    };
    purge(this.pFx);
    this.unitSt.forEach((u) => {
      if (u.stun && !u.stun.locked && u.stun.turns <= 0) delete u.stun;
    });
    this.enemies.forEach((e) => purge(e.fx));
    if (!this.pFx.maxhp && this.maxHp !== this.baseMaxHp) {
      this.maxHp = this.baseMaxHp;
      this.hp = Math.min(this.hp, this.maxHp);
    }
  }

  isStunnedUnit(i: number): boolean {
    const s = this.unitSt[i]?.stun;
    return !!s && (s.turns >= 0 || s.locked);
  }

  private isStunnedEnemy(e: Enemy): boolean {
    const s = e.fx.stun;
    return !!s && (s.turns >= 0 || s.locked);
  }

  /** Apply the player's resolved matches (all cascade steps of one move) and run the whole turn. */
  resolveMove(matches: Match[]): TurnResult {
    this.evs = [];
    this.killedNow = [];
    const combo = matches.length;
    const hpBefore = this.hp;
    const res: TurnResult = {
      hits: [], heal: 0, combo, enemyAttacks: [], playerHpBefore: hpBefore, playerHpAfter: hpBefore,
      killed: [], waveCleared: false, victory: false, defeat: false, events: this.evs,
    };
    const finish = (): TurnResult => {
      res.killed = [...this.killedNow];
      res.playerHpAfter = this.hp;
      res.defeat = this.hp <= 0;
      return res;
    };

    this.tickStatuses();

    // ---- character turn
    const acc = new Map<string, { unit: number; color: number; total: number; all: boolean }>();
    let healSum = 0;
    for (const m of matches) {
      const count = m.cells.length;
      const power = m.power ?? 1;
      if (m.color === HEAL) {
        healSum += Math.trunc(matchGemDamage(this.baseHeal * power, count));
        continue;
      }
      this.team.forEach((u, ui) => {
        if (this.isStunnedUnit(ui)) return;
        u.colors.forEach((c, slot) => {
          if (c !== m.color) return;
          let base = u.atk * power;
          if (slot !== 0) base *= u.colors[0] !== c ? this.args.dualDiff : this.args.dualSame;
          const key = `${ui}:${slot}`;
          let a = acc.get(key);
          if (!a) acc.set(key, (a = { unit: ui, color: c, total: 0, all: false }));
          a.total += Math.trunc(matchGemDamage(base, count));
          if (count >= 5) a.all = true;
        });
      });
    }
    // perks look at the whole move: shapes made, gems matched per colour, the HP the player had when it began
    const pk = this.perks;
    const made = shapesOf(matches);
    const gemsOf: number[] = new Array(8).fill(0);
    for (const m of matches) if (m.color !== HEAL) gemsOf[m.color] += m.cells.length;
    const hpFrac = this.maxHp > 0 ? hpBefore / this.maxHp : 1;
    for (const a of acc.values()) {
      let raw = comboDamage(a.total, combo);
      let extra = Math.trunc(raw * (pk.colorDmg[a.color] ?? 0));
      for (const [th, pct] of pk.dmgBelow) if (th >= hpFrac) extra += Math.trunc(raw * pct);
      for (const [n, pct] of pk.comboMaster) if (combo >= n) extra += Math.trunc(raw * pct);
      for (const [col, n, pct] of pk.matchNum) if (col === a.color && gemsOf[col] >= n) extra += Math.trunc(raw * pct);
      extra += Math.trunc(raw * shapeBonus(pk.shapeDmg, made));
      extra += Math.trunc(raw * pk.leechAtk);
      raw += extra;
      const targets = a.all ? this.aliveEnemies : [this.defaultTarget()];
      for (const ti of targets) {
        if (ti < 0) continue;
        const e = this.enemies[ti];
        let amount = this.damageTo(raw, a.color, e);
        const sh = e.fx.shield;
        if (sh && (sh.turns >= 0 || sh.locked)) {
          if (combo <= sh.c) amount = -Math.trunc(amount * sh.v); // shield turns the hit into healing
        }
        const rf = e.fx.reflect;
        if (rf && amount > 0 && (rf.turns >= 0 || rf.locked) && (rf.c === 0 || rf.c === a.color)) {
          const back = Math.trunc(amount * rf.v);
          rf.acc += back;
          (rf.accC ??= {})[a.color] = (rf.accC[a.color] ?? 0) + back;
          amount = Math.max(1, amount - Math.trunc(amount * rf.w));
        }
        res.hits.push({ unit: a.unit, color: a.color, enemy: ti, amount, all: a.all, mult: this.rel[a.color]?.[e.color] ?? 1 });
      }
    }
    for (const h of res.hits) {
      this.emit({ k: 'unit', unit: h.unit });
      if (h.amount < 0) this.healEnemy(h.enemy, -h.amount);
      else this.hurtEnemy(h.enemy, h.amount, h.color);
    }
    if (healSum > 0) {
      res.heal = comboDamage(healSum, combo);
      this.healPlayer(res.heal);
    }
    // perk "Hit Heal": HP for every attack that lands
    if (pk.vampire > 0 && acc.size > 0) this.healPlayer(acc.size * pk.vampire);
    // ability charge: allies +1 per move with a combo, the Doctor +combo (+ perk)
    if (combo >= 1) {
      this.team.forEach((u, i) => {
        const s = this.unitSt[i];
        if (s.max > 0) s.now = Math.min(s.max, s.now + (u.isDoctor ? combo + pk.doctorCombo : 1));
      });
    }
    this.perkHeal(combo, made);

    if (this.aliveEnemies.length === 0) {
      res.waveCleared = true;
      res.victory = this.waveIndex >= this.waves.length - 1;
      return finish();
    }

    // tutorial mode (original BattleSys flow): no debuff turn, and enemies do not count down until the script ends it
    if (this.tutorialMode) {
      this.turn++;
      return finish();
    }

    // ---- debuff turn
    this.debuffPhase();
    if (this.hp <= 0) return finish();
    if (this.aliveEnemies.length === 0) {
      res.waveCleared = true;
      res.victory = this.waveIndex >= this.waves.length - 1;
      return finish();
    }
    this.removeExpired();

    // ---- monster turn
    this.turn++;
    for (const e of [...this.enemies]) {
      if (!e.alive || this.hp <= 0) continue;
      if (this.isStunnedEnemy(e)) continue;
      const a = e.abil[e.cur];
      a.now = Math.max(0, a.now - 1);
      e.curCd = a.now;
      if (a.now > 0) continue;
      this.fireEnemy(e, res);
    }
    return finish();
  }

  /** Perk healing after the character turn (original CharacterTurn.PerkHeal): low-HP heal, auto heal, shape cure, Stalwart. */
  private perkHeal(combo: number, made: Set<string>): void {
    const pk = this.perks;
    if (this.hp >= this.maxHp || this.hp <= 0) return;
    const frac = this.hp / this.maxHp;
    let h = 0;
    for (const [th, pct] of pk.healBelow) if (th >= frac) h += Math.trunc(this.maxHp * pct);
    if (combo >= 1 && pk.autoHeal) h += Math.trunc(this.maxHp * pk.autoHeal);
    for (const k of made) if (pk.shapeCure[k]) h += Math.trunc(this.maxHp * pk.shapeCure[k]);
    if (pk.leechHp > 0) h += Math.trunc(this.maxHp * pk.leechHp);
    if (h > 0) this.healPlayer(h);
  }

  /** An enemy's countdown reached zero: it attacks or casts its current ability, then rolls the next one. */
  private fireEnemy(e: Enemy, res: TurnResult): void {
    const a = e.abil[e.cur];
    a.now = a.max;
    a.uses--;
    const idx = this.enemies.indexOf(e);
    if (a.def.t === 0) {
      const dmg = this.perkHurt(e.atk, e.color);
      res.enemyAttacks.push({ enemy: idx, amount: dmg });
      this.hurtPlayer(dmg, idx);
      this.chargeDoctor(this.perks.doctorHurt);
    } else {
      this.emit({ k: 'ability', enemy: idx, name: a.def.n, icon: a.def.icon });
      runEnemySkill(this, e, idx, a.def);
    }
    this.reroll(e);
  }

  /**
   * The original's CheckEnemyAttack state (WaveStart -> 18): at the start of a wave, any enemy whose current ability
   * already has a countdown of 0 acts before the player's first move. No turn passes and nothing counts down; stunned
   * enemies hold. A story that is playing postpones this until it ends, or until `checkenemyattack,0` calls for it.
   */
  readyEnemyPhase(): TurnResult {
    this.evs = [];
    this.killedNow = [];
    const res: TurnResult = {
      hits: [], heal: 0, combo: 0, enemyAttacks: [], playerHpBefore: this.hp, playerHpAfter: this.hp,
      killed: [], waveCleared: false, victory: false, defeat: false, events: this.evs,
    };
    for (const e of [...this.enemies]) {
      if (!e.alive || this.hp <= 0 || this.isStunnedEnemy(e)) continue;
      if (e.abil[e.cur].now === 0) this.fireEnemy(e, res);
    }
    res.killed = [...this.killedNow];
    res.playerHpAfter = this.hp;
    res.defeat = this.hp <= 0;
    return res;
  }

  /** True when some living, unstunned enemy is ready to act right now. */
  get enemiesReady(): boolean {
    return this.enemies.some((e) => e.alive && !this.isStunnedEnemy(e) && e.abil[e.cur].now === 0);
  }

  private debuffPhase(): void {
    const p = this.pFx;
    const maxHp = this.maxHp;
    const pk = this.perks;
    if (p.poison) this.hurtPlayer(Math.trunc(maxHp * Math.max(0, p.poison.v + pk.poison)));
    if (p.bomb && p.bomb.turns === 0) this.hurtPlayer(p.bomb.v + Math.trunc(p.bomb.v * pk.bomb));
    if (p.tap && p.tap.turns === 0) {
      this.hurtPlayer(p.tap.v);
      for (const i of this.aliveEnemies) this.healEnemy(i, p.tap.v);
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      let dmg = 0;
      let hurt = false;
      if (e.fx.poison) {
        dmg += Math.trunc(e.maxHp * e.fx.poison.v);
        hurt = true;
      }
      if (e.fx.bomb && e.fx.bomb.turns === 0) {
        dmg += e.fx.bomb.v;
        hurt = true;
      }
      if (e.fx.tap && e.fx.tap.turns === 0) {
        dmg += e.fx.tap.v;
        hurt = true;
        this.healPlayer(e.fx.tap.v);
      }
      if (hurt) this.hurtEnemy(i, Math.max(1, dmg), 0);
      const rf = e.fx.reflect;
      if (rf && rf.acc > 0 && e.alive && (rf.t === 0 || (rf.t === 1 && rf.turns === 0))) {
        let back = rf.acc;
        if (rf.c !== 0) back += Math.trunc(rf.acc * (pk.colorHurt[rf.c] ?? 0));
        else for (const [col, v] of Object.entries(rf.accC ?? {})) back += Math.trunc(v * (pk.colorHurt[Number(col)] ?? 0));
        this.hurtPlayer(Math.max(0, back), i);
        this.emit({ k: 'text', target: 'player', idx: 0, text: 'Reflect', color: '#ffb36b' });
        rf.acc = 0;
        rf.accC = {};
      }
    }
    // gem bombs
    let reset = false;
    const boom: [number, number][] = [];
    for (let r = 0; r < this.meta.length; r++) {
      for (let c = 0; c < this.meta[r].length; c++) {
        const b = this.meta[r][c]?.bomb;
        if (!b || b.turns > 0) continue;
        boom.push([r, c]);
        let hp = this.hp;
        if (b.pct > 0) hp = Math.trunc(hp * (1 - b.pct));
        hp -= b.damage;
        const lost = this.hp - Math.max(0, hp);
        if (lost > 0) this.hurtPlayer(lost);
        if (b.reset) reset = true;
      }
    }
    if (reset) this.resetBoard();
    else if (boom.length) this.removeCells(boom);
    // perk "Leech": the team loses a share of its HP every turn
    if (pk.leechHp < 0) this.hurtPlayer(-Math.trunc(maxHp * pk.leechHp));
  }

  // ------------------------------------------------------------ ally abilities
  /**
   * Which ability a tap would use: of the abilities whose cooldown has been reached, the one with the longest cooldown
   * (CharacterObject.HandleSingleTouchEnded). -1 when none is ready.
   */
  readyAbility(i: number): number {
    const s = this.unitSt[i];
    if (!s) return -1;
    let best = -1;
    s.maxes.forEach((m, k) => {
      if (m > 0 && s.now >= m && (best < 0 || m > s.maxes[best])) best = k;
    });
    return best;
  }

  /** Is one of this unit's abilities ready to be used right now? */
  abilityReady(i: number): boolean {
    return this.readyAbility(i) >= 0 && !this.isStunnedUnit(i);
  }

  /** Use a unit's ability (the Doctor's stronger one if both are ready). Free action unless it grabs gems (then returns `grab`). */
  useAbility(i: number, target?: SkillTarget): { ok: boolean; grab?: Match[]; res?: TurnResult; needsTarget?: boolean; used?: number } {
    if (!this.abilityReady(i)) return { ok: false };
    const used = this.readyAbility(i);
    const ab = this.team[i].abilities![used];
    this.evs = [];
    this.killedNow = [];
    const out = runAllySkill(this, i, ab, target);
    if (out.needsTarget) return { ok: false, needsTarget: true };
    if (!out.ok) return { ok: false };
    this.unitSt[i].now = 0;
    this.emit({ k: 'unit', unit: i });
    if (this.perks.skillHeal > 0) this.healPlayer(Math.trunc(this.maxHp * this.perks.skillHeal)); // perk "Skill Heal"
    if (out.grab) return { ok: true, grab: out.grab, res: this.freeResult(), used };
    return { ok: true, res: this.freeResult(), used };
  }

  private freeResult(): TurnResult {
    const res: TurnResult = {
      hits: [], heal: 0, combo: 0, enemyAttacks: [], playerHpBefore: this.hp, playerHpAfter: this.hp,
      killed: [...this.killedNow], waveCleared: false, victory: false, defeat: this.hp <= 0, events: this.evs,
    };
    if (this.aliveEnemies.length === 0) {
      res.waveCleared = true;
      res.victory = this.waveIndex >= this.waves.length - 1;
    }
    return res;
  }

  /** Gem selection helper used by "grab" style abilities. */
  cellsWhere(pred: (r: number, c: number) => boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < this.board.length; r++) {
      for (let c = 0; c < this.board[r].length; c++) if (pred(r, c)) out.push([r, c]);
    }
    return out;
  }

  isMatchable(r: number, c: number): boolean {
    return canMatch(this.meta[r][c]);
  }

  metaOf(r: number, c: number) {
    return metaAt(this.meta, r, c);
  }
}
