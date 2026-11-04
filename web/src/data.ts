import type { DropRow, EnemyDef, TypeRel, UnitStats } from './engine/battle.ts';
import type { Weights } from './engine/board.ts';

export interface UnitDef {
  id: number;
  n: string;
  t: number; // 1 = Doctor, 2 = ally
  r: number; // rank (stars)
  a: number[]; // colour slots
  il: number; // initial level
  ml: number; // max level
  suit: number; // art id of the default outfit (0 = none)
  ss: number[]; // alternative outfits this unit can wear
  et: number; // evolution target unit id (0 = final rank)
  ei: [number, number][]; // evolution recipe: [item id, count]
  ec: number; // Time Crystals for an instant evolution
  adr: number; // extra levels counted when deriving the Doctor's level
  ex: number; // exp table id
  g: number; // family group (0 = its own id); a family can only be owned once
  lp: [number, number, number, number][]; // per level: hp, minAtk, maxAtk, heal
  ab: { n: string; d: string; cd: number; t: string; p: string[]; i: number }[];
}

export interface SuitDef {
  n: string;
  img: string;
}

export interface DailyBonusDef {
  item_type: number;
  item_id: number;
  day: number;
  count: number;
}

export interface ItemDef {
  id: number;
  n: string;
  t: number; // 3 fragment, 4 currency
  icon: string | null;
}

export interface EnemyTpl {
  img: number;
  w: number;
  h: number;
  n: string;
}

export interface SceneImg {
  id: number;
  width: number;
  height: number;
  pos_x: number;
  pos_y: number;
  depth: number;
  an_x: number;
  an_y: number;
}

export interface LevelEnemyMod {
  e: number;
  hp: number;
  atk: number;
  cd: number;
  def: number;
  at: number;
  ab: { n: string; cd: number; t: string; p: string[]; r: number; c: number; h: number; i: number }[];
  dr: DropRow[]; // drop card rows
  dm: number; // 1 = "multi" drop rule
}

export interface LevelDef {
  id: number;
  n: string;
  xp: number;
  lt: number;
  lc: number;
  cl: number; // most Time Crystals this mission can ever drop (0 = no limit)
  gems: [number, number][];
  em: Record<string, LevelEnemyMod>;
  w: { sc: number; boss: number; en: [number, number, number][]; grid?: [number, number, number][] }[];
  team: number[];
}

/** One Tardis season: its roll pool is rows of [type, id, chance %], type 1 = unit, 9 = outfit. */
export interface TardisSeasonDef {
  n: string;
  bind: string; // season name
  roll: number; // 1 = rollable in the shop
  multi: number;
  pool: [number, number, number][];
  paSuit: number; // chance added to every outfit in the pool
  paChar: Record<string, number>; // chance added to units by colour
}

/** A One Turn Buff: a random bonus for the next battle. `buffs` are percentages by what they raise. */
export interface OtbDef {
  id: number;
  n: string;
  chance: number; // out of 100
  desc: string;
  img: string | null;
  buffs: { atk?: number; heal?: number; hp?: number; drop?: number };
}

/** A gem look: its name, the gem id shown as its icon and the six gem ids it uses (empty = the level's own). */
export interface GemSkinDef {
  n: string;
  id: number;
  gems: number[];
}

/** A purchase set: units, outfits and items sold together. Items are [type, id, count], type 21 = unit/item, 25 = outfit. */
export interface SetDef {
  id: number;
  n: string;
  it: [number, number, number][];
}

export interface FlowNode {
  name: string;
  id: number;
  levels?: FlowNode[];
}

export interface GameData {
  args: Record<string, string>;
  typeRel: TypeRel;
  gemAttr: Record<string, number>; // gem skin id -> colour 1-6 (7 = useless gem)
  obstacles: Record<string, number>; // preset-grid value -> crack image id
  exp: Record<string, number[]>; // exp table id -> XP to next level, index = level - 1
  items: Record<string, ItemDef>; // fragments and currencies
  suits: Record<string, SuitDef>; // outfits (wardrobe)
  dailyBonus: DailyBonusDef[];
  perks: unknown[]; // perk types (see perkbook.ts)
  tardis: TardisSeasonDef[];
  sets: SetDef[];
  fragLimit: number; // most of one Time Fragment the player can hold (0 = no limit)
  otb: { except: number[]; list: OtbDef[] }; // One Turn Buffs and the missions that never roll one
  gemSkins: GemSkinDef[]; // gem looks for the options (the first is the default)
  tips: Record<string, string[]>; // the original's own hint lines, by menu
  units: Record<string, UnitDef>;
  enemies: Record<string, EnemyTpl>;
  scenes: Record<string, { bg: SceneImg[]; fg: SceneImg[] }>;
  levels: Record<string, LevelDef>;
  flow: FlowNode[];
}

export let DATA: GameData;

export async function loadData(): Promise<GameData> {
  const res = await fetch('data/gamedata.json');
  DATA = (await res.json()) as GameData;
  return DATA;
}

export const GEM_NAMES = ['', 'Red', 'Blue', 'Yellow', 'Green', 'Black', 'Pink'];
export const GEM_CSS = ['#888', '#e5484d', '#3e7bfa', '#f5d90a', '#30a46c', '#6b6b78', '#ff7ac6'];

export function unitMaxLevel(u: UnitDef): number {
  return Math.min(u.ml, u.lp.length);
}

export function unitIcon(u: UnitDef | undefined, square = true, suit = 0): string | null {
  const worn = suit && DATA.suits?.[String(suit)] ? suit : u?.suit;
  if (!u || !worn) return null;
  return `img/unit/${worn}_${square ? 'sq' : 'icon'}.png`;
}

/** Per-point stat bonuses from the original (UnitAttributeFactor). */
export const POINT_VALUE = { hp: 10, atk: 5, heal: 3 };

export interface PointsSpent {
  hp: number;
  atk: number;
  heal: number;
}

export function statsAt(u: UnitDef, level: number, pts?: PointsSpent): UnitStats {
  const lv = Math.max(1, Math.min(level, unitMaxLevel(u)));
  const p = u.lp[lv - 1];
  return {
    uid: u.id,
    name: u.n,
    colors: u.a.length ? u.a : [1],
    hp: p[0] + (pts ? pts.hp * POINT_VALUE.hp : 0),
    atk: Math.trunc((p[1] + p[2]) / 2) + (pts ? pts.atk * POINT_VALUE.atk : 0),
    heal: Math.trunc(p[3]) + (pts ? pts.heal * POINT_VALUE.heal : 0),
    isDoctor: u.t === 1,
    icon: unitIcon(u),
    // like the original: the Doctor can have two abilities, allies one (we use the first)
    abilities: u.ab.slice(0, u.t === 1 ? 2 : 1).map((a) => ({
      n: a.n,
      d: a.d,
      cd: a.cd,
      t: Number(a.t),
      p: a.p,
      icon: a.i ? `img/ability/${a.i}.png` : null,
    })),
  };
}

/** Colour a gem id plays as (skins 8-115 are art variants of colours 1-6; 7 is the useless gem). */
export function gemColor(id: number): number {
  return DATA.gemAttr[String(id)] ?? (id >= 1 && id <= 7 ? id : 0);
}

/** Gem spawn weights for a level, merged by colour so skins share their colour's chance. */
export function gemWeights(lv: LevelDef): Weights {
  const byColor = new Map<number, number>();
  for (const [id, rate] of lv.gems) {
    const c = gemColor(id);
    if (c >= 1 && c <= 7 && rate > 0) byColor.set(c, (byColor.get(c) ?? 0) + rate);
  }
  const playable = [...byColor.keys()].filter((c) => c <= 6).length;
  return playable >= 3 ? ([...byColor.entries()] as Weights) : [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
}

/**
 * Which gem image each colour uses in this level: the first listed gem id with that colour (as the original). A gem
 * look chosen in the options (`look` = the six gem ids of a DATA.gemSkins entry) replaces the art of every colour it
 * covers that the level uses (LevelBuilder.buildLevel).
 */
export function gemSkins(lv: LevelDef, look: number[] = []): Record<number, number> {
  const skins: Record<number, number> = {};
  // a level with no gem list of its own uses the six plain gems (LevelBuilder.buildLevel), so a look still applies there
  const own = lv.gems.length ? lv.gems.map(([id]) => id) : [1, 2, 3, 4, 5, 6];
  for (const id of own) {
    const c = gemColor(id);
    if (c >= 1 && c <= 7 && skins[c] === undefined) skins[c] = id;
  }
  for (const id of look) {
    const c = gemColor(id);
    if (skins[c] !== undefined) skins[c] = id;
  }
  return skins;
}

/** Per-wave crack obstacle cells. */
export function buildGrids(lv: LevelDef): ([number, number, number][] | null)[] {
  return lv.w.map((w) => w.grid ?? null);
}

export function crackImage(obstacleId: number): string {
  return `img/gems/crack${DATA.obstacles[String(obstacleId)] ?? 1}.png`;
}

function enemyDef(lv: LevelDef, id: number, x: number, y: number): EnemyDef {
  const m = lv.em[String(id)];
  const tpl = DATA.enemies[String(m.e)];
  return {
    hp: m.hp,
    atk: m.atk,
    cd: Math.max(0, m.cd),
    def: m.def,
    color: m.at,
    name: tpl?.n ?? 'Enemy',
    img: tpl?.img ? `img/enemy/${tpl.img}.png` : null,
    w: tpl?.w ?? 120,
    h: tpl?.h ?? 160,
    x,
    y,
    drops: m.dr,
    dropMulti: m.dm === 1,
    abilities: m.ab.map((a) => ({
      n: a.n,
      cd: a.cd,
      t: Number(a.t),
      p: a.p,
      r: a.r,
      c: a.c,
      h: a.h,
      icon: a.i ? `img/ability/${a.i}.png` : null,
    })),
  };
}

export function buildWaves(lv: LevelDef): EnemyDef[][] {
  return lv.w.map((wave) => wave.en.map(([id, x, y]) => enemyDef(lv, id, x, y)));
}

/** Enemy definitions by level enemy id, used by the "spawn" abilities. */
export function buildSpawnDefs(lv: LevelDef): Record<number, EnemyDef> {
  const out: Record<number, EnemyDef> = {};
  for (const id of Object.keys(lv.em)) out[+id] = enemyDef(lv, +id, 0, 0);
  return out;
}

export function levelTitle(name: string): { tag: string; title: string } {
  const i = name.indexOf('##');
  return i < 0 ? { tag: '', title: name } : { tag: name.slice(0, i).trim(), title: name.slice(i + 2).trim() };
}

/** Flatten the level-flow tree into seasons -> groups -> level ids (skips test/placeholder nodes). */
export interface FlowSeason {
  name: string;
  groups: { name: string; levels: { id: number; name: string }[] }[];
}

export function flowSeasons(): FlowSeason[] {
  const out: FlowSeason[] = [];
  for (const s of DATA.flow) {
    if (/test/i.test(s.name)) continue;
    const groups: FlowSeason['groups'] = [];
    const walk = (n: FlowNode, path: string) => {
      if (n.levels && n.levels.length) {
        for (const c of n.levels) walk(c, n.name);
      } else if (n.id && DATA.levels[String(n.id)] && !/\(X\)/.test(n.name)) {
        let g = groups.find((x) => x.name === path);
        if (!g) groups.push((g = { name: path, levels: [] }));
        g.levels.push({ id: n.id, name: n.name });
      }
    };
    for (const c of s.levels ?? []) walk(c, s.name);
    if (groups.length) out.push({ name: s.name, groups });
  }
  return out;
}
