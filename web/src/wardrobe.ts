// Outfits ("suits"). In the original they are purely cosmetic: every unit comes with a default outfit, other outfits
// are won (mission drops, Tardis rolls and sets; see drops.ts and tardis.ts) and can be worn by the units that list them (UnitContent.suits).
import { DATA } from './data.ts';
import { SAVE } from './save.ts';

const def = (id: number) => DATA.units[String(id)];

export function ownsSuit(suitId: number): boolean {
  return SAVE.suits.includes(suitId);
}

/** Outfits a unit can wear right now: its own default plus any alternative the player has won. */
export function ownedSuits(unitId: number): number[] {
  const u = def(unitId);
  if (!u) return [];
  return [...(u.suit ? [u.suit] : []), ...u.ss.filter(ownsSuit)];
}

/** The outfit a unit is shown in (falls back to the default if the saved one is no longer valid). */
export function wornSuit(unitId: number): number {
  const u = def(unitId);
  if (!u) return 0;
  const w = SAVE.wear[unitId];
  return w && ownedSuits(unitId).includes(w) ? w : u.suit;
}

export function wearSuit(unitId: number, suitId: number): boolean {
  if (!ownedSuits(unitId).includes(suitId)) return false;
  const u = def(unitId);
  if (suitId === u.suit) delete SAVE.wear[unitId];
  else SAVE.wear[unitId] = suitId;
  return true;
}

export function grantSuit(suitId: number): boolean {
  if (!DATA.suits[String(suitId)] || ownsSuit(suitId)) return false;
  SAVE.suits.push(suitId);
  return true;
}

/** Square icon for a unit in the outfit it wears. */
export function unitSuitImg(unitId: number): string | null {
  const s = DATA.suits[String(wornSuit(unitId))];
  return s ? s.img : null;
}
