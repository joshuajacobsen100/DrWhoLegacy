import { DATA, unitMaxLevel, type UnitDef } from './data.ts';

export interface OwnedUnit {
  lv: number;
  xp: number;
  pts: number; // unspent attribute points (1 per level gained)
  hp: number; // points spent on HP (+10 each)
  atk: number; // points spent on ATK (+5 each)
  heal: number; // points spent on Heal (+3 each)
}

export interface SaveData {
  v: 1;
  owned: Record<string, OwnedUnit>;
  items: Record<string, number>; // fragments and Time Crystals (item id -> count)
  cleared: Record<string, number>; // level id -> times cleared
  team: number[]; // up to 5 unit ids, slot 0 is the Doctor
  unlockAll: boolean;
  muted: boolean;
  suits: number[]; // alternative outfits won (default outfits come with their unit)
  wear: Record<string, number>; // unit id -> outfit being worn (absent = default)
  perks: { chosen: Record<string, number>; bought: string[] }; // perk skill picked per group ("type:group" -> skill id) and groups bought with crystals
  daily: { last: string; day: number }; // date (local, YYYY-MM-DD) and day number (1-5) of the last daily bonus claimed
  crystalDrops: Record<string, number>; // level id -> Time Crystals that mission has dropped so far (missions cap this)
  dropBonus: number; // extra percentage points on unit and outfit drops: +0.3 per victory (max 15), halves each day away
  dropBonusAt: number; // when the bonus was last brought up to date (ms since epoch, 0 = never)
  settings: Settings;
  otb: number; // id of the One Turn Buff waiting for the next battle (0 = none)
}

/** Options. Volumes are 0-10 steps like the original's bars (default 7 = 0.7); gemSkin indexes DATA.gemSkins. */
export interface Settings {
  music: number;
  sfx: number;
  gemSkin: number;
  newsSeen: number; // id of the newest news item the player has opened
  otb: boolean; // roll a One Turn Buff after each victory (original option, on by default)
}

export const defaultSettings = (): Settings => ({ music: 7, sfx: 7, gemSkin: 0, newsSeen: 0, otb: true });

const KEY = 'dwl.save.v1';
export const TEAM_SIZE = 6; // the original team has six slots: the Doctor plus five allies
export const CRYSTAL = 45; // Time Crystals item id

export const newOwned = (lv = 1): OwnedUnit => ({ lv, xp: 0, pts: 0, hp: 0, atk: 0, heal: 0 });

/** XP needed to go from `level` to the next, from the unit's own exp table (original data). */
export function xpToNext(u: UnitDef, level: number): number {
  const table = DATA.exp[String(u.ex)];
  return table?.[level - 1] ?? Number.MAX_SAFE_INTEGER;
}

/** What a new game starts with (BagData.DefaultDoctorID / DefaultCompanionID): the Eleventh Doctor and Madame Vastra. */
export const DEFAULT_DOCTOR = 15;
export const DEFAULT_COMPANION = 29;

function starter(): SaveData {
  const owned: Record<string, OwnedUnit> = {};
  const team: number[] = [];
  // like the original: one Doctor, one ally, a team of two, nothing else (everything else is earned in missions)
  const doctor = DATA.units[DEFAULT_DOCTOR] ?? Object.values(DATA.units).find((u) => u.t === 1)!;
  const ally = DATA.units[DEFAULT_COMPANION] ?? Object.values(DATA.units).find((u) => u.t === 2 && u.lp.length)!;
  for (const u of [doctor, ally]) {
    owned[u.id] = newOwned(u.il);
    team.push(u.id);
  }
  return { v: 1, owned, items: {}, cleared: {}, team, unlockAll: false, muted: false, suits: [], wear: {}, perks: { chosen: {}, bought: [] }, daily: { last: '', day: 0 }, crystalDrops: {}, dropBonus: 0, dropBonusAt: 0, settings: defaultSettings(), otb: 0 };
}

export let SAVE: SaveData;

/** Fill in fields added after the first save format (older saves keep working). */
function normalize(s: SaveData): SaveData {
  s.items ??= {};
  s.suits ??= [];
  s.wear ??= {};
  s.daily ??= { last: '', day: 0 };
  s.perks ??= { chosen: {}, bought: [] };
  s.crystalDrops ??= {};
  s.dropBonus ??= 0;
  s.dropBonusAt ??= 0;
  s.settings = { ...defaultSettings(), ...(s.settings ?? {}) };
  s.otb ??= 0;
  for (const [id, o] of Object.entries(s.owned)) {
    s.owned[id] = { ...newOwned(o.lv ?? 1), ...o };
  }
  return s;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as SaveData;
      if (s && s.v === 1 && s.owned && s.team) {
        SAVE = normalize(s);
        return SAVE;
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to a fresh save */
  }
  SAVE = starter();
  return SAVE;
}

export function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(SAVE));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Load a save from text (a file the player exported). Returns an error message, or null when it was accepted.
 * The save is only replaced when it looks like one of ours.
 */
export function importSave(text: string): string | null {
  let s: SaveData;
  try {
    s = JSON.parse(text) as SaveData;
  } catch {
    return 'That file is not a save.';
  }
  if (!s || s.v !== 1 || typeof s.owned !== 'object' || !s.owned || !Array.isArray(s.team)) return 'That file is not a save from this game.';
  for (const id of Object.keys(s.owned)) if (!DATA.units[id]) delete s.owned[id]; // units this game does not know
  if (!Object.keys(s.owned).length) return 'That save has no units in it.';
  s.team = s.team.filter((id) => s.owned[id]).slice(0, TEAM_SIZE);
  if (!s.team.length) return 'That save has no usable team.';
  SAVE = normalize(s);
  persist();
  return null;
}

export const exportSave = (): string => JSON.stringify(SAVE, null, 1);

export function resetSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  SAVE = starter();
  persist();
}

/** Give a unit to the player (a new copy starts at its initial level). */
export function grantUnit(id: number): boolean {
  const u = DATA.units[String(id)];
  if (!u || SAVE.owned[id]) return false;
  SAVE.owned[id] = newOwned(u.il);
  return true;
}

export const itemCount = (id: number): number => SAVE.items[id] ?? 0;

export function addItem(id: number, n = 1): void {
  SAVE.items[id] = itemCount(id) + n;
}

export function spendItem(id: number, n: number): boolean {
  if (itemCount(id) < n) return false;
  SAVE.items[id] = itemCount(id) - n;
  if (SAVE.items[id] === 0) delete SAVE.items[id];
  return true;
}

/** Battle XP for an ally. Every level gained is worth one attribute point. Returns levels gained. */
export function addXp(id: number, xp: number): number {
  const o = SAVE.owned[id];
  const u = DATA.units[String(id)];
  if (!o || !u || u.t === 1) return 0; // the Doctor does not level from battles
  const max = unitMaxLevel(u);
  let gained = 0;
  o.xp += xp;
  while (o.lv < max && o.xp >= xpToNext(u, o.lv)) {
    o.xp -= xpToNext(u, o.lv);
    o.lv++;
    o.pts++;
    gained++;
  }
  if (o.lv >= max) o.xp = 0;
  return gained;
}
