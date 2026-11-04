// Mission drops and the rules about what can be owned, ported from the original
// (BaseDropCard.checkpacket, DropCardSingleRate / DropCardMultiRate, BagData.canPutInBagMore / canGetSuit,
// ContentRule.canGetSameOne, UserData.canDropMoreCrystal, DropBuilder / Victorystate drop-rate bonus).
import { DATA, type UnitDef } from './data.ts';
import type { DropCard, DropRow } from './engine/battle.ts';
import { CRYSTAL, SAVE, addItem, grantUnit, itemCount } from './save.ts';
import { grantSuit } from './wardrobe.ts';

/** Something a mission or the Tardis can hand over. Units and items share one id space; outfits have their own. */
export type Gift = { kind: 'unit' | 'item' | 'suit'; id: number };

const unitDef = (id: number): UnitDef | undefined => DATA.units[String(id)];
const family = (u: UnitDef): number => u.g || u.id;

/** Turn a data row (type 1 = unit or item id, 9 = outfit id) into a gift, or null when the id is unknown. */
export function giftFromRow(type: number, id: number): Gift | null {
  if (!id) return null;
  if (type === 9) return DATA.suits[String(id)] ? { kind: 'suit', id } : null;
  if (type === 1 || type === 21) {
    if (unitDef(id)) return { kind: 'unit', id };
    if (DATA.items[String(id)]) return { kind: 'item', id };
  }
  return null;
}

// ------------------------------------------------------------------ what the player can still receive
/**
 * Can this unit be owned? A family (`group`) can only be owned once. With `levelRule` (mission drops, sets) a higher-rank
 * member of a family may still arrive when the player only owns a lower-rank one; the Tardis never does that.
 */
export function canGetUnit(id: number, levelRule: boolean): boolean {
  const x = unitDef(id);
  if (!x) return false;
  for (const oid of Object.keys(SAVE.owned)) {
    const o = unitDef(Number(oid));
    if (!o || o.t !== x.t || family(o) !== family(x)) continue;
    if (levelRule && o.id !== x.id && o.il < x.il) continue;
    return false;
  }
  return true;
}

/** An outfit is owned when it was won, or when it is the default outfit of a unit the player owns. */
export function ownsOutfit(suit: number): boolean {
  return SAVE.suits.includes(suit) || Object.keys(SAVE.owned).some((uid) => unitDef(Number(uid))?.suit === suit);
}

/** An outfit can only arrive if the player owns a unit that can wear it (BagData.canGetSuit). */
export function canWearOutfit(suit: number): boolean {
  return Object.keys(SAVE.owned).some((uid) => {
    const u = unitDef(Number(uid));
    return !!u && (u.suit === suit || u.ss.includes(suit));
  });
}

export const isFragment = (id: number): boolean => DATA.items[String(id)]?.t === 3;

/** Room for `n` more of a Time Fragment (the original caps them, 250 by default). */
export function canHoldFragments(id: number, n: number): boolean {
  const lim = DATA.fragLimit;
  return !(lim > 0 && itemCount(id) + n > lim);
}

export function canDropMoreCrystal(levelId: number, count = 1): boolean {
  const lim = DATA.levels[String(levelId)]?.cl ?? 0;
  if (lim <= 0) return true;
  return (SAVE.crystalDrops[levelId] ?? 0) + count <= lim;
}

/** canGetSameOne between two gifts of one run: no two units of a family, no outfit twice. */
function compatible(a: Gift, b: Gift): boolean {
  if (a.kind !== b.kind) return true;
  if (a.kind === 'unit') {
    const x = unitDef(a.id);
    const y = unitDef(b.id);
    if (!x || !y) return true;
    return x.t !== y.t || family(x) !== family(y);
  }
  if (a.kind === 'suit') return a.id !== b.id;
  return true;
}

/** BaseDropCard.checkpacket: may this gift drop right now, given what this run already dropped? */
export function giftAllowed(g: Gift, run: Gift[], levelId: number): boolean {
  if (g.kind === 'item') {
    const n = run.filter((x) => x.kind === 'item' && x.id === g.id).length + 1;
    if (g.id === CRYSTAL && !canDropMoreCrystal(levelId, n)) return false;
    if (isFragment(g.id) && !canHoldFragments(g.id, n)) return false;
  }
  if (g.kind === 'unit' && !canGetUnit(g.id, true)) return false;
  if (g.kind === 'suit' && (ownsOutfit(g.id) || !canWearOutfit(g.id))) return false;
  return run.every((o) => compatible(g, o));
}

// ------------------------------------------------------------------ the drop-rate bonus
const DAY_MS = 86_400_000;
export const DROP_BONUS_STEP = 0.3;
export const DROP_BONUS_MAX = 15;

/** Every day away halves the bonus (and under 1 it is gone); the stamp is moved to now (Main.checkIncDropRateTime). */
export function refreshDropBonus(now = Date.now()): void {
  if (SAVE.dropBonusAt > 0) {
    const days = Math.floor((now - SAVE.dropBonusAt) / DAY_MS);
    for (let i = 0; i < days; i++) {
      SAVE.dropBonus /= 2;
      if (SAVE.dropBonus < 1) {
        SAVE.dropBonus = 0;
        break;
      }
    }
  }
  SAVE.dropBonusAt = now;
}

/** Each victory raises the chance of unit and outfit drops by 0.3 points, up to 15 (Victorystate). */
export function raiseDropBonus(): void {
  SAVE.dropBonus = Math.min(DROP_BONUS_MAX, SAVE.dropBonus + DROP_BONUS_STEP);
}

/**
 * A row's drop chance in percent: the data value, plus the bonus for units and outfits, plus the One Turn Buff's drop
 * points (`extra`, added to every row), truncated once like the original (DropBuilder.buildDropCard).
 */
export function rowChance(row: DropRow, extra = 0): number {
  let c = row[2];
  if (SAVE.dropBonus > 0) {
    const u = row[0] === 1 ? unitDef(row[1]) : undefined;
    if (row[0] === 9 || (u && (u.t === 1 || u.t === 2))) c += SAVE.dropBonus;
  }
  return Math.trunc(c + extra);
}

// ------------------------------------------------------------------ rolling a card
function giftOfRow(row: DropRow, rand: () => number): Gift | null {
  if (row[0] === 4) {
    const frags = Object.values(DATA.items).filter((i) => i.t === 3);
    return frags.length ? { kind: 'item', id: frags[Math.min(frags.length - 1, Math.floor(rand() * frags.length))].id } : null;
  }
  return giftFromRow(row[0], row[1]);
}

/**
 * Roll one drop card. "single" cards roll each row in turn and the first allowed hit wins; "multi" cards roll one
 * dice over the running total of the chances. A row that hits but is not allowed falls through to the next one.
 * A row's follow-on card is rolled after it; the last gift of the chain is the result.
 */
export function rollCard(card: DropCard, run: Gift[], levelId: number, rand: () => number = Math.random, extra = 0): Gift | null {
  const take = (row: DropRow): { gift: Gift | null; ok: boolean } => {
    const gift = giftOfRow(row, rand);
    return { gift, ok: !!gift && giftAllowed(gift, run, levelId) };
  };
  let hit: { row: DropRow; gift: Gift } | null = null;
  if (card.m) {
    const dice = rand() * 100;
    let total = 0;
    for (const row of card.r) {
      total += rowChance(row, extra);
      if (dice < total) {
        const t = take(row);
        if (t.ok) {
          hit = { row, gift: t.gift! };
          break;
        }
      }
    }
  } else {
    for (const row of card.r) {
      if (rand() * 100 >= rowChance(row, extra)) continue;
      const t = take(row);
      if (t.ok) {
        hit = { row, gift: t.gift! };
        break;
      }
    }
  }
  if (!hit) return null;
  const next = hit.row[3];
  if (next) {
    const later = rollCard(next, [...run, hit.gift], levelId, rand, extra);
    if (later) return later;
  }
  return hit.gift;
}

/** What one defeated enemy drops (at most one gift per card). */
export function rollEnemyDrop(rows: DropRow[], multi: boolean, run: Gift[], levelId: number, rand: () => number = Math.random, extra = 0): Gift | null {
  return rollCard({ m: multi ? 1 : 0, r: rows }, run, levelId, rand, extra);
}

// ------------------------------------------------------------------ receiving gifts
/** Put a gift in the player's bag. Returns false if it could not be received (already owned, no room). */
export function receiveGift(g: Gift): boolean {
  if (g.kind === 'unit') return grantUnit(g.id);
  if (g.kind === 'suit') return grantSuit(g.id);
  if (isFragment(g.id) && !canHoldFragments(g.id, 1)) return false;
  addItem(g.id, 1);
  return true;
}

/** After a victory: count the crystals against the mission's cap and raise the drop-rate bonus. */
export function recordVictory(levelId: number, gifts: Gift[]): void {
  const lim = DATA.levels[String(levelId)]?.cl ?? 0;
  const crystals = gifts.filter((g) => g.kind === 'item' && g.id === CRYSTAL).length;
  if (lim > 0 && crystals > 0) SAVE.crystalDrops[levelId] = (SAVE.crystalDrops[levelId] ?? 0) + crystals;
  raiseDropBonus();
}
