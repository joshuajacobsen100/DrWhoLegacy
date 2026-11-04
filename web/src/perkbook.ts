// Perks: which groups the player has unlocked, which skill they picked in each, and the effects that result.
// Rules from the original (PerkSkillMenu, PerkSelectMenu, ChosePerkList, PerkData):
//  - a perk TYPE is open unless it belongs to a season you have not finished (Perk 2 = Season 7, Perk 3 = Season 6);
//  - a GROUP opens once your stars (the summed rank of every unit you own) reach its star cost, or once bought
//    with Time Crystals; you pick one skill (or none) in each open group.
// Purchases are approved automatically in this port: buying a group never checks or spends Time Crystals.
import { DATA, flowSeasons } from './data.ts';
import { SAVE } from './save.ts';
import { compilePerks, type PerkFn, type PerkFx } from './engine/perks.ts';

export interface PerkSkillDef {
  id: number;
  n: string;
  d: string;
  img: string | null;
  fx: PerkFn[];
}
export interface PerkGroupDef {
  id: number;
  n: string;
  star: number;
  cry: number;
  skills: PerkSkillDef[];
}
export interface PerkTypeDef {
  id: number;
  n: string;
  groups: PerkGroupDef[];
}

export const perkTypes = (): PerkTypeDef[] => (DATA.perks ?? []) as PerkTypeDef[];

const key = (type: number, group: number) => `${type}:${group}`;

/** The season that has to be finished before a perk type opens (original PerkData.GetSeasonString). */
export function seasonFor(type: number): string {
  return type === 2 ? 'Season 7' : type === 3 ? 'Season 6' : '';
}

/** Stars: the summed rank of every unit owned (original BagData.CalculateStarNumber). */
export function starCount(): number {
  return Object.keys(SAVE.owned).reduce((n, id) => n + (DATA.units[id]?.r ?? 0), 0);
}

/** Every playable mission in the season has been cleared at least once. */
export function seasonFinished(name: string): boolean {
  if (!name || SAVE.unlockAll) return true;
  const s = flowSeasons().find((x) => x.name === name);
  if (!s) return false;
  return s.groups.every((g) => g.levels.every((l) => (SAVE.cleared[l.id] ?? 0) > 0));
}

export const typeUnlocked = (type: number): boolean => seasonFinished(seasonFor(type));

export function groupBought(type: number, group: number): boolean {
  return SAVE.perks.bought.includes(key(type, group));
}

export function groupUnlocked(type: number, group: number): boolean {
  const g = perkTypes().find((t) => t.id === type)?.groups.find((x) => x.id === group);
  if (!g) return false;
  if (g.star !== 0 && starCount() >= g.star) return true;
  return groupBought(type, group);
}

/** Buy a group with Time Crystals. In this port the purchase is always approved and free. */
export function unlockGroup(type: number, group: number): boolean {
  const g = perkTypes().find((t) => t.id === type)?.groups.find((x) => x.id === group);
  if (!g || groupUnlocked(type, group)) return false;
  if (g.cry === 0 && g.star !== 0) return false; // star groups open with stars only
  SAVE.perks.bought.push(key(type, group));
  return true;
}

export const chosenSkill = (type: number, group: number): number => SAVE.perks.chosen[key(type, group)] ?? 0;

export function chooseSkill(type: number, group: number, skill: number): boolean {
  const g = perkTypes().find((t) => t.id === type)?.groups.find((x) => x.id === group);
  if (!g || !typeUnlocked(type) || !groupUnlocked(type, group)) return false;
  if (skill !== 0 && !g.skills.some((s) => s.id === skill)) return false;
  if (skill === 0) delete SAVE.perks.chosen[key(type, group)];
  else SAVE.perks.chosen[key(type, group)] = skill;
  return true;
}

/** The functions of every skill that is picked in a group that is open right now. */
export function activePerkFns(): PerkFn[] {
  const out: PerkFn[] = [];
  for (const t of perkTypes()) {
    if (!typeUnlocked(t.id)) continue;
    for (const g of t.groups) {
      if (!groupUnlocked(t.id, g.id)) continue;
      const sk = g.skills.find((s) => s.id === chosenSkill(t.id, g.id));
      if (sk) out.push(...sk.fx);
    }
  }
  return out;
}

export const activePerks = (): PerkFx => compilePerks(activePerkFns());
