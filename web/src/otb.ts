// One Turn Buffs, ported from OTBSystem / ResultMenu / LeaveSceneState / LevelScene / DropBuilder.
// After a victory the game rolls one random buff (attack, heal, max HP or drop rate, or all four). It applies to the next
// battle only: leaving any battle clears it, and a victory (when the option is on) rolls a fresh one.
import { DATA, type OtbDef } from './data.ts';
import type { OtbFx } from './engine/battle.ts';
import { SAVE } from './save.ts';

export const otbList = (): OtbDef[] => DATA.otb?.list ?? [];

/** The buff waiting for the next battle, if any. */
export function activeOtb(): OtbDef | null {
  return SAVE.otb ? otbList().find((o) => o.id === SAVE.otb) ?? null : null;
}

/** Missions that never roll a new buff (the tutorial, story chapters and the like). */
export const otbExempt = (levelId: number): boolean => (DATA.otb?.except ?? []).includes(levelId);

/**
 * OTBSystem.GetRandBuff: a dice of 0-99 against the running total of the chances, taking the first buff whose total the
 * dice does not pass (`<=`, as in the original, so the first buff gets 18 of the 100 faces instead of 17).
 */
export function rollOtb(rand: () => number): OtbDef | null {
  const dice = Math.floor(rand() * 100);
  let total = 0;
  for (const o of otbList()) {
    total += o.chance;
    if (dice <= total) return o;
  }
  return null;
}

/** What a buff does to a battle, as fractions for the engine. */
export function otbFx(o: OtbDef | null): OtbFx {
  const b = o?.buffs ?? {};
  return { atk: (b.atk ?? 0) / 100, heal: (b.heal ?? 0) / 100, hp: (b.hp ?? 0) / 100 };
}

/** Points added to every drop row while the buff is active. */
export const otbDropPoints = (o: OtbDef | null): number => o?.buffs.drop ?? 0;

/** A short line for what a buff gives, e.g. "+5% attack, +10% max HP". */
export function otbSummary(o: OtbDef): string {
  const b = o.buffs;
  const parts: string[] = [];
  if (b.atk) parts.push(`+${b.atk}% attack`);
  if (b.heal) parts.push(`+${b.heal}% healing`);
  if (b.hp) parts.push(`+${b.hp}% max HP`);
  if (b.drop) parts.push(`+${b.drop}% drop rate`);
  return parts.join(', ');
}

/**
 * A battle has ended (won, lost or left). The buff that was used is gone; after a victory, with the option on and a
 * mission that allows it, a new one is rolled. Returns the new buff, if any.
 */
export function settleOtb(levelId: number, victory: boolean, rand: () => number = Math.random): OtbDef | null {
  SAVE.otb = 0;
  if (!victory || !SAVE.settings.otb || otbExempt(levelId)) return null;
  const o = rollOtb(rand);
  SAVE.otb = o?.id ?? 0;
  return o;
}
