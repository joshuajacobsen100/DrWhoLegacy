// One Turn Buffs: the roll, how a buff reaches a battle (attack, heal, max HP, drops), and when it is given and cleared.
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { Battle, type EnemyDef, type UnitStats } from '../src/engine/battle.ts';
import { compilePerks } from '../src/engine/perks.ts';
import { makeRng } from '../src/engine/board.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const otb = await import('../src/otb.ts');
const drops = await import('../src/drops.ts');
const { DATA } = data;
save.loadSave();
const S = save.SAVE;

// ---- data
{
  const list = otb.otbList();
  assert.equal(list.length, 10);
  assert.equal(list.reduce((n, o) => n + o.chance, 0), 100, 'chances add up to 100');
  assert.deepEqual(list.map((o) => o.chance), [17, 3, 17, 3, 17, 3, 17, 3, 17, 3]);
  for (const o of list) {
    assert.ok(o.desc.startsWith('OTB :'), 'the original wording');
    assert.ok(o.img && existsSync(new URL(`../public/${o.img}`, import.meta.url)), `buff ${o.id} has art`);
    assert.ok(Object.keys(o.buffs).length >= 1);
  }
  assert.deepEqual(list[0].buffs, { atk: 5 });
  assert.deepEqual(list[1].buffs, { atk: 10 });
  assert.deepEqual(list[8].buffs, { atk: 5, heal: 5, hp: 10, drop: 10 }, '"all" buff');
  assert.deepEqual(list[9].buffs, { atk: 10, heal: 10, hp: 15, drop: 20 });
  assert.equal(DATA.otb.except.length, 39);
  assert.ok(otb.otbExempt(18), 'the tutorial never rolls a buff');
  assert.ok(!otb.otbExempt(1));
}

// ---- the roll: dice 0-99, first buff whose running total the dice does not pass (<=, as in the original)
{
  const seen = new Array(10).fill(0);
  for (let d = 0; d < 100; d++) {
    const o = otb.rollOtb(() => (d + 0.5) / 100)!;
    seen[o.id - 1]++;
  }
  assert.deepEqual(seen, [18, 3, 17, 3, 17, 3, 17, 3, 17, 2], 'the first buff gets 18 faces, the last gets 2');
  assert.equal(otb.rollOtb(() => 0)!.id, 1);
  assert.equal(otb.rollOtb(() => 0.999999)!.id, 10);
  // a long run lands near the stated odds
  const rng = makeRng(99);
  const n = 20000;
  const counts = new Array(10).fill(0);
  for (let i = 0; i < n; i++) counts[otb.rollOtb(rng)!.id - 1]++;
  assert.ok(Math.abs(counts[0] / n - 0.18) < 0.015 && Math.abs(counts[1] / n - 0.03) < 0.01, 'common buffs about 17%, strong ones about 3%');
}

// ---- helpers
{
  const all = otb.otbList()[8];
  assert.deepEqual(otb.otbFx(all), { atk: 0.05, heal: 0.05, hp: 0.1 });
  assert.deepEqual(otb.otbFx(null), { atk: 0, heal: 0, hp: 0 });
  assert.equal(otb.otbDropPoints(all), 10);
  assert.equal(otb.otbDropPoints(null), 0);
  assert.equal(otb.otbSummary(all), '+5% attack, +5% healing, +10% max HP, +10% drop rate');
  assert.equal(otb.otbSummary(otb.otbList()[0]), '+5% attack');
}

// ---- in battle: attack per unit, heal and max HP on the team totals, all before perks
{
  const rel = { 1: { 4: 2 } } as any;
  const unit = (uid: number): UnitStats => ({ uid, name: 'U', colors: [1], hp: 1001, atk: 99, heal: 51, isDoctor: false, icon: null });
  const enemy = (): EnemyDef => ({ hp: 9999, atk: 1, cd: 99, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [] });
  const mk = (opts: object) => new Battle([unit(1), unit(2)], [[enemy()]], rel, { dualSame: 0.1, dualDiff: 0.3 }, { rng: makeRng(1), ...opts });
  const base = mk({});
  assert.equal(base.maxHp, 2002);
  assert.equal(base.baseHeal, 102);
  assert.equal(base.team[0].atk, 99);
  const b = mk({ otb: { atk: 0.1, heal: 0.1, hp: 0.15 } });
  assert.equal(b.team[0].atk, Math.trunc(99 * 1.1), 'each unit: 99 x 1.1 = 108.9 -> 108');
  assert.equal(b.team[1].atk, 108);
  assert.equal(b.maxHp, Math.trunc(2002 * 1.15), 'team HP 2002 x 1.15 = 2302.3 -> 2302');
  assert.equal(b.hp, b.maxHp, 'the team starts at full health');
  assert.equal(b.baseHeal, Math.trunc(102 * 1.1), '102 x 1.1 = 112.2 -> 112');
  assert.equal(base.team[0].atk, 99, 'the buff does not touch the units themselves');
  // perks work from the raised totals
  const pk = compilePerks([[1, ['hp', '0.1']], [1, ['atk', '0.1']], [1, ['heal', '0.1']]]);
  const both = mk({ otb: { atk: 0.1, heal: 0.1, hp: 0.15 }, perks: pk });
  assert.equal(both.maxHp, 2302 + Math.trunc(2302 * 0.1), 'perk HP is a share of the buffed total');
  assert.equal(both.team[0].atk, Math.trunc(108 * 1.1), 'perk attack is applied on top of the buff');
  assert.equal(both.baseHeal, 112 + Math.trunc(112 * 0.1));
  assert.equal(mk({ otb: {} }).maxHp, 2002, 'an empty buff changes nothing');
}

// ---- drops: the buff adds its points to every row, then the sum is truncated once
{
  const u = Object.values(DATA.units).find((x) => x.t === 2)!;
  const item = Object.values(DATA.items).find((i) => i.t === 3)!;
  S.dropBonus = 0;
  assert.equal(drops.rowChance([1, u.id, 5], 10), 15);
  assert.equal(drops.rowChance([1, item.id, 5], 10), 15, 'items get it too');
  assert.equal(drops.rowChance([1, u.id, 0], 10), 10, 'a row at 0% is lifted as well (as in the original)');
  S.dropBonus = 0.3;
  assert.equal(drops.rowChance([1, u.id, 5], 10), 15, '5 + 0.3 + 10 = 15.3 -> 15');
  assert.equal(drops.rowChance([1, item.id, 5], 10), 15);
  S.dropBonus = 15;
  assert.equal(drops.rowChance([1, u.id, 5], 20), 40, 'with the win-streak bonus as well');
  S.dropBonus = 0;
  // a card rolled with the buff: 5% dice misses at 0% but hits at 10%
  const keepOwned = S.owned;
  S.owned = {};
  const row: [number, number, number] = [1, u.id, 0];
  const lvl = Object.values(DATA.levels)[0].id;
  assert.equal(drops.rollCard({ m: 0, r: [row] }, [], lvl, () => 0.05), null);
  assert.equal(drops.rollCard({ m: 0, r: [row] }, [], lvl, () => 0.05, 10)?.id, u.id);
  assert.equal(drops.rollEnemyDrop([row], false, [], lvl, () => 0.05, 10)?.id, u.id);
  S.owned = keepOwned;
}

// ---- when a buff is given and cleared
{
  assert.equal(S.otb, 0, 'a new save has no buff');
  assert.equal(S.settings.otb, true, 'the option is on by default');
  const normal = Object.values(DATA.levels).find((l) => !otb.otbExempt(l.id))!.id;
  assert.equal(otb.activeOtb(), null);
  // a victory rolls the next buff
  const won = otb.settleOtb(normal, true, () => 0.5)!;
  assert.ok(won && S.otb === won.id);
  assert.equal(otb.activeOtb()?.id, won.id);
  // the next battle ends in defeat: the buff is used up and nothing new comes
  assert.equal(otb.settleOtb(normal, false, () => 0.5), null);
  assert.equal(S.otb, 0);
  assert.equal(otb.activeOtb(), null);
  // leaving a battle clears it the same way; a victory in a mission that never gives buffs clears and gives none
  otb.settleOtb(normal, true, () => 0);
  assert.ok(S.otb > 0);
  assert.equal(otb.settleOtb(18, true, () => 0), null);
  assert.equal(S.otb, 0);
  // option off: victories give nothing
  S.settings.otb = false;
  assert.equal(otb.settleOtb(normal, true, () => 0), null);
  assert.equal(S.otb, 0);
  S.settings.otb = true;
  // a buff is stored with the save, so a refresh keeps it
  otb.settleOtb(normal, true, () => 0);
  const text = save.exportSave();
  S.otb = 0;
  assert.equal(save.importSave(text), null);
  assert.equal(save.SAVE.otb, 1);
  // an unknown id in a save is ignored
  save.SAVE.otb = 999;
  assert.equal(otb.activeOtb(), null);
  save.SAVE.otb = 0;
}

console.log('one turn buff tests passed');
