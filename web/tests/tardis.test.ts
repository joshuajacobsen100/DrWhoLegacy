// Mission drops (ownership rules, single/multi cards, crystal cap, drop-rate bonus) and the Tardis (season rolls, sets).
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import type { DropRow } from '../src/engine/battle.ts';
import type { Gift } from '../src/drops.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const drops = await import('../src/drops.ts');
const tardis = await import('../src/tardis.ts');
const { DATA } = data;
const { CRYSTAL } = save;
const fresh = () => {
  save.resetSave();
  save.SAVE.owned = {};
  save.SAVE.items = {};
  save.SAVE.suits = [];
  return save.SAVE;
};
/** A rand() that plays back fixed values, then repeats the last one. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[Math.min(i++, v.length - 1)];
};
const allies = Object.values(DATA.units).filter((u) => u.t === 2);

// ---- data
{
  const seasons = DATA.tardis.filter((s) => s.roll === 1);
  assert.deepEqual(seasons.map((s) => s.bind), ['Season 7'], 'only Season 7 can be rolled in the original');
  const s7 = seasons[0];
  assert.equal(s7.pool.filter((r) => r[0] === 1).length, 89);
  assert.equal(s7.pool.filter((r) => r[0] === 9).length, 34);
  for (const [t, id] of s7.pool) assert.ok(drops.giftFromRow(t, id), `Season 7 roll entry ${t}/${id} exists in the game data`);
  assert.equal(DATA.sets.length, 162);
  for (const set of DATA.sets) for (const [t, id] of set.it) assert.ok(t === 25 ? DATA.suits[String(id)] : DATA.units[String(id)] || DATA.items[String(id)], `set ${set.id} item ${id}`);
  assert.equal(DATA.fragLimit, 250);
  let suitRows = 0;
  for (const l of Object.values(DATA.levels)) {
    for (const e of Object.values(l.em)) {
      for (const r of e.dr) {
        assert.ok(r[0] === 1 || r[0] === 9 || r[0] === 4, 'only unit/item, fragment and outfit rows');
        if (r[0] === 9) {
          suitRows++;
          assert.ok(DATA.suits[String(r[1])], `outfit ${r[1]} drops in level ${l.id} and has art`);
        }
      }
    }
  }
  assert.ok(suitRows > 300, 'missions drop outfits (type 25)');
  assert.equal(Object.values(DATA.levels).filter((l) => l.cl === 1).length, 536, 'most missions drop at most one crystal ever');
}

// ---- ownership rules
{
  const S = fresh();
  const a = allies.find((u) => u.g === 0 && u.et)!;
  assert.equal(drops.canGetUnit(a.id, true), true);
  S.owned[a.id] = save.newOwned(a.il);
  assert.equal(drops.canGetUnit(a.id, true), false, 'owned');
  // a different family is unaffected
  const other = allies.find((u) => (u.g || u.id) !== (a.g || a.id))!;
  assert.equal(drops.canGetUnit(other.id, true), true);
  // the original also refuses a second member of a family
  const sib = allies.find((u) => u.id !== a.id && u.g && u.g === a.id) ?? allies.find((u) => u.g && allies.some((v) => v.id !== u.id && v.g === u.g));
  if (sib) {
    const mate = allies.find((v) => v.id !== sib.id && v.g === sib.g)!;
    S.owned = { [sib.id]: save.newOwned(sib.il) };
    assert.equal(drops.canGetUnit(mate.id, false), false, 'same family: the Tardis never gives another');
    assert.equal(drops.canGetUnit(mate.id, true), mate.il > sib.il, 'a mission may give a higher-rank member');
  }
  // outfits: need a unit that can wear them; a unit's default outfit counts as owned with the unit
  S.owned = {};
  const w = allies.find((u) => u.ss.length)!;
  const alt = w.ss[0];
  assert.equal(drops.canWearOutfit(alt), false, 'nobody to wear it');
  S.owned[w.id] = save.newOwned(w.il);
  assert.equal(drops.canWearOutfit(alt), true);
  assert.equal(drops.ownsOutfit(alt), false);
  assert.equal(drops.ownsOutfit(w.suit), true, 'the default outfit comes with the unit');
  S.suits.push(alt);
  assert.equal(drops.ownsOutfit(alt), true);
}

// ---- drop rules (checkpacket)
{
  const S = fresh();
  // crystal cap: a mission with cl=1 may drop one crystal, ever
  const capped = Object.values(DATA.levels).find((l) => l.cl === 1)!;
  const crystal: Gift = { kind: 'item', id: CRYSTAL };
  assert.equal(drops.giftAllowed(crystal, [], capped.id), true);
  assert.equal(drops.giftAllowed(crystal, [crystal], capped.id), false, 'a second crystal in one run is over the cap');
  drops.recordVictory(capped.id, [crystal]);
  assert.equal(S.crystalDrops[capped.id], 1);
  assert.equal(drops.giftAllowed(crystal, [], capped.id), false, 'and none on later runs');
  const open = Object.values(DATA.levels).find((l) => l.cl === 0)!;
  assert.equal(drops.giftAllowed(crystal, [crystal, crystal, crystal], open.id), true, 'no cap on other missions');
  // fragments stop at 250
  const frag = Object.values(DATA.items).find((i) => i.t === 3)!;
  const fg: Gift = { kind: 'item', id: frag.id };
  S.items[frag.id] = 249;
  assert.equal(drops.giftAllowed(fg, [], open.id), true);
  assert.equal(drops.giftAllowed(fg, [fg], open.id), false, '249 + 2 is over the limit');
  S.items[frag.id] = 250;
  assert.equal(drops.giftAllowed(fg, [], open.id), false);
  assert.equal(drops.receiveGift(fg), false, 'a full stack takes no more');
  // one run never drops two units of a family, nor an outfit twice
  const a = allies[0];
  const ga: Gift = { kind: 'unit', id: a.id };
  assert.equal(drops.giftAllowed(ga, [], open.id), true);
  assert.equal(drops.giftAllowed(ga, [ga], open.id), false);
  const w = allies.find((u) => u.ss.length)!;
  S.owned[w.id] = save.newOwned(w.il);
  const gs: Gift = { kind: 'suit', id: w.ss[0] };
  assert.equal(drops.giftAllowed(gs, [], open.id), true);
  assert.equal(drops.giftAllowed(gs, [gs], open.id), false);
  assert.equal(drops.receiveGift(gs), true);
  assert.ok(S.suits.includes(w.ss[0]));
  assert.equal(drops.giftAllowed(gs, [], open.id), false, 'already owned');
}

// ---- cards: "single" tries each row in turn, "multi" rolls one dice over the running total
{
  const S = fresh();
  const [u1, u2, u3] = allies.filter((u) => !u.g).slice(0, 3);
  const row = (u: { id: number }, c: number): DropRow => [1, u.id, c];
  // single
  assert.equal(drops.rollCard({ m: 0, r: [row(u1, 50), row(u2, 100)] }, [], 1, seq(0.4))?.id, u1.id, 'first row hits');
  assert.equal(drops.rollCard({ m: 0, r: [row(u1, 50), row(u2, 100)] }, [], 1, seq(0.9, 0.9))?.id, u2.id, 'first row misses, second hits');
  assert.equal(drops.rollCard({ m: 0, r: [row(u1, 10), row(u2, 10)] }, [], 1, seq(0.9)), null, 'nothing hits');
  assert.equal(drops.rollCard({ m: 0, r: [row(u1, 100), row(u2, 100)] }, [], 1, seq(0))?.id, u1.id, 'only one gift per card');
  // multi: one dice, cumulative chances (20 then 50)
  assert.equal(drops.rollCard({ m: 1, r: [row(u1, 20), row(u2, 30)] }, [], 1, seq(0.1))?.id, u1.id);
  assert.equal(drops.rollCard({ m: 1, r: [row(u1, 20), row(u2, 30)] }, [], 1, seq(0.3))?.id, u2.id);
  assert.equal(drops.rollCard({ m: 1, r: [row(u1, 20), row(u2, 30)] }, [], 1, seq(0.6)), null);
  // a row that hits but is not allowed falls through to the next one
  S.owned[u1.id] = save.newOwned(u1.il);
  assert.equal(drops.rollCard({ m: 0, r: [row(u1, 100), row(u2, 100)] }, [], 1, seq(0))?.id, u2.id, 'an owned unit never drops');
  assert.equal(drops.rollCard({ m: 1, r: [row(u1, 50), row(u2, 50)] }, [], 1, seq(0.2))?.id, u2.id);
  // a follow-on card replaces the gift when it hits
  const chain: DropRow = [1, u2.id, 100, { m: 0, r: [row(u3, 100)] }];
  assert.equal(drops.rollCard({ m: 0, r: [chain] }, [], 1, seq(0))?.id, u3.id, 'the last card of a chain wins');
  const weak: DropRow = [1, u2.id, 100, { m: 0, r: [row(u3, 0)] }];
  assert.equal(drops.rollCard({ m: 0, r: [weak] }, [], 1, seq(0))?.id, u2.id, 'a missed follow-on keeps the first gift');
  // outfits and random fragments
  const w = allies.find((u) => u.ss.length && !S.owned[u.id])!;
  assert.equal(drops.rollCard({ m: 0, r: [[9, w.ss[0], 100]] }, [], 1, seq(0)), null, 'no wearer yet: the outfit does not drop');
  S.owned[w.id] = save.newOwned(w.il);
  assert.deepEqual(drops.rollCard({ m: 0, r: [[9, w.ss[0], 100]] }, [], 1, seq(0)), { kind: 'suit', id: w.ss[0] });
  const frags = Object.values(DATA.items).filter((i) => i.t === 3);
  assert.equal(drops.rollCard({ m: 0, r: [[4, 0, 100]] }, [], 1, seq(0))?.id, frags[0].id, 'type 4 picks a random fragment');
  assert.equal(drops.rollCard({ m: 0, r: [[1, 0, 100]] }, [], 1, seq(0)), null, 'unknown ids drop nothing');
}

// ---- the drop-rate bonus
{
  const S = fresh();
  const u = allies[0];
  const item = Object.values(DATA.items).find((i) => i.t === 3)!;
  const suitId = Number(Object.keys(DATA.suits)[0]);
  assert.equal(drops.rowChance([1, u.id, 5]), 5);
  S.dropBonus = 15;
  assert.equal(drops.rowChance([1, u.id, 5]), 20, 'units get the bonus');
  assert.equal(drops.rowChance([9, suitId, 3]), 18, 'so do outfits');
  assert.equal(drops.rowChance([1, item.id, 5]), 5, 'items do not');
  S.dropBonus = 0.3;
  assert.equal(drops.rowChance([1, u.id, 5]), 5, 'the sum is truncated: 5.3 -> 5');
  S.dropBonus = 0;
  for (let i = 0; i < 100; i++) drops.raiseDropBonus();
  assert.equal(S.dropBonus, 15, 'capped at 15');
  S.dropBonus = 0;
  drops.raiseDropBonus();
  assert.ok(Math.abs(S.dropBonus - 0.3) < 1e-9);
  // each day away halves it; under 1 it is gone
  const t0 = 1_700_000_000_000;
  S.dropBonus = 15;
  S.dropBonusAt = t0;
  drops.refreshDropBonus(t0 + 3.5 * 86_400_000);
  assert.equal(S.dropBonus, 1.875, 'three days: 15 -> 7.5 -> 3.75 -> 1.875');
  assert.equal(S.dropBonusAt, t0 + 3.5 * 86_400_000);
  S.dropBonus = 15;
  S.dropBonusAt = t0;
  drops.refreshDropBonus(t0 + 5 * 86_400_000);
  assert.equal(S.dropBonus, 0, 'five days: it drops under 1 and resets');
  S.dropBonus = 9;
  S.dropBonusAt = t0;
  drops.refreshDropBonus(t0 + 3_600_000);
  assert.equal(S.dropBonus, 9, 'less than a day changes nothing');
  // a victory raises it
  S.dropBonus = 0;
  drops.recordVictory(Object.values(DATA.levels)[0].id, []);
  assert.ok(Math.abs(S.dropBonus - 0.3) < 1e-9);
}

// ---- real missions: a long run of kills never breaks the rules
{
  const S = fresh();
  for (const u of allies.filter((x) => x.r <= 2).slice(0, 8)) S.owned[u.id] = save.newOwned(u.il);
  let rolled = 0;
  for (const l of Object.values(DATA.levels)) {
    const run: Gift[] = [];
    for (const e of Object.values(l.em)) {
      const g = drops.rollEnemyDrop(e.dr, e.dm === 1, run, l.id, seq(0, 0, 0));
      if (g) {
        rolled++;
        assert.ok(drops.giftAllowed(g, run, l.id), `level ${l.id}: a drop must be allowed`);
        run.push(g);
      }
    }
    const fams = run.filter((g) => g.kind === 'unit').map((g) => DATA.units[String(g.id)]).map((u) => `${u.t}:${u.g || u.id}`);
    assert.equal(new Set(fams).size, fams.length, `level ${l.id} never drops two units of a family`);
    const suits = run.filter((g) => g.kind === 'suit').map((g) => g.id);
    assert.equal(new Set(suits).size, suits.length, `level ${l.id} never drops an outfit twice`);
    for (const g of run) if (g.kind === 'unit') assert.equal(S.owned[g.id], undefined, 'owned units never drop');
  }
  assert.ok(rolled > 100, `plenty of drops came out (${rolled})`);
}

// ---- Tardis: season pool and rolls
{
  const S = fresh();
  const s7 = tardis.rollableSeasons()[0];
  let pool = tardis.seasonPool(s7);
  assert.equal(pool.filter((e) => e.gift.kind === 'unit').length, 89, 'every unit of the list is up for grabs');
  assert.equal(pool.filter((e) => e.gift.kind === 'suit').length, 0, 'no outfits without allies to wear them');
  const first = pool[0].gift;
  S.owned[first.id] = save.newOwned(DATA.units[String(first.id)].il);
  pool = tardis.seasonPool(s7);
  assert.ok(!pool.some((e) => e.gift.kind === first.kind && e.gift.id === first.id), 'owned units leave the pool');
  // chances: duplicate rows combine like independent chances; weights follow the data
  const [x, y] = pool.slice(0, 2).map((e) => e.gift.id);
  const cmb = tardis.seasonPool({ ...s7, pool: [[1, x, 50], [1, x, 50], [1, y, 3]], paChar: {}, paSuit: 0 });
  assert.equal(cmb.find((e) => e.gift.id === x)?.weight, 75, '50% then 50% = 75%');
  assert.equal(cmb.find((e) => e.gift.id === y)?.weight, 3);
  // outfit and character bonuses from the season config add on top
  const colour = DATA.units[String(y)].a[0];
  assert.equal(tardis.seasonPool({ ...s7, pool: [[1, y, 3]], paChar: { [String(colour)]: 2 }, paSuit: 0 })[0].weight, 5, 'a colour bonus adds to the unit');
  // outfits come in with 8 allies, and only for units that can wear them
  const eight = allies.filter((u) => u.ss.length).slice(0, 8);
  S.owned = Object.fromEntries(eight.map((u) => [u.id, save.newOwned(u.il)]));
  const pool8 = tardis.seasonPool(s7);
  assert.equal(tardis.allyCount(), 8);
  for (const e of pool8) if (e.gift.kind === 'suit') assert.ok(drops.canWearOutfit(e.gift.id) && !drops.ownsOutfit(e.gift.id));
  // a roll hands the gift over; rand 0 = the first entry, just under 1 = the last
  const before = tardis.seasonPool(s7);
  const r0 = tardis.rollSeason('Season 7', () => 0);
  assert.ok(r0.ok && r0.gift.kind === before[0].gift.kind && r0.gift.id === before[0].gift.id, 'rand 0 picks the first');
  if (r0.ok && r0.gift.kind === 'unit') assert.ok(S.owned[r0.gift.id]);
  if (r0.ok && r0.gift.kind === 'suit') assert.ok(S.suits.includes(r0.gift.id));
  const before2 = tardis.seasonPool(s7);
  const r1 = tardis.rollSeason('Season 7', () => 0.9999999);
  assert.ok(r1.ok && r1.gift.id === before2.at(-1)!.gift.id && r1.gift.kind === before2.at(-1)!.gift.kind, 'rand just under 1 picks the last');
  assert.equal(S.items[CRYSTAL] ?? 0, 0, 'rolling costs nothing');
  assert.deepEqual(tardis.rollSeason('Season 6', () => 0), { ok: false, why: 'unknown' }, 'only rollable seasons');
  // keep rolling: nothing ever repeats and the list runs dry
  const seen = new Set<string>();
  let n = 0;
  for (; n < 400; n++) {
    const r = tardis.rollSeason('Season 7', Math.random);
    if (!r.ok) break;
    const k = `${r.gift.kind}:${r.gift.id}`;
    assert.ok(!seen.has(k), 'a roll never repeats');
    seen.add(k);
    if (r.gift.kind === 'unit') assert.ok(drops.ownsOutfit(DATA.units[String(r.gift.id)].suit), 'a new unit comes with its outfit');
  }
  assert.ok(n < 400, 'the pool empties');
  assert.deepEqual(tardis.rollSeason('Season 7', Math.random), { ok: false, why: 'empty' });
  assert.ok(seen.size >= 89, 'every character of the list was won');
}

// ---- Tardis: purchase sets
{
  const S = fresh();
  const all = tardis.availableSets();
  assert.ok(all.length > 100, `most sets are available to a new player (${all.length})`);
  const single = all.find((s) => s.def.it.length === 1 && s.def.it[0][0] === 21 && DATA.units[String(s.def.it[0][1])])!;
  assert.equal(single.have, 0);
  const got = tardis.claimSet(single.def.id);
  assert.equal(got.length, 1);
  assert.ok(S.owned[single.def.it[0][1]], 'the set gave the unit');
  assert.ok(!tardis.availableSets().some((s) => s.def.id === single.def.id), 'a set you fully own is no longer listed');
  assert.deepEqual(tardis.claimSet(single.def.id), [], 'claiming it again gives nothing');
  // a bundle of units and an outfit: claiming gives every piece, once
  const big = DATA.sets.find((s) => s.it.some((i) => i[0] === 25) && s.it.filter((i) => i[0] === 21).length >= 2)!;
  const st0 = tardis.setStatus(big);
  const got2 = tardis.claimSet(big.id);
  assert.ok(got2.length >= 1);
  for (const g of got2) {
    if (g.kind === 'unit') assert.ok(S.owned[g.id]);
    if (g.kind === 'suit') assert.ok(S.suits.includes(g.id));
  }
  const st1 = tardis.setStatus(big);
  assert.ok(st1.have >= st0.have, 'it counts what you own');
  assert.equal(st1.obtainable, false, 'nothing left in it to get');
  assert.equal(S.items[CRYSTAL] ?? 0, 0, 'sets cost nothing');
}

console.log('tardis and drop tests passed');
