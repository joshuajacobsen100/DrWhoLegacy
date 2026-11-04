// Outfits (wardrobe + Tardis roll) and the daily login bonus.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const wardrobe = await import('../src/wardrobe.ts');
const prog = await import('../src/progression.ts');
const daily = await import('../src/daily.ts');
const { DATA } = data;
save.loadSave();
const { SAVE, CRYSTAL } = save;

// ---- data: every alternative outfit of every unit has art and a name entry
let alt = 0;
for (const u of Object.values(DATA.units)) {
  for (const s of u.ss) {
    alt++;
    assert.ok(DATA.suits[String(s)]?.img, `unit ${u.id} lists outfit ${s} without art`);
  }
  assert.ok(!u.ss.includes(u.suit), 'the default outfit is not listed twice');
}
assert.ok(alt > 1000, `expected plenty of alternative outfits, got ${alt}`);
assert.equal(DATA.dailyBonus.length, 5, 'five daily bonus days');
assert.deepEqual(DATA.dailyBonus.map((d) => d.day), [1, 2, 3, 4, 5]);
for (const d of DATA.dailyBonus) assert.ok(DATA.items[String(d.item_id)], `daily item ${d.item_id} exists`);
assert.equal(DATA.dailyBonus[4].item_id, CRYSTAL, 'day 5 pays Time Crystals');

// ---- wearing: only owned outfits, default is the fallback
const withAlt = Object.values(DATA.units).find((u) => u.t === 2 && u.ss.length >= 2 && SAVE.owned[u.id])
  ?? Object.values(DATA.units).find((u) => u.t === 2 && u.ss.length >= 2 && save.grantUnit(u.id))!;
const id = withAlt.id;
assert.ok(SAVE.owned[id]);
const [a, b] = withAlt.ss;
assert.equal(wardrobe.wornSuit(id), withAlt.suit);
assert.deepEqual(wardrobe.ownedSuits(id), [withAlt.suit]);
assert.equal(wardrobe.wearSuit(id, a), false, 'cannot wear an outfit you have not won');
assert.ok(wardrobe.grantSuit(a));
assert.equal(wardrobe.grantSuit(a), false, 'an outfit is only won once');
assert.deepEqual(wardrobe.ownedSuits(id), [withAlt.suit, a]);
assert.ok(wardrobe.wearSuit(id, a));
assert.equal(wardrobe.wornSuit(id), a);
assert.equal(wardrobe.unitSuitImg(id), DATA.suits[String(a)].img);
assert.equal(prog.unitStatsFor(id)!.icon, DATA.suits[String(a)].img, 'the battle portrait uses the worn outfit');
assert.ok(wardrobe.wearSuit(id, withAlt.suit));
assert.equal(SAVE.wear[id], undefined, 'wearing the default clears the override');
assert.equal(wardrobe.wornSuit(id), withAlt.suit);
// a stale saved outfit falls back to the default
SAVE.wear[id] = b;
assert.equal(wardrobe.wornSuit(id), withAlt.suit);
delete SAVE.wear[id];

// ---- an outfit is granted once, and only if the game knows it (rolls and drops are tested in tardis.test.ts)
const spare = Object.keys(DATA.suits).map(Number).find((x) => !SAVE.suits.includes(x))!;
assert.equal(wardrobe.grantSuit(spare), true);
assert.equal(wardrobe.grantSuit(spare), false, 'already owned');
assert.equal(wardrobe.grantSuit(-5), false, 'unknown outfit');
SAVE.suits = SAVE.suits.filter((x) => x !== spare);

// ---- evolving drops the worn outfit (the original resets to the default)
const evolvable = Object.values(DATA.units).find((u) => u.t === 2 && u.et && SAVE.owned[u.id] && u.ss.length);
if (evolvable) {
  SAVE.wear[evolvable.id] = evolvable.ss[0];
  SAVE.suits.push(evolvable.ss[0]);
  const o = SAVE.owned[evolvable.id];
  o.lv = data.unitMaxLevel(evolvable);
  const to = prog.evolve(evolvable.id, true);
  assert.ok(to, 'evolved');
  assert.equal(SAVE.wear[evolvable.id], undefined);
  assert.equal(wardrobe.wornSuit(to), DATA.units[String(to)].suit);
}

// ---- daily bonus
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);
assert.equal(daily.dateKey(day(2026, 1, 5)), '2026-01-05');
SAVE.items = {};
SAVE.daily = { last: '', day: 0 };
let st = daily.dailyStatus(day(2026, 3, 10));
assert.ok(st.canClaim && st.day === 1, 'a first login offers day 1');
const r = daily.claimDaily(day(2026, 3, 10))!;
assert.deepEqual([r.item_id, r.count], [DATA.dailyBonus[0].item_id, DATA.dailyBonus[0].count]);
assert.equal(save.itemCount(r.item_id), r.count);
assert.equal(daily.claimDaily(day(2026, 3, 10)), null, 'only once a day');
assert.ok(!daily.dailyStatus(day(2026, 3, 10)).canClaim);
assert.equal(daily.dailyStatus(day(2026, 3, 10)).day, 1);
// consecutive days advance, month boundaries and DST do not matter
const days = [day(2026, 3, 11), day(2026, 3, 12), day(2026, 3, 13), day(2026, 3, 14)];
days.forEach((d, i) => {
  st = daily.dailyStatus(d);
  assert.ok(st.canClaim && st.day === i + 2, `day ${i + 2}`);
  assert.ok(daily.claimDaily(d));
});
assert.ok(save.itemCount(CRYSTAL) >= DATA.dailyBonus[4].count, 'day 5 paid Time Crystals');
// after day 5 the cycle starts again
st = daily.dailyStatus(day(2026, 3, 15));
assert.equal(st.day, 1);
daily.claimDaily(day(2026, 3, 15));
// missing a day resets the streak
assert.equal(daily.dailyStatus(day(2026, 3, 16)).day, 2, 'the streak continues after the reset');
daily.claimDaily(day(2026, 3, 16));
assert.equal(daily.dailyStatus(day(2026, 3, 19)).day, 1, 'a skipped day restarts at day 1');
assert.equal(daily.dailyStatus(day(2026, 4, 1)).day, 1);
// month rollover counts as consecutive
SAVE.daily = { last: '2026-03-31', day: 2 };
assert.equal(daily.dailyStatus(day(2026, 4, 1)).day, 3);
SAVE.daily = { last: '2025-12-31', day: 4 };
assert.equal(daily.dailyStatus(day(2026, 1, 1)).day, 5);

console.log('wardrobe and daily bonus tests passed');
