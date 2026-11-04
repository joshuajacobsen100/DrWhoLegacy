import { COLS, ROWS, canBeSwapped, canPick, findMatches, makeRng, type Match, type Weights } from '../engine/board.ts';
import { Battle, type OtbFx, type DropRow, type Ev, type EnemyDef, type PresetBoard, type TurnResult, type UnitStats } from '../engine/battle.ts';
import type { Gift } from '../drops.ts';
import type { Fx } from '../engine/battle.ts';
import type { PerkFx } from '../engine/perks.ts';
import { DATA, GEM_CSS, crackImage, type LevelDef } from '../data.ts';
import { beepId, loadAudioIndex, playMusic, playSoundId, randomBattleMusic, sfx, stopMusic } from '../audio.ts';
import { Story, type Actor, type StoryHost, type StoryRow } from '../story.ts';
import { runStoryCommand } from '../storycmd.ts';

export const STAGE_W = 640;
export const STAGE_H = 1130;
// 6 columns x 5 rows of gems, 6 team portraits across: 6 * 96 = 576 px inside the 640 px stage
const SCENE_H = 440;
const TEAM_Y = 446;
const HP_Y = 552;
const BOARD_X = 32;
const BOARD_Y = 640;
const CELL = 96;

interface VGem {
  color: number;
  x: number;
  y: number;
  alpha: number;
  scale: number;
}

interface Float {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
}

export interface BattleExtra {
  spawnDefs?: Record<number, EnemyDef>;
  grids?: ([number, number, number][] | null)[];
  skins?: Record<number, number>; // colour -> gem image id for this level
  timeLimit?: number; // seconds for the whole level (0 = untimed)
  story?: StoryRow[]; // the level's story script, if it has one
  presets?: Record<string, PresetBoard>; // scripted boards a story can switch on
  tutorial?: boolean; // the scripted tutorial level
  perks?: PerkFx; // the player's chosen perks
  otb?: OtbFx; // the One Turn Buff for this battle
  /** Roll an enemy's drop card with the player's ownership rules; `run` is what this mission has dropped so far. */
  rollDrop?: (rows: DropRow[], multi: boolean, run: Gift[]) => Gift | null;
}

export interface BattleOutcome {
  victory: boolean;
  turns: number;
  drops: Gift[];
}

const imgCache = new Map<string, HTMLImageElement>();
function img(src: string | null): HTMLImageElement | null {
  if (!src) return null;
  let i = imgCache.get(src);
  if (!i) {
    i = new Image();
    i.src = src;
    imgCache.set(src, i);
  }
  return i.complete && i.naturalWidth > 0 ? i : null;
}

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
let atlas: Record<string, Frame> | null = null;
void fetch('img/ui/ui.json')
  .then((r) => r.json())
  .then((j) => (atlas = j as Record<string, Frame>))
  .catch(() => undefined);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// as in the original: on the right, just above the dialogue box
const SKIP_BTN = { x: 470, y: 736, w: 150, h: 52 };

const cellX = (c: number) => BOARD_X + c * CELL + CELL / 2;
const cellY = (r: number) => BOARD_Y + r * CELL + CELL / 2;

export class BattleView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  battle: Battle;
  vis: (VGem | null)[][];
  level: LevelDef;
  state: 'idle' | 'dragging' | 'busy' | 'over' | 'target' = 'idle';
  picked: { r: number; c: number } | null = null;
  held: VGem | null = null;
  pointer = { x: 0, y: 0 };
  moveStart: number | null = null;
  floats: Float[] = [];
  comboText = '';
  comboT = 0;
  shake = 0;
  hpShown: number;
  enemyFlash = new Map<number, number>();
  teamFlash = new Map<number, number>();
  fade = new Map<number, number>();
  banner = '';
  tip = '';
  tipT = 0;
  pendingUnit = -1;
  skins: Record<number, number>;
  story: Story | null = null;
  moveCount = 0;
  /** A wave has started and enemies that are ready to act (countdown 0) still owe their opening move. */
  readyPending = true;
  readyNotBefore = 0; // not before the wave banner has had its moment
  raf = 0;
  destroyed = false;
  scenes: { bg: string[] }[] = [];
  allDrops: Gift[] = [];
  rollDrop?: (rows: DropRow[], multi: boolean, run: Gift[]) => Gift | null;
  onEnd: (o: BattleOutcome) => void;
  cleanup: (() => void)[] = [];

  constructor(host: HTMLElement, level: LevelDef, waves: EnemyDef[][], weights: Weights, team: UnitStats[], onEnd: (o: BattleOutcome) => void, extra: BattleExtra = {}, seed = Date.now()) {
    this.level = level;
    this.onEnd = onEnd;
    this.skins = extra.skins ?? {};
    this.rollDrop = extra.rollDrop;
    const spawnDefs = extra.spawnDefs ?? {};
    if (extra.story?.length) this.story = new Story(extra.story, this.storyHost());
    this.battle = new Battle(
      team,
      waves,
      DATA.typeRel,
      { dualSame: parseFloat(DATA.args['dual_color_same'] ?? '0.1'), dualDiff: parseFloat(DATA.args['dual_color_different'] ?? '0.3') },
      { weights, rng: makeRng(seed), spawnDefs, grids: extra.grids, timeLimit: extra.timeLimit, presets: extra.presets, tutorial: extra.tutorial, perks: extra.perks, otb: extra.otb },
    );
    this.hpShown = this.battle.hp;
    this.vis = this.freshVis();
    this.scenes = level.w.map((w) => ({
      bg: (DATA.scenes[String(w.sc)]?.bg ?? []).map((b) => `img/scene/${b.id}.png`),
    }));

    this.canvas = document.createElement('canvas');
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    this.canvas.className = 'stage';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
    this.readyNotBefore = performance.now() + 1500;
    void this.announce(this.waveBanner());
    void loadAudioIndex().then(() => {
      if (!this.destroyed) playMusic(randomBattleMusic(), 1, true); // the original picks one of the battle tracks at random
    });
  }

  get board() {
    return this.battle.board;
  }
  get meta() {
    return this.battle.meta;
  }

  destroy(): void {
    this.destroyed = true;
    stopMusic();
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.canvas.remove();
  }

  private freshVis(): (VGem | null)[][] {
    return this.board.map((row, r) => row.map((color, c) => ({ color, x: cellX(c), y: cellY(r), alpha: 1, scale: 1 })));
  }

  /** Hard-sync gem colours with the engine board (positions untouched). */
  private syncVis(): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.vis[r][c];
        if (v) {
          v.color = this.board[r][c];
          v.alpha = 1;
          v.scale = 1;
        } else this.vis[r][c] = { color: this.board[r][c], x: cellX(c), y: cellY(r), alpha: 1, scale: 1 };
      }
    }
  }

  private waveBanner(): string {
    const w = this.level.w[this.battle.waveIndex];
    return w?.boss ? 'BOSS BATTLE' : `Wave ${this.battle.waveIndex + 1} / ${this.battle.waves.length}`;
  }

  private async endByTime(): Promise<void> {
    this.state = 'over';
    this.held = null;
    this.picked = null;
    sfx('timeout');
    await this.announce('TIME UP', 1400);
    if (await this.offerContinue('Time up')) return this.resumeAfterContinue();
    if (this.destroyed) return;
    this.onEnd({ victory: false, turns: this.battle.turn, drops: [] });
  }

  /** The original's game-over "Continue" (it cost a Time Crystal there). It is free and unlimited in this port. */
  private offerContinue(title: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.destroyed) return resolve(false);
      const box = document.createElement('div');
      box.className = 'modal';
      box.innerHTML = `<div class="panel dialog"><h2>${title}</h2><div class="sub">Carry on from here with full HP and a fresh board. It's free.</div>
        <button class="primary big" id="cont">Continue</button><button id="giveup">Give up</button></div>`;
      document.body.appendChild(box);
      let open = true;
      const done = (v: boolean) => {
        if (!open) return;
        open = false;
        box.remove();
        resolve(v);
      };
      box.querySelector('#cont')!.addEventListener('click', () => done(true));
      box.querySelector('#giveup')!.addEventListener('click', () => done(false));
      this.cleanup.push(() => done(false));
    });
  }

  private resumeAfterContinue(): void {
    this.battle.continueAfterDefeat();
    this.vis = this.freshVis();
    this.hpShown = this.battle.hp;
    this.fade.clear();
    this.enemyFlash.clear();
    this.held = null;
    this.picked = null;
    this.state = 'idle';
    sfx('heal');
  }

  private async announce(text: string, ms = 1100): Promise<void> {
    this.banner = text;
    await sleep(ms);
    if (this.banner === text) this.banner = '';
  }

  private showTip(text: string, secs = 2.6): void {
    this.tip = text;
    this.tipT = secs;
  }

  // ---------------------------------------------------------------- input
  private toStage(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * STAGE_W, y: ((e.clientY - r.top) / r.height) * STAGE_H };
  }

  private bindInput(): void {
    const down = (e: PointerEvent) => {
      const p = this.toStage(e);
      this.pointer = p;
      // while a story row is running it owns the screen: taps advance it, the skip button jumps ahead
      if (this.story?.locked) {
        if (this.story.canSkip && p.x >= SKIP_BTN.x && p.x <= SKIP_BTN.x + SKIP_BTN.w && p.y >= SKIP_BTN.y && p.y <= SKIP_BTN.y + SKIP_BTN.h) {
          if (this.story.skipNow()) sfx('tick');
        } else this.story.tap();
        return;
      }
      if (this.state === 'target') {
        const cell = this.cellAt(p.x, p.y, false);
        const ui = this.pendingUnit;
        this.pendingUnit = -1;
        this.banner = '';
        if (cell) void this.activate(ui, cell);
        else this.state = 'idle';
        return;
      }
      if (this.state !== 'idle') return;
      // tap an enemy to focus it
      if (p.y < SCENE_H) {
        const idx = this.enemyAt(p.x, p.y);
        if (idx >= 0) {
          this.battle.target = idx;
          sfx('tick');
        }
        return;
      }
      // tap a team portrait: use its ability, or read what it does
      if (p.y >= TEAM_Y && p.y < TEAM_Y + CELL) {
        const ui = Math.floor((p.x - BOARD_X) / CELL);
        if (ui >= 0 && ui < this.battle.team.length) void this.tapUnit(ui);
        return;
      }
      const cell = this.cellAt(p.x, p.y, false);
      if (!cell) return;
      if (!canPick(this.meta[cell.r][cell.c])) {
        sfx('timeout');
        return;
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.picked = cell;
      this.held = this.vis[cell.r][cell.c];
      this.state = 'dragging';
      this.moveStart = null;
      sfx('pick');
    };
    const move = (e: PointerEvent) => {
      const p = this.toStage(e);
      this.pointer = p;
      if (this.state !== 'dragging' || !this.picked) return;
      const target = this.cellAt(p.x, p.y, true)!;
      let guard = 0;
      while ((target.r !== this.picked.r || target.c !== this.picked.c) && guard++ < 12) {
        const dr = Math.sign(target.r - this.picked.r);
        const dc = Math.sign(target.c - this.picked.c);
        // step along the larger offset first so diagonal drags still land on a neighbour
        const stepC = Math.abs(target.c - this.picked.c) >= Math.abs(target.r - this.picked.r);
        const nr: number = this.picked.r + (stepC ? 0 : dr);
        const nc: number = this.picked.c + (stepC ? dc : 0);
        if (!canBeSwapped(this.meta[nr][nc])) break; // locked gems block the path
        this.swap(this.picked.r, this.picked.c, nr, nc);
        this.picked = { r: nr, c: nc };
        if (this.moveStart === null) this.moveStart = performance.now();
        sfx('swap');
      }
    };
    const up = () => {
      if (this.state === 'dragging') this.release();
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.cleanup.push(() => {
      this.canvas.removeEventListener('pointerdown', down);
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    });
  }

  private cellAt(x: number, y: number, clamp: boolean): { r: number; c: number } | null {
    let c = Math.floor((x - BOARD_X) / CELL);
    let r = Math.floor((y - BOARD_Y) / CELL);
    if (!clamp && (c < 0 || c >= COLS || r < 0 || r >= ROWS)) return null;
    c = Math.max(0, Math.min(COLS - 1, c));
    r = Math.max(0, Math.min(ROWS - 1, r));
    return { r, c };
  }

  private enemyAt(x: number, y: number): number {
    const b = this.battle;
    for (let i = b.enemies.length - 1; i >= 0; i--) {
      const e = b.enemies[i];
      if (!e.alive) continue;
      const box = this.enemyBox(e);
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return i;
    }
    return -1;
  }

  private enemyBox(e: { x: number; y: number; w: number; h: number }) {
    const maxH = 320;
    const k = Math.min(1, maxH / e.h);
    const w = e.w * k;
    const h = e.h * k;
    return { x: STAGE_W / 2 + e.x - w / 2, y: SCENE_H - 70 - e.y - h, w, h };
  }

  private swap(r1: number, c1: number, r2: number, c2: number): void {
    const b = this.board;
    [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
    const m = this.meta;
    [m[r1][c1], m[r2][c2]] = [m[r2][c2], m[r1][c1]];
    const v = this.vis;
    [v[r1][c1], v[r2][c2]] = [v[r2][c2], v[r1][c1]];
    // moving a blind gem reveals it
    for (const [r, c] of [[r1, c1], [r2, c2]]) if (m[r][c]) m[r][c]!.blind = false;
  }

  /** Debug/test hook: replace the board. */
  debugSetBoard(rows: number[][]): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.battle.board[r][c] = rows[r][c];
        this.battle.meta[r][c] = null;
      }
    }
    this.vis = this.freshVis();
  }

  // ---------------------------------------------------------------- abilities
  private async tapUnit(ui: number): Promise<void> {
    const b = this.battle;
    const u = b.team[ui];
    const abs = u.abilities ?? [];
    if (!abs.length) {
      this.showTip(`${u.name}: no ability`);
      return;
    }
    const st = b.unitSt[ui];
    if (b.isStunnedUnit(ui)) {
      this.showTip(`${u.name} is stunned`);
      return;
    }
    if (!b.abilityReady(ui)) {
      // the Doctor has two abilities that charge together: show both
      this.showTip(abs.map((a, k) => `${a.n} (${Math.min(st.now, st.maxes[k])}/${st.maxes[k]}): ${a.d}`).join('\n'), 3.5);
      sfx('tick');
      return;
    }
    await this.activate(ui);
  }

  private async activate(ui: number, target?: { r: number; c: number }): Promise<void> {
    const b = this.battle;
    this.state = 'busy';
    const out = b.useAbility(ui, target);
    if (out.needsTarget) {
      this.pendingUnit = ui;
      this.state = 'target';
      this.banner = 'Tap a gem';
      return;
    }
    if (!out.ok || !out.res) {
      for (const e of b.evs) if (e.k === 'text') this.showTip(e.text, 1.8); // e.g. "No time limit"
      this.state = 'idle';
      return;
    }
    sfx('wave');
    this.teamFlash.set(ui, 1);
    this.showTip(b.team[ui].abilities![out.used ?? 0].n, 1.6);
    await this.playEvents(out.res.events);
    this.syncVis();
    if (out.grab) {
      await this.resolveTurn(out.grab);
      return;
    }
    await this.finishTurn(out.res);
  }

  // ---------------------------------------------------------------- turn flow
  private release(): void {
    this.held = null;
    this.picked = null;
    if (this.moveStart === null) {
      this.state = 'idle';
      return;
    }
    this.moveStart = null;
    // a scripted tutorial drag must end on its target; anything else is undone and costs no turn
    if (this.battle.tutorialOpen && !this.battle.tutorialFinish()) {
      this.vis = this.freshVis();
      sfx('timeout');
      this.state = 'idle';
      return;
    }
    this.state = 'busy';
    void this.resolveTurn(null);
  }

  private async resolveTurn(initial: Match[] | null): Promise<void> {
    const all: Match[] = [];
    let combo = 0;
    for (let guard = 0; guard < 40 && !this.destroyed; guard++) {
      const ms = initial && guard === 0 ? initial : findMatches(this.board, this.meta);
      if (!ms.length) break;
      combo += ms.length;
      all.push(...ms);
      this.comboText = combo > 1 ? `${combo} COMBO` : '';
      this.comboT = 1;
      sfx(combo > 1 ? 'combo' : 'match', combo);
      const cells = ms.flatMap((m) => m.cells);
      for (let i = 0; i < 6; i++) {
        for (const [r, c] of cells) {
          const v = this.vis[r][c];
          if (v) {
            v.alpha = 1 - (i + 1) / 6;
            v.scale = 1 + (i + 1) * 0.04;
          }
        }
        await sleep(40);
      }
      const survivors = this.survivors(cells);
      this.battle.removeMatches(ms);
      this.rebuildVis(survivors);
      await sleep(360);
    }
    if (this.destroyed) return;
    // A swap with no match still ends the turn: the original's CheckPath state fires the end-of-combo event even with
    // zero combos, so statuses tick and enemy cooldowns count down (the tutorial teaches exactly this).
    this.moveCount++;
    const res = this.battle.resolveMove(all);
    await this.playEvents(res.events);
    this.syncVis();
    await this.finishTurn(res);
  }

  // ---------------------------------------------------------------- story
  private storyHost(): StoryHost {
    return {
      waveNumber: () => this.battle.waveIndex + 1,
      aliveEnemies: () => this.battle.aliveEnemies.length,
      boardIdle: () => this.state === 'idle' || this.state === 'dragging' || this.state === 'target',
      moves: () => this.moveCount,
      tutorialDone: () => this.battle.tutDone,
      gameplay: (action, args) => this.storyCommand(action, args),
      beep: (name, volume) => playSoundId(beepId(name), volume),
      playSound: (id, volume) => playSoundId(id, volume),
      playMusic: (name, volume, restart) => playMusic(name, volume, restart),
    };
  }

  /** Roll a drop card; anything won joins this mission's drops. */
  private dropFrom(rows: DropRow[], multi: boolean): void {
    const g = this.rollDrop?.(rows, multi, this.allDrops);
    if (g) this.allDrops.push(g);
  }

  private storyCommand(action: string, args: string[]): void {
    runStoryCommand(this.battle, DATA.levels, action, args, {
      shake: () => (this.shake = 1),
      dropIn: () => this.dropInBoard(),
      refresh: () => this.syncVis(),
      events: (evs) => void this.playEvents(evs),
      gift: (src) => this.dropFrom(src.rows, src.multi),
      readyEnemies: () => {
        this.readyPending = true;
        void this.tryReady(true);
      },
    });
  }

  /** Gems fall into the board from above (used when a scripted layout replaces the board). */
  private dropInBoard(): void {
    this.vis = this.freshVis();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.vis[r][c];
        if (v) v.y -= 760 + c * 50 + (ROWS - r) * 30;
      }
    }
  }

  private storyImage(a: Actor): HTMLImageElement | null {
    if (!/^\d+$/.test(a.srcValue)) return null;
    const dir = a.srcType === 'suit' ? 'suit' : a.srcType === 'enemy_image' ? 'enemy' : a.srcType === 'scene_image' ? 'scene' : '';
    return dir ? img(`img/${dir}/${a.srcValue}.png`) : null;
  }

  /** Visual gems that were not removed, per column from the bottom up. */
  private survivors(removed: [number, number][]): VGem[][] {
    const gone = new Set(removed.map(([r, c]) => r * COLS + c));
    const out: VGem[][] = [];
    for (let c = 0; c < COLS; c++) {
      const col: VGem[] = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        const v = this.vis[r][c];
        if (v && !gone.has(r * COLS + c)) col.push(v);
      }
      out.push(col);
    }
    return out;
  }

  private rebuildVis(survivors: VGem[][]): void {
    for (let c = 0; c < COLS; c++) {
      const col = survivors[c];
      let r = ROWS - 1;
      for (const v of col) this.vis[r--][c] = v;
      let n = 0;
      for (; r >= 0; r--) {
        this.vis[r][c] = { color: this.board[r][c], x: cellX(c), y: BOARD_Y - CELL * (1 + n++) - CELL / 2, alpha: 1, scale: 1 };
      }
    }
  }

  private float(text: string, x: number, y: number, color = '#fff', size = 34, life = 1.0): void {
    this.floats.push({ text, x, y, t: 0, life, color, size });
  }

  /**
   * The original's wave start goes through CheckEnemyAttack: enemies whose current ability has a countdown of 0 act before
   * the player's first move. It waits while a story is on screen (or until `checkenemyattack,0`) and while a turn is busy.
   */
  private async tryReady(force = false): Promise<void> {
    if (!this.readyPending || this.destroyed || this.state !== 'idle') return;
    if (!force && (this.story?.locked || performance.now() < this.readyNotBefore)) return;
    this.readyPending = false;
    if (!this.battle.enemiesReady) return;
    this.state = 'busy';
    const res = this.battle.readyEnemyPhase();
    await this.playEvents(res.events);
    this.syncVis();
    await this.finishTurn(res);
  }

  private async playEvents(events: Ev[]): Promise<void> {
    const b = this.battle;
    for (const e of events) {
      if (this.destroyed) return;
      switch (e.k) {
        case 'unit':
          this.teamFlash.set(e.unit, 1);
          break;
        case 'hurtEnemy': {
          const en = b.enemies[e.enemy];
          const box = this.enemyBox(en);
          const mult = e.color ? (DATA.typeRel[e.color]?.[en.color] ?? 1) : 1;
          this.enemyFlash.set(e.enemy, 1);
          const col = mult > 1 ? '#ffd23f' : mult < 1 ? '#9fb3c8' : '#fff';
          this.float(String(e.amount), box.x + box.w / 2 + (Math.random() - 0.5) * 40, box.y + box.h * 0.3, col, mult > 1 ? 46 : 36);
          sfx('hit');
          await sleep(110);
          break;
        }
        case 'healEnemy': {
          const box = this.enemyBox(b.enemies[e.enemy]);
          this.float(`+${e.amount}`, box.x + box.w / 2, box.y + box.h * 0.25, '#7dffb0', 34);
          await sleep(120);
          break;
        }
        case 'healPlayer':
          this.float(`+${e.amount}`, STAGE_W / 2, HP_Y - 10, '#7dffb0', 44, 1.2);
          sfx('heal');
          await sleep(160);
          break;
        case 'hurtPlayer':
          this.float(String(e.amount), STAGE_W / 2 + (Math.random() - 0.5) * 120, HP_Y - 30, '#ff6b6b', 40, 1.1);
          if (e.enemy !== undefined) this.enemyFlash.set(e.enemy, 1);
          this.shake = 1;
          sfx('hurt');
          await sleep(380);
          break;
        case 'kill': {
          this.fade.set(e.enemy, 1);
          sfx('kill');
          const en = b.enemies[e.enemy];
          this.dropFrom(en.drops, !!en.dropMulti);
          await sleep(420);
          break;
        }
        case 'ability': {
          const box = this.enemyBox(b.enemies[e.enemy]);
          this.enemyFlash.set(e.enemy, 1);
          this.float(e.name, box.x + box.w / 2, Math.max(40, box.y - 10), '#ffe066', 30, 1.6);
          sfx('wave');
          await sleep(560);
          break;
        }
        case 'text': {
          let x = STAGE_W / 2;
          let y = HP_Y - 50;
          if (e.target === 'unit') {
            x = BOARD_X + e.idx * CELL + CELL / 2;
            y = TEAM_Y + 20;
          } else if (e.target === 'enemy') {
            const box = this.enemyBox(b.enemies[e.idx]);
            x = box.x + box.w / 2;
            y = box.y + box.h * 0.4;
          }
          this.float(e.text, x, y, e.color ?? '#fff', 28, 1.3);
          await sleep(150);
          break;
        }
        case 'spawn':
          sfx('wave');
          await sleep(350);
          break;
        case 'board':
          if (e.kind === 'remove' && e.cells) {
            for (let i = 0; i < 5; i++) {
              for (const [r, c] of e.cells) {
                const v = this.vis[r][c];
                if (v) v.alpha = 1 - (i + 1) / 5;
              }
              await sleep(40);
            }
            const survivors = this.survivors(e.cells);
            this.rebuildVis(survivors);
            sfx('swap');
            await sleep(380);
          } else {
            this.syncVis();
            sfx('swap');
            await sleep(220);
          }
          break;
      }
    }
  }

  private async finishTurn(res: TurnResult): Promise<void> {
    const b = this.battle;
    if (res.victory) {
      this.state = 'over';
      // outro dialogue (scripts that wait for "victory") plays before the result screen
      if (this.story && !this.story.done) {
        this.story.markVictory();
        for (let i = 0; i < 6000 && !this.story.done && !this.destroyed; i++) await sleep(50);
      }
      await this.announce('VICTORY', 1400);
      this.onEnd({ victory: true, turns: b.turn, drops: this.allDrops });
      return;
    }
    if (res.defeat) {
      this.state = 'over';
      await this.announce('DEFEATED', 1400);
      if (await this.offerContinue('Defeated')) return this.resumeAfterContinue();
      if (this.destroyed) return;
      this.onEnd({ victory: false, turns: b.turn, drops: [] });
      return;
    }
    if (res.waveCleared) {
      await sleep(250);
      b.nextWave();
      this.readyPending = true;
      this.readyNotBefore = performance.now() + 1500;
      this.syncVis(); // the new wave may add or remove crack obstacles
      this.fade.clear();
      this.enemyFlash.clear();
      sfx('wave');
      await this.announce(this.waveBanner(), 1100);
    }
    this.state = 'idle';
  }

  // ---------------------------------------------------------------- rendering
  private last = performance.now();
  private rawDt = 0;
  private frame = (now: number) => {
    if (this.destroyed) return;
    const raw = Math.min(0.5, (now - this.last) / 1000); // real elapsed time, capped so a hidden tab does not burn the clock
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.rawDt = raw;
    this.update(dt, now);
    this.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.vis[r]?.[c];
        if (!v || v === this.held) continue;
        const tx = cellX(c);
        const ty = cellY(r);
        const k = 1 - Math.pow(0.0005, dt);
        v.x += (tx - v.x) * k;
        v.y += (ty - v.y) * k;
        if (Math.abs(tx - v.x) < 0.5) v.x = tx;
        if (Math.abs(ty - v.y) < 0.5) v.y = ty;
      }
    }
    if (this.held) {
      this.held.x = Math.max(BOARD_X + 10, Math.min(BOARD_X + COLS * CELL - 10, this.pointer.x));
      this.held.y = Math.max(BOARD_Y + 10, Math.min(BOARD_Y + ROWS * CELL - 10, this.pointer.y - 30));
    }
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < f.life);
    this.comboT = Math.max(0, this.comboT - dt * 0.8);
    this.tipT = Math.max(0, this.tipT - dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    for (const m of [this.enemyFlash, this.teamFlash]) for (const [k, v] of m) m.set(k, Math.max(0, v - dt * 2.5));
    for (const [k, v] of this.fade) this.fade.set(k, Math.max(0, v - dt * 2.2));
    const diff = this.battle.hp - this.hpShown;
    this.hpShown += diff * Math.min(1, dt * 6);
    if (Math.abs(diff) < 0.5) this.hpShown = this.battle.hp;
    if (this.state === 'dragging' && this.moveStart !== null && now - this.moveStart > this.battle.moveMs) {
      sfx('timeout');
      this.release();
    }
    // level clock: runs in real time from the start; a drag in progress is released and resolved
    // first, and the level only ends (as a defeat) once the board is waiting for input again
    const b = this.battle;
    if (this.readyPending && this.state === 'idle') void this.tryReady();
    if (this.story && !this.story.done) {
      this.story.update(this.rawDt);
      // a story row that starts while the player holds a gem takes the board away from them
      if (this.story.locked && this.state === 'dragging') this.release();
    }
    if (b.timed && this.state !== 'over' && !this.story?.locked) { // the level clock waits while dialogue is on screen
      b.tickTime(this.rawDt * 1000);
      if (b.timeUp) {
        if (this.state === 'dragging') this.release();
        else if (this.state === 'idle' || this.state === 'target') void this.endByTime();
      }
    }
  }

  private draw(now: number): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, STAGE_W, STAGE_H);
    if (this.shake > 0) g.translate((Math.random() - 0.5) * 14 * this.shake, (Math.random() - 0.5) * 14 * this.shake);
    this.drawScene(g);
    this.drawEnemies(g);
    this.drawTeam(g, now);
    this.drawHp(g);
    this.drawBoard(g, now);
    this.drawOverlay(g);
    this.drawStory(g, now);
  }

  // ---------------------------------------------------------------- story rendering
  private tintCache = new Map<string, HTMLCanvasElement>();

  /** An image multiplied by an RGB tint (the scripts dim non-speaking characters with 0.4 0.4 0.4). */
  private tinted(im: HTMLImageElement, key: string, c: [number, number, number, number]): CanvasImageSource {
    if (c[0] >= 0.99 && c[1] >= 0.99 && c[2] >= 0.99) return im;
    const k = `${im.src}|${c[0]},${c[1]},${c[2]}`;
    let cv = this.tintCache.get(k);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      const x = cv.getContext('2d')!;
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
      x.fillRect(0, 0, cv.width, cv.height);
      x.globalCompositeOperation = 'destination-in'; // multiply paints the transparent areas too: restore the alpha
      x.drawImage(im, 0, 0);
      this.tintCache.set(k, cv);
    }
    void key;
    return cv;
  }

  private wrapCache = new WeakMap<object, string[]>();

  private drawStory(g: CanvasRenderingContext2D, now: number): void {
    const st = this.story;
    if (!st || st.done) return;
    const running = st.mode === 'running';
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Battle-layer sprites (tutorial arrows and rings, from `setspritetolayer`) stay on screen while the story waits for
    // the player. Their coordinates are the original board's: x = 70 + 100 * col, y = 50 + 100 * row, up from the bottom.
    const k = CELL / 100;
    for (const a of st.layerSprites.values()) {
      const im = this.storyImage(a);
      if (!im) continue;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, a.alpha));
      g.translate(BOARD_X + (a.x - 20) * k, BOARD_Y + ROWS * CELL - a.y * k);
      if (a.rotation) g.rotate((a.rotation * Math.PI) / 180);
      g.drawImage(im, (-im.naturalWidth * a.scaleX * k) / 2, (-im.naturalHeight * a.scaleY * k) / 2, im.naturalWidth * a.scaleX * k, im.naturalHeight * a.scaleY * k);
      g.restore();
    }
    // a suspended story closes its dialogue window, actors included, so only the layer sprites above remain
    if (!running) {
      g.restore();
      return;
    }
    if (!st.text?.hideActors) {
      for (const a of st.sortedActors) {
        const im = this.storyImage(a);
        if (!im) continue;
        const w = (a.width ?? im.naturalWidth) * (a.width ? 1 : a.scaleX);
        const h = (a.height ?? im.naturalHeight) * (a.height ? 1 : a.scaleY);
        // story window: y(up from the bottom) = ypos + screenHeight * aligny, so aligny=1 hangs the sprite from the top
        const cy = STAGE_H - (a.y + STAGE_H * (a.alignY ?? 0));
        g.save();
        g.globalAlpha = Math.max(0, Math.min(1, a.alpha * a.color[3]));
        g.translate(a.x, cy);
        if (a.rotation) g.rotate((a.rotation * Math.PI) / 180);
        g.drawImage(this.tinted(im, a.name, a.color), -w / 2, -h / 2, w, h);
        g.restore();
      }
    }
    if (running && st.textVisible && st.text) {
      const t = st.text;
      const bx = 24;
      const by = 800;
      const bw = STAGE_W - 48;
      const bh = 300;
      g.fillStyle = 'rgba(6,10,22,0.82)';
      g.strokeStyle = 'rgba(120,160,255,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(bx, by, bw, bh, 18);
      g.fill();
      g.stroke();
      g.font = '30px system-ui, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'top';
      let lines = this.wrapCache.get(t);
      if (!lines) {
        lines = wrapAll(g, t.full, bw - 60);
        this.wrapCache.set(t, lines);
      }
      let left = t.shown;
      g.fillStyle = '#fff';
      lines.forEach((line, i) => {
        if (left <= 0) return;
        g.fillText(line.slice(0, left), bx + 30, by + 26 + i * 40);
        left -= line.length + 1; // +1 for the space the wrap swallowed
      });
      if (t.done && t.wait === 'user' && Math.floor(now / 400) % 2 === 0) {
        g.fillStyle = '#ffd23f';
        g.textAlign = 'right';
        g.fillText('▼', bx + bw - 24, by + bh - 50);
      }
    }
    if (running && st.canSkip) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(SKIP_BTN.x, SKIP_BTN.y, SKIP_BTN.w, SKIP_BTN.h, 12);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = 'bold 24px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SKIP ▶▶', SKIP_BTN.x + SKIP_BTN.w / 2, SKIP_BTN.y + SKIP_BTN.h / 2);
    }
    g.restore();
  }

  private drawScene(g: CanvasRenderingContext2D): void {
    g.save();
    g.beginPath();
    g.rect(0, 0, STAGE_W, SCENE_H);
    g.clip();
    const sc = this.scenes[Math.min(this.battle.waveIndex, this.scenes.length - 1)];
    let drew = false;
    for (const src of sc?.bg ?? []) {
      const im = img(src);
      if (!im) continue;
      drew = true;
      const k = Math.max(STAGE_W / im.naturalWidth, SCENE_H / im.naturalHeight);
      const w = im.naturalWidth * k;
      const h = im.naturalHeight * k;
      g.drawImage(im, (STAGE_W - w) / 2, SCENE_H - h, w, h);
    }
    if (!drew) {
      const grd = g.createLinearGradient(0, 0, 0, SCENE_H);
      grd.addColorStop(0, '#16233d');
      grd.addColorStop(1, '#283a5c');
      g.fillStyle = grd;
      g.fillRect(0, 0, STAGE_W, SCENE_H);
    }
    g.restore();
  }

  /** A row of small status badges: icon + remaining turns. */
  private drawFx(g: CanvasRenderingContext2D, items: { fx?: Fx; label: string }[], x: number, y: number, align: 'left' | 'center'): void {
    const active = items.filter((i) => i.fx);
    const step = 36;
    let sx = align === 'center' ? x - ((active.length - 1) * step) / 2 : x;
    for (const it of active) {
      const f = it.fx!;
      const im = img(f.icon);
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.beginPath();
      g.arc(sx, y, 16, 0, Math.PI * 2);
      g.fill();
      if (im) g.drawImage(im, sx - 14, y - 14, 28, 28);
      else {
        g.fillStyle = '#ffe066';
        g.font = 'bold 14px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(it.label, sx, y);
      }
      if (!f.locked) {
        g.fillStyle = '#fff';
        g.strokeStyle = '#000';
        g.lineWidth = 3;
        g.font = 'bold 16px system-ui, sans-serif';
        g.textAlign = 'right';
        g.textBaseline = 'alphabetic';
        const t = String(Math.max(0, f.turns));
        g.strokeText(t, sx + 17, y + 17);
        g.fillText(t, sx + 17, y + 17);
      }
      g.restore();
      sx += step;
    }
  }

  private drawEnemies(g: CanvasRenderingContext2D): void {
    const b = this.battle;
    b.enemies.forEach((e, i) => {
      const fade = this.fade.get(i);
      if (!e.alive && !fade) return;
      const box = this.enemyBox(e);
      const flash = this.enemyFlash.get(i) ?? 0;
      g.save();
      g.globalAlpha = e.alive ? 1 : fade!;
      const im = img(e.img);
      const dx = flash > 0.5 ? (Math.random() - 0.5) * 10 : 0;
      if (im) g.drawImage(im, box.x + dx, box.y, box.w, box.h);
      else {
        g.fillStyle = GEM_CSS[e.color] ?? '#777';
        g.fillRect(box.x, box.y, box.w, box.h);
      }
      if (flash > 0) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = flash * 0.5 * (e.alive ? 1 : fade!);
        if (im) g.drawImage(im, box.x + dx, box.y, box.w, box.h);
      }
      if (e.fx.shadow && im) {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.35;
        g.drawImage(im, box.x + dx, box.y, box.w, box.h);
      }
      g.restore();
      if (!e.alive) return;
      const isTarget = b.target === i || (b.target < 0 && i === b.aliveEnemies[b.aliveEnemies.length - 1]);
      const cx = box.x + box.w / 2;
      const by = box.y + box.h + 6;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(cx - 62, by, 124, 14);
      g.fillStyle = GEM_CSS[e.color] ?? '#888';
      g.fillRect(cx - 61, by + 1, (122 * e.hp) / e.maxHp, 12);
      if (isTarget) {
        g.strokeStyle = '#ffd23f';
        g.lineWidth = 3;
        g.strokeRect(cx - 63, by - 1, 126, 16);
      }
      // countdown badge + the icon of the ability about to fire (telegraph)
      g.fillStyle = e.curCd <= 1 ? '#ff5555' : 'rgba(0,0,0,0.75)';
      g.beginPath();
      g.arc(cx + 70, by + 7, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 20px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(e.curCd), cx + 70, by + 8);
      const next = e.abil[e.cur]?.def;
      if (next && next.t !== 0) {
        const ni = img(next.icon);
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.beginPath();
        g.arc(cx - 78, by + 7, 15, 0, Math.PI * 2);
        g.fill();
        if (ni) g.drawImage(ni, cx - 92, by - 7, 28, 28);
      }
      this.drawFx(
        g,
        [
          { fx: e.fx.stun, label: 'ST' },
          { fx: e.fx.poison, label: 'PO' },
          { fx: e.fx.bomb, label: 'BO' },
          { fx: e.fx.tap, label: 'LT' },
          { fx: e.fx.immune, label: 'IM' },
          { fx: e.fx.shadow, label: 'SH' },
          { fx: e.fx.reflect, label: 'RF' },
          { fx: e.fx.shield, label: 'CS' },
        ],
        cx,
        by + 36,
        'center',
      );
    });
  }

  private drawTeam(g: CanvasRenderingContext2D, now: number): void {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, TEAM_Y - 4, STAGE_W, 104);
    this.battle.team.forEach((u, i) => {
      const x = BOARD_X + i * CELL;
      const im = img(u.icon);
      const flash = this.teamFlash.get(i) ?? 0;
      const ready = this.battle.abilityReady(i);
      const stunned = this.battle.isStunnedUnit(i);
      g.save();
      g.translate(0, -flash * 10);
      if (im) g.drawImage(im, x, TEAM_Y, CELL - 4, CELL - 4);
      else {
        g.fillStyle = '#334';
        g.fillRect(x, TEAM_Y, CELL - 4, CELL - 4);
      }
      if (stunned) {
        g.fillStyle = 'rgba(20,20,40,0.65)';
        g.fillRect(x, TEAM_Y, CELL - 4, CELL - 4);
        g.fillStyle = '#ffe066';
        g.font = 'bold 22px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('STUN', x + (CELL - 4) / 2, TEAM_Y + (CELL - 4) / 2);
      }
      g.restore();
      u.colors.forEach((c, k) => {
        g.fillStyle = GEM_CSS[c] ?? '#888';
        g.beginPath();
        g.arc(x + 14 + k * 20, TEAM_Y + CELL - 20, 8, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.stroke();
      });
      // ability charge bar / ready glow
      const st = this.battle.unitSt[i];
      const shown = Math.max(0, this.battle.readyAbility(i));
      const ab = u.abilities?.[shown];
      if (ab && st.max > 0) {
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(x, TEAM_Y + CELL - 8, CELL - 4, 6);
        g.fillStyle = ready ? '#ffd23f' : '#4aa3ff';
        g.fillRect(x, TEAM_Y + CELL - 8, ((CELL - 4) * Math.min(st.now, st.max)) / st.max, 6);
        // the Doctor's shorter ability gets a tick on the bar where it becomes ready
        for (const m of st.maxes) {
          if (m > 0 && m < st.max) {
            g.fillStyle = '#fff';
            g.fillRect(x + ((CELL - 4) * m) / st.max - 1, TEAM_Y + CELL - 10, 2, 10);
          }
        }
        const ai = img(ab.icon);
        if (ai) g.drawImage(ai, x + CELL - 34, TEAM_Y + 2, 28, 28);
        if (u.abilities!.length > 1) {
          g.fillStyle = '#fff';
          g.font = 'bold 14px system-ui, sans-serif';
          g.textAlign = 'right';
          g.textBaseline = 'top';
          g.fillText(`${shown + 1}/${u.abilities!.length}`, x + CELL - 8, TEAM_Y + 32);
        }
      }
      if (ready) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 160);
        g.strokeStyle = `rgba(255,210,63,${0.6 + 0.4 * pulse})`;
        g.lineWidth = 4;
        g.strokeRect(x + 2, TEAM_Y + 2, CELL - 8, CELL - 8);
      }
    });
  }

  private drawHp(g: CanvasRenderingContext2D): void {
    const b = this.battle;
    const x = BOARD_X;
    const w = COLS * CELL;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(x, HP_Y, w, 34);
    const p = Math.max(0, Math.min(1, this.hpShown / b.maxHp));
    g.fillStyle = p > 0.5 ? '#3ddc84' : p > 0.25 ? '#ffb020' : '#ff4d4d';
    g.fillRect(x + 3, HP_Y + 3, (w - 6) * p, 28);
    g.fillStyle = '#fff';
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${Math.ceil(this.hpShown)} / ${b.maxHp}`, x + w / 2, HP_Y + 18);
    if (this.state === 'dragging' && this.moveStart !== null) {
      const left = Math.max(0, 1 - (performance.now() - this.moveStart) / b.moveMs);
      g.fillStyle = left > 0.3 ? '#4aa3ff' : '#ff5555';
      g.fillRect(x, HP_Y + 38, w * left, 6);
    }
    // player status badges, right under the bar's top-left corner of the scene
    this.drawFx(
      g,
      [
        { fx: b.pFx.poison, label: 'PO' },
        { fx: b.pFx.bomb, label: 'BO' },
        { fx: b.pFx.tap, label: 'LT' },
        { fx: b.pFx.move, label: 'SL' },
        { fx: b.pFx.moveBonus, label: 'TM' },
        { fx: b.pFx.maxhp, label: 'HP' },
      ],
      x + 18,
      HP_Y - 26,
      'left',
    );
  }

  private drawAtlas(g: CanvasRenderingContext2D, name: string, cx: number, cy: number, size: number, alpha = 1): void {
    const f = atlas?.[name];
    const im = img('img/ui/ui.png');
    if (!f || !im) return;
    g.globalAlpha = alpha;
    g.drawImage(im, f.x, f.y, f.w, f.h, cx - size / 2, cy - size / 2, size, size);
    g.globalAlpha = 1;
  }

  private drawBoard(g: CanvasRenderingContext2D, _now: number): void {
    g.fillStyle = 'rgba(8,14,28,0.95)';
    g.fillRect(BOARD_X - 6, BOARD_Y - 6, COLS * CELL + 12, ROWS * CELL + 12);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        g.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)';
        g.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL);
      }
    }
    g.save();
    g.beginPath();
    g.rect(BOARD_X - 6, BOARD_Y - 6, COLS * CELL + 12, ROWS * CELL + 12);
    g.clip();
    const drawGem = (v: VGem, r: number, c: number, lift: boolean) => {
      const m = this.meta[r]?.[c] ?? null;
      const s = (CELL - 6) * v.scale * (lift ? 1.12 : 1);
      g.globalAlpha = v.alpha * (lift ? 0.92 : 1);
      if (m?.blind) {
        g.fillStyle = '#1b2438';
        g.beginPath();
        g.arc(v.x, v.y, s / 2.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#8fa0c4';
        g.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('?', v.x, v.y + 2);
      } else if (m?.crack) {
        const im = img(crackImage(m.crack));
        if (im) g.drawImage(im, v.x - s / 2, v.y - s / 2, s, s);
        else {
          g.fillStyle = '#2a2f3d';
          g.fillRect(v.x - s / 2, v.y - s / 2, s, s);
        }
      } else {
        const im = img(`img/gems/gem${this.skins[v.color] ?? v.color}.png`);
        if (im) g.drawImage(im, v.x - s / 2, v.y - s / 2, s, s);
        else {
          g.fillStyle = GEM_CSS[v.color] ?? '#888';
          g.beginPath();
          g.arc(v.x, v.y, s / 2.3, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (m) {
        const net = m.dbl - m.sub;
        if (net > 0) this.drawAtlas(g, 'gem_plus', v.x, v.y, s, 0.85 * v.alpha);
        else if (net < 0) this.drawAtlas(g, 'gem_minus', v.x, v.y, s, 0.85 * v.alpha);
        if (m.lock === 1) this.drawAtlas(g, 'gem_s3', v.x, v.y, s, v.alpha);
        else if (m.lock === 2) this.drawAtlas(g, 'gem_s2', v.x, v.y, s, v.alpha);
        else if (m.lock === 5 || m.lock === 6) {
          g.globalAlpha = 0.72 * v.alpha;
          g.fillStyle = '#000';
          g.beginPath();
          g.arc(v.x, v.y, s / 2.2, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
        }
        if (m.lock > 0 && m.lockTurns > 0) {
          g.globalAlpha = v.alpha;
          g.fillStyle = '#fff';
          g.strokeStyle = '#000';
          g.lineWidth = 4;
          g.font = 'bold 20px system-ui, sans-serif';
          g.textAlign = 'right';
          g.textBaseline = 'alphabetic';
          g.strokeText(String(m.lockTurns), v.x + s / 2 - 4, v.y + s / 2 - 6);
          g.fillText(String(m.lockTurns), v.x + s / 2 - 4, v.y + s / 2 - 6);
        }
        if (m.bomb) {
          g.globalAlpha = v.alpha;
          g.fillStyle = '#d62828';
          g.beginPath();
          g.arc(v.x + s / 2 - 14, v.y - s / 2 + 14, 15, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#fff';
          g.font = 'bold 18px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(Math.max(0, m.bomb.turns)), v.x + s / 2 - 14, v.y - s / 2 + 15);
        }
      }
      g.globalAlpha = 1;
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = this.vis[r][c];
      if (v && v !== this.held) drawGem(v, r, c, false);
    }
    if (this.held && this.picked) drawGem(this.held, this.picked.r, this.picked.c, true);
    g.restore();
    if (this.state === 'target') {
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 4;
      g.strokeRect(BOARD_X - 4, BOARD_Y - 4, COLS * CELL + 8, ROWS * CELL + 8);
    }
  }

  private drawTimer(g: CanvasRenderingContext2D): void {
    const b = this.battle;
    if (!b.timed) return;
    const frac = Math.max(0, Math.min(1, b.timeLeftMs / b.timeLimitMs));
    const secs = Math.ceil(b.timeLeftMs / 1000);
    const w = 400;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(10, 10, w + 8, 30);
    g.fillStyle = frac > 0.25 ? '#4aa3ff' : '#ff5555';
    g.fillRect(14, 14, w * frac, 22);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 4;
    g.font = 'bold 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = `TIME ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    g.strokeText(label, 10 + (w + 8) / 2, 26);
    g.fillText(label, 10 + (w + 8) / 2, 26);
    g.restore();
  }

  private drawOverlay(g: CanvasRenderingContext2D): void {
    this.drawTimer(g);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (this.comboT > 0 && this.comboText) {
      g.save();
      g.globalAlpha = Math.min(1, this.comboT * 1.5);
      g.font = 'bold 54px system-ui, sans-serif';
      g.lineWidth = 8;
      g.strokeStyle = '#000';
      g.fillStyle = '#ffd23f';
      g.strokeText(this.comboText, STAGE_W / 2, BOARD_Y + 120);
      g.fillText(this.comboText, STAGE_W / 2, BOARD_Y + 120);
      g.restore();
    }
    for (const f of this.floats) {
      const a = 1 - f.t / f.life;
      g.save();
      g.globalAlpha = Math.min(1, a * 1.6);
      g.font = `bold ${f.size}px system-ui, sans-serif`;
      g.lineWidth = 6;
      g.strokeStyle = '#000';
      g.fillStyle = f.color;
      const y = f.y - f.t * 60;
      g.strokeText(f.text, f.x, y);
      g.fillText(f.text, f.x, y);
      g.restore();
    }
    if (this.banner) {
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, SCENE_H / 2 - 50, STAGE_W, 100);
      g.font = 'bold 56px system-ui, sans-serif';
      g.fillStyle = '#fff';
      g.fillText(this.banner, STAGE_W / 2, SCENE_H / 2);
      g.restore();
    }
    if (this.tipT > 0 && this.tip) {
      g.save();
      g.globalAlpha = Math.min(1, this.tipT * 2);
      g.font = 'bold 22px system-ui, sans-serif';
      const lines = wrapAll(g, this.tip, STAGE_W - 60).slice(0, 5); // two abilities can need five lines
      const h = lines.length * 28 + 16;
      g.fillStyle = 'rgba(0,0,0,0.72)';
      g.fillRect(20, SCENE_H - h - 8, STAGE_W - 40, h);
      g.fillStyle = '#fff';
      lines.forEach((l, i) => g.fillText(l, STAGE_W / 2, SCENE_H - h + 14 + i * 28));
      g.restore();
    } else if (this.state === 'idle' && this.battle.turn === 0 && !this.banner) {
      g.font = 'bold 24px system-ui, sans-serif';
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.fillStyle = '#fff';
      g.strokeText('Hold a gem and drag it around the board, then let go', STAGE_W / 2, SCENE_H - 22);
      g.fillText('Hold a gem and drag it around the board, then let go', STAGE_W / 2, SCENE_H - 22);
    }
  }
}

/** Word-wrap without a line cap (the tip box above caps itself at three lines). */
function wrapAll(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
