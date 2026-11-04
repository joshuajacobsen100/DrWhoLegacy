// The Tardis shop, ported from InAppPurchaseMenu / LoadingScene / SeasonConfigContent:
//  - a season roll hands out one unit or outfit, picked by weight from that season's list;
//  - purchase sets hand over a bundle of units, outfits and items.
// Everything here is free in this port (the original charged Time Crystals, which were also sold for money).
import { DATA, type SetDef, type TardisSeasonDef } from './data.ts';
import { SAVE, addItem, itemCount } from './save.ts';
import { canGetUnit, canHoldFragments, canWearOutfit, giftFromRow, ownsOutfit, receiveGift, type Gift } from './drops.ts';

/** Outfits only appear in rolls once the player has at least this many allies (GenerateRandomList). */
export const OUTFIT_ALLIES_NEEDED = 8;

export interface RollEntry {
  gift: Gift;
  weight: number; // percent, before normalising
}

export const rollableSeasons = (): TardisSeasonDef[] => (DATA.tardis ?? []).filter((s) => s.roll === 1);

export function allyCount(): number {
  return Object.keys(SAVE.owned).filter((id) => DATA.units[id]?.t === 2).length;
}

/** Chances of one entry that appears in several rows combine like independent chances (DropContentInfo.getChance). */
function combine(chances: number[]): number {
  let total = 0;
  for (const c of chances) total += (100 - total) * (c / 100);
  return Math.min(100, total);
}

/** What a season can still hand out right now: not already owned, outfits only for units the player has. */
export function seasonPool(s: TardisSeasonDef): RollEntry[] {
  const byKey = new Map<string, { gift: Gift; chances: number[] }>();
  for (const [type, id, chance] of s.pool) {
    const gift = giftFromRow(type, id);
    if (!gift || (gift.kind !== 'unit' && gift.kind !== 'suit')) continue;
    const k = `${gift.kind}:${gift.id}`;
    const e = byKey.get(k) ?? { gift, chances: [] };
    e.chances.push(chance);
    byKey.set(k, e);
  }
  const outfitsOpen = allyCount() >= OUTFIT_ALLIES_NEEDED;
  const out: RollEntry[] = [];
  for (const { gift, chances } of byKey.values()) {
    if (gift.kind === 'unit' && !canGetUnit(gift.id, false)) continue;
    if (gift.kind === 'suit' && (ownsOutfit(gift.id) || !canWearOutfit(gift.id) || !outfitsOpen)) continue;
    let w = combine(chances);
    if (w <= 0) continue;
    if (gift.kind === 'suit') w += s.paSuit;
    else {
      const col = DATA.units[String(gift.id)]?.a[0];
      if (col) w += s.paChar[String(col)] ?? 0;
    }
    out.push({ gift, weight: w });
  }
  return out;
}

export type RollResult = { ok: true; gift: Gift } | { ok: false; why: 'empty' | 'unknown' };

/** Roll a season: a weighted pick from what is still available, delivered to the player. `rand` is in [0, 1). */
export function rollSeason(bind: string, rand: () => number): RollResult {
  const s = rollableSeasons().find((x) => x.bind === bind);
  if (!s) return { ok: false, why: 'unknown' };
  const pool = seasonPool(s);
  if (!pool.length) return { ok: false, why: 'empty' };
  const total = pool.reduce((n, e) => n + e.weight, 0);
  let dice = rand() * total;
  let pick = pool[pool.length - 1];
  for (const e of pool) {
    if (dice < e.weight) {
      pick = e;
      break;
    }
    dice -= e.weight;
  }
  receiveGift(pick.gift);
  return { ok: true, gift: pick.gift };
}

// ------------------------------------------------------------------ purchase sets
export interface SetStatus {
  def: SetDef;
  gifts: { gift: Gift; count: number; have: boolean }[]; // what the set holds that this game knows about
  have: number;
  total: number; // units and outfits only, like the original's "you already own x of y"
  obtainable: boolean; // something in it can still be received
}

function giftOfSetItem(type: number, id: number): Gift | null {
  return giftFromRow(type === 25 ? 9 : 1, id);
}

/** Can this item of a set still be received? (BagData.canPutInBagMore with the mission-drop rule.) */
function receivable(g: Gift): boolean {
  if (g.kind === 'unit') return canGetUnit(g.id, true);
  if (g.kind === 'suit') return !ownsOutfit(g.id);
  return canHoldFragments(g.id, 1);
}

export function setStatus(def: SetDef): SetStatus {
  const gifts: SetStatus['gifts'] = [];
  for (const [type, id, count] of def.it) {
    const gift = giftOfSetItem(type, id);
    if (gift) gifts.push({ gift, count: count || 1, have: gift.kind !== 'item' && !receivable(gift) });
  }
  const owned = gifts.filter((g) => g.gift.kind !== 'item');
  return {
    def,
    gifts,
    have: owned.filter((g) => g.have).length,
    total: owned.length,
    obtainable: gifts.some((g) => receivable(g.gift)),
  };
}

/** Sets with something left to get, as the original's list showed them. */
export const availableSets = (): SetStatus[] => (DATA.sets ?? []).map(setStatus).filter((s) => s.obtainable);

/** Hand over everything in a set that can still be received. Returns what arrived. */
export function claimSet(id: number): Gift[] {
  const def = (DATA.sets ?? []).find((s) => s.id === id);
  if (!def) return [];
  const got: Gift[] = [];
  for (const { gift, count } of setStatus(def).gifts) {
    if (!receivable(gift)) continue;
    if (gift.kind === 'item') {
      const room = DATA.fragLimit > 0 ? Math.max(0, DATA.fragLimit - itemCount(gift.id)) : count;
      const n = Math.min(count, room);
      if (n > 0) {
        addItem(gift.id, n);
        got.push(gift);
      }
    } else if (receiveGift(gift)) got.push(gift);
  }
  return got;
}
