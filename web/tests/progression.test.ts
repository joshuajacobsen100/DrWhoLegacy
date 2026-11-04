// Unit upgrades: real exp tables, attribute points, derived Doctor level, evolution.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const prog = await import('../src/progression.ts');
const { DATA, unitMaxLevel, statsAt } = data;
const { SAVE } = (save.loadSave(), save);

// ---- exp tables are the original ones and every unit points at a real table
for (const u of Object.values(DATA.units)) assert.ok(DATA.exp[String(u.ex)]?.length >= unitMaxLevel(u) - 1, `unit ${u.id} has no exp table ${u.ex}`);
assert.equal(DATA.exp['1'][0], 11645, 'table 1 matches the decoded original');

// ---- starter save: Doctor + allies, nothing spent
// a new game is what the original starts with: the Eleventh Doctor and Madame Vastra, a team of two, nothing else
assert.deepEqual(save.SAVE.team, [15, 29]);
assert.deepEqual(Object.keys(save.SAVE.owned).sort(), ['15', '29'], 'only those two units');
assert.deepEqual(save.SAVE.items, {}, 'no items');
assert.deepEqual(save.SAVE.suits, [], 'no extra outfits');
assert.deepEqual(save.SAVE.cleared, {}, 'no progress');
assert.equal(save.DEFAULT_DOCTOR, 15);
assert.equal(save.DEFAULT_COMPANION, 29);
assert.equal(prog.needsTutorial(), true, 'a new game opens with the tutorial');
assert.deepEqual(prog.TUTORIAL_TEAM, save.SAVE.team, 'the tutorial uses the same pair');
const [doc, ...allies] = save.SAVE.team;
assert.equal(DATA.units[String(doc)].t, 1);
assert.equal(DATA.units[String(allies[0])].t, 2);
for (const a of allies) assert.deepEqual(save.SAVE.owned[a], save.newOwned(DATA.units[String(a)].il));
// any progress ends the tutorial prompt, and so does unlocking everything
save.SAVE.cleared[18] = 1;
assert.equal(prog.needsTutorial(), false);
delete save.SAVE.cleared[18];
save.SAVE.unlockAll = true;
assert.equal(prog.needsTutorial(), false);
save.SAVE.unlockAll = false;
// "Reset progress" gives the same start again
save.SAVE.owned['999'] = save.newOwned(1);
save.resetSave();
assert.deepEqual(save.SAVE.team, [15, 29]);
assert.deepEqual(Object.keys(save.SAVE.owned).sort(), ['15', '29']);

// ---- XP: allies level up on the real tables, one point per level; the Doctor gets nothing
const ally = allies[0];
const au = DATA.units[String(ally)];
const need = save.xpToNext(au, 1);
assert.ok(need > 50, 'level 1 needs more than a tutorial reward');
assert.equal(save.addXp(ally, need - 1), 0);
assert.equal(save.SAVE.owned[ally].lv, 1);
assert.equal(save.addXp(ally, 1), 1, 'exactly enough XP gains a level');
assert.equal(save.SAVE.owned[ally].lv, 2);
assert.equal(save.SAVE.owned[ally].pts, 1, 'a level is worth one attribute point');
assert.equal(save.addXp(doc, 999999), 0, 'the Doctor does not earn battle XP');
assert.equal(save.SAVE.owned[doc].lv, DATA.units[String(doc)].il);
// big rewards roll over several levels and stop at the cap
save.addXp(ally, 10 ** 12);
assert.equal(save.SAVE.owned[ally].lv, unitMaxLevel(au), 'capped at max level');
assert.equal(save.SAVE.owned[ally].xp, 0);
assert.equal(save.SAVE.owned[ally].pts, unitMaxLevel(au) - 1, 'one point per level gained');

// ---- attribute points change battle stats by the original factors (HP +10, ATK +5, Heal +3)
const before = prog.unitStatsFor(ally)!;
assert.ok(prog.spendPoint(ally, 'hp'));
assert.ok(prog.spendPoint(ally, 'atk'));
assert.ok(prog.spendPoint(ally, 'atk'));
assert.ok(prog.spendPoint(ally, 'heal'));
const after = prog.unitStatsFor(ally)!;
assert.equal(after.hp - before.hp, 10);
assert.equal(after.atk - before.atk, 10);
assert.equal(after.heal - before.heal, 3);
assert.equal(save.SAVE.owned[ally].pts, unitMaxLevel(au) - 1 - 4);
assert.equal(prog.spendPoint(doc, 'hp'), false, 'the Doctor takes no attribute points');
// reset refunds everything and is free: it needs no Time Crystals and spends none
assert.equal(save.itemCount(save.CRYSTAL), 0);
assert.ok(prog.resetPoints(ally));
assert.equal(save.itemCount(save.CRYSTAL), 0, 'no crystals spent');
assert.equal(save.SAVE.owned[ally].pts, unitMaxLevel(au) - 1);
assert.deepEqual([save.SAVE.owned[ally].hp, save.SAVE.owned[ally].atk, save.SAVE.owned[ally].heal], [0, 0, 0]);
assert.equal(prog.resetPoints(ally), false, 'nothing left to refund');

// ---- Doctor level is derived from the allies (rank-weighted average / doctor rank), clamped to its range
const d = DATA.units[String(doc)];
const lvOf = (team: number[]) => prog.doctorLevel(team);
assert.equal(lvOf([doc]), d.il, 'no allies -> initial level');
const lows = Object.values(DATA.units).filter((u) => u.t === 2 && u.r === d.r && u.adr === 0).slice(0, 2);
for (const u of lows) save.SAVE.owned[u.id] = save.newOwned(7);
assert.equal(lvOf([doc, lows[0].id, lows[1].id]), Math.min(unitMaxLevel(d), Math.max(d.il, 7)), 'same rank allies at 7 -> Doctor level 7');
for (const u of lows) save.SAVE.owned[u.id].lv = 99;
assert.equal(lvOf([doc, lows[0].id, lows[1].id]), unitMaxLevel(d), 'clamped to the Doctor max level');
const hi = prog.unitStatsFor(doc, [doc, lows[0].id, lows[1].id])!;
assert.equal(hi.hp, statsAt(d, unitMaxLevel(d)).hp, 'Doctor stats follow the derived level');

// ---- evolution
// ally: needs max level AND the recipe items; consumes them; resets to the new rank's initial level; keeps points
const evoAlly = Object.values(DATA.units).find((u) => u.t === 2 && u.et && u.ei.length && u.ec > 0 && DATA.units[String(u.et)])!;
save.SAVE.owned[evoAlly.id] = save.newOwned(evoAlly.il);
save.SAVE.owned[evoAlly.id].pts = 3;
save.SAVE.owned[evoAlly.id].atk = 2;
save.SAVE.team = [doc, evoAlly.id];
let st = prog.evoStatus(evoAlly.id)!;
assert.equal(st.levelOk, false, 'ally below max level cannot evolve');
assert.equal(prog.evolve(evoAlly.id, false), 0);
save.SAVE.owned[evoAlly.id].lv = unitMaxLevel(evoAlly);
st = prog.evoStatus(evoAlly.id)!;
assert.equal(st.levelOk, true);
assert.equal(st.itemsOk, false, 'no fragments yet');
assert.equal(prog.evolve(evoAlly.id, false), 0, 'missing fragments');
for (const i of st.items) save.addItem(i.id, i.need + 1);
assert.equal(prog.evoStatus(evoAlly.id)!.canEvolve, true);
const nid = prog.evolve(evoAlly.id, false);
assert.equal(nid, evoAlly.et);
const nu = DATA.units[String(nid)];
assert.equal(save.SAVE.owned[evoAlly.id], undefined, 'old unit is replaced');
assert.equal(save.SAVE.owned[nid].lv, nu.il, 'starts at the new rank\'s initial level');
assert.equal(save.SAVE.owned[nid].atk, 2, 'spent points carry over');
assert.equal(save.SAVE.owned[nid].pts, 3);
assert.deepEqual(save.SAVE.team, [doc, nid], 'team slot follows the evolution');
for (const i of st.items) assert.equal(save.itemCount(i.id), 1, 'only the recipe amount is consumed');
assert.ok(nu.r > evoAlly.r || nu.il > evoAlly.il, 'the new unit is a higher rank');

// instant evolution: skips the fragments and is free (allies still need max level)
const inst = Object.values(DATA.units).find((u) => u.t === 2 && u.et && u.ec > 0 && u.id !== evoAlly.id && u.id !== nid && DATA.units[String(u.et)])!;
save.SAVE.owned[inst.id] = save.newOwned(inst.il);
assert.equal(prog.evolve(inst.id, true), 0, 'instant still needs max level for allies');
save.SAVE.owned[inst.id].lv = unitMaxLevel(inst);
save.SAVE.items = {};
assert.equal(prog.evoStatus(inst.id)!.canInstant, true, 'no crystals or fragments needed');
assert.equal(prog.evolve(inst.id, true), inst.et);
assert.equal(save.itemCount(save.CRYSTAL), 0, 'no crystals spent');

// instant max level: allies jump to their cap and every level gained is an attribute point; the Doctor is untouched
const lvAlly = Object.values(DATA.units).find((u) => u.t === 2 && u.id !== evoAlly.id && u.id !== inst.id && !save.SAVE.owned[u.id])!;
save.SAVE.owned[lvAlly.id] = save.newOwned(lvAlly.il);
save.SAVE.owned[lvAlly.id].xp = 5;
const ptsBefore = save.SAVE.owned[lvAlly.id].pts;
const gainedLv = prog.maxLevelNow(lvAlly.id);
assert.equal(gainedLv, unitMaxLevel(lvAlly) - lvAlly.il);
assert.equal(save.SAVE.owned[lvAlly.id].lv, unitMaxLevel(lvAlly));
assert.equal(save.SAVE.owned[lvAlly.id].pts, ptsBefore + gainedLv, 'one point per level gained');
assert.equal(save.SAVE.owned[lvAlly.id].xp, 0);
assert.equal(prog.maxLevelNow(lvAlly.id), 0, 'already at the cap');
assert.equal(prog.maxLevelNow(doc), 0, 'the Doctor has no level of its own');
assert.equal(save.itemCount(save.CRYSTAL), 0, 'no crystals spent');

// Doctor: no level requirement, recipe items only
const docDef = DATA.units[String(doc)];
assert.ok(docDef.et, 'starter Doctor can evolve');
save.SAVE.team = [doc, ...allies];
const dst = prog.evoStatus(doc)!;
assert.equal(dst.levelOk, true, 'the Doctor has no level requirement');
for (const i of dst.items) save.addItem(i.id, i.need);
const ndoc = prog.evolve(doc, false);
assert.equal(ndoc, docDef.et);
assert.equal(save.SAVE.team[0], ndoc, 'Doctor slot follows the evolution');
assert.equal(DATA.units[String(ndoc)].t, 1);

// final rank has nothing to evolve into
const last = Object.values(DATA.units).find((u) => u.t === 2 && !u.et)!;
save.SAVE.owned[last.id] = save.newOwned(last.il);
assert.equal(prog.evoStatus(last.id)!.target, null);
assert.equal(prog.evolve(last.id, true), 0);

// ---- every evolution in the data is coherent
let chains = 0;
for (const u of Object.values(DATA.units)) {
  if (!u.et) continue;
  chains++;
  const t = DATA.units[String(u.et)];
  assert.ok(t, `unit ${u.id} evolves into missing ${u.et}`);
  assert.equal(t.t, u.t, `unit ${u.id} changes type when evolving`);
  for (const [iid, n] of u.ei) {
    assert.ok(DATA.items[String(iid)], `unit ${u.id} recipe uses unknown item ${iid}`);
    assert.ok(n > 0);
  }
}
assert.ok(chains > 1000);

// ---- v1 saves from before this milestone are migrated
store.set('dwl.save.v1', JSON.stringify({ v: 1, owned: { [ally]: { lv: 4, xp: 5 } }, cleared: {}, team: [doc, ally], unlockAll: false, muted: false }));
const migrated = save.loadSave();
assert.deepEqual(migrated.owned[ally], { lv: 4, xp: 5, pts: 0, hp: 0, atk: 0, heal: 0 });
assert.deepEqual(migrated.items, {});
console.log('progression tests passed');
