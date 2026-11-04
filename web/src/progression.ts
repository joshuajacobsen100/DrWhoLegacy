// Unit progression rules ported from the original (UnitPropertyComposor, UpgradeMenu, UpgradeAttributeMenu, BagData).
import { DATA, statsAt, unitMaxLevel, type UnitDef } from './data.ts';
import type { UnitStats } from './engine/battle.ts';
import { DEFAULT_COMPANION, DEFAULT_DOCTOR, SAVE, TEAM_SIZE, itemCount, newOwned, spendItem, type OwnedUnit } from './save.ts';
import { unitSuitImg } from './wardrobe.ts';

export type Stat = 'hp' | 'atk' | 'heal';

const def = (id: number): UnitDef | undefined => DATA.units[String(id)];

/**
 * The Doctor does not level from battles. Its level is the rank-weighted average of the allies' levels,
 * divided by the Doctor's own rank, clamped to the Doctor's level range (ComputeDoctorLevel).
 */
export function doctorLevel(team: number[]): number {
  const doc = def(team[0]);
  if (!doc) return 1;
  let n = 0;
  let sum = 0;
  for (const id of team.slice(1)) {
    const u = def(id);
    const o = SAVE.owned[id];
    if (!u || !o) continue;
    n++;
    sum += u.r * (o.lv + u.adr);
  }
  let lv = 0;
  if (n > 0) lv = Math.trunc(Math.trunc(sum / doc.r) / n);
  if (lv < doc.il) lv = doc.il;
  else if (lv > unitMaxLevel(doc)) lv = unitMaxLevel(doc);
  return lv;
}

/** The level a unit actually fights at: derived for the Doctor, earned for allies. */
export function effectiveLevel(id: number, team: number[] = SAVE.team): number {
  const u = def(id);
  if (!u) return 1;
  return u.t === 1 ? doctorLevel(team.length && team[0] === id ? team : [id, ...team.slice(1)]) : SAVE.owned[id]?.lv ?? u.il;
}

/** Battle stats for one unit (level, plus spent attribute points for allies). */
export function unitStatsFor(id: number, team: number[] = SAVE.team): UnitStats | null {
  const u = def(id);
  const o = SAVE.owned[id];
  if (!u || !o) return null;
  const st = u.t === 1 ? statsAt(u, doctorLevel([id, ...team.slice(1)])) : statsAt(u, o.lv, o);
  st.icon = unitSuitImg(id) ?? st.icon; // the outfit being worn
  return st;
}

export function teamStats(team: number[] = SAVE.team): UnitStats[] {
  return team.flatMap((id) => {
    const s = unitStatsFor(id, team);
    return s ? [s] : [];
  });
}

// ------------------------------------------------------------------ attribute points
export function spendPoint(id: number, stat: Stat): boolean {
  const u = def(id);
  const o = SAVE.owned[id];
  if (!u || !o || u.t === 1 || o.pts <= 0) return false; // allies only
  o[stat]++;
  o.pts--;
  return true;
}

/** Refund every spent point. The original charged one Time Crystal; here it is free. */
export function resetPoints(id: number): boolean {
  const o = SAVE.owned[id];
  if (!o || o.hp + o.atk + o.heal === 0) return false;
  o.pts += o.hp + o.atk + o.heal;
  o.hp = o.atk = o.heal = 0;
  return true;
}

/**
 * Take an ally straight to its level cap, as the original's "instant level max" did (it cost Time Crystals there; free here).
 * Every level gained is worth one attribute point. Returns the levels gained.
 */
export function maxLevelNow(id: number): number {
  const u = def(id);
  const o = SAVE.owned[id];
  if (!u || !o || u.t === 1) return 0; // the Doctor's level comes from the allies
  const gained = unitMaxLevel(u) - o.lv;
  if (gained <= 0) return 0;
  o.lv += gained;
  o.pts += gained;
  o.xp = 0;
  return gained;
}

// ------------------------------------------------------------------ evolution (rank up)
export interface EvoStatus {
  target: UnitDef | null;
  levelOk: boolean; // allies must be at their level cap first (the Doctor has no such rule)
  items: { id: number; need: number; have: number }[];
  itemsOk: boolean;
  canEvolve: boolean; // with fragments
  canInstant: boolean; // skipping the fragments: the original charged Time Crystals, here it is free
}

export function evoStatus(id: number): EvoStatus | null {
  const u = def(id);
  const o = SAVE.owned[id];
  if (!u || !o) return null;
  const target = u.et ? def(u.et) ?? null : null;
  const levelOk = u.t === 1 || o.lv >= unitMaxLevel(u);
  const items = u.ei.map(([iid, need]) => ({ id: iid, need, have: itemCount(iid) }));
  const itemsOk = items.every((i) => i.have >= i.need);
  return {
    target,
    levelOk,
    items,
    itemsOk,
    canEvolve: !!target && levelOk && itemsOk,
    canInstant: !!target && levelOk,
  };
}

/**
 * Rank a unit up into its evolution target. The new unit starts at its own initial level, keeps the
 * attribute points of the old one, and takes its slot in the team. Returns the new unit id, or 0.
 */
export function evolve(id: number, instant: boolean): number {
  const st = evoStatus(id);
  if (!st || !st.target) return 0;
  if (instant ? !st.canInstant : !st.canEvolve) return 0;
  if (!instant) for (const i of st.items) spendItem(i.id, i.need);
  const old = SAVE.owned[id];
  const next = st.target;
  const had = SAVE.owned[next.id];
  const fresh: OwnedUnit = { ...newOwned(next.il), pts: old.pts, hp: old.hp, atk: old.atk, heal: old.heal };
  // if the target somehow already exists, keep the stronger bonus allocation
  if (had && had.hp + had.atk + had.heal + had.pts > fresh.hp + fresh.atk + fresh.heal + fresh.pts) Object.assign(fresh, { pts: had.pts, hp: had.hp, atk: had.atk, heal: had.heal });
  SAVE.owned[next.id] = fresh;
  delete SAVE.owned[id];
  delete SAVE.wear[id]; // like the original, the evolved unit starts in its default outfit
  SAVE.team = SAVE.team.map((t) => (t === id ? next.id : t)).slice(0, TEAM_SIZE);
  return next.id;
}

// ------------------------------------------------------------------ the scripted tutorial
/** Season 7's first mission is a scripted tutorial played with the original new-game party. */
export const TUTORIAL_LEVEL = 18;
export const TUTORIAL_TEAM = [DEFAULT_DOCTOR, DEFAULT_COMPANION]; // the same pair a new game starts with

/**
 * A brand-new game goes straight into the tutorial (LoadingScene.StartTutorialOrMainScene) and keeps doing so until it has
 * been cleared; a player with any progress, or with every level unlocked, is never sent there.
 */
export function needsTutorial(): boolean {
  return !SAVE.unlockAll && Object.keys(SAVE.cleared).length === 0;
}

export function tutorialTeamStats(): UnitStats[] {
  return TUTORIAL_TEAM.flatMap((id) => {
    const u = def(id);
    return u ? [statsAt(u, u.il)] : [];
  });
}
