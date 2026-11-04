// Perks: data coverage, every effect against the original's formulas, and the unlock/selection rules.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { makeRng, origRow, type Board, type Match } from '../src/engine/board.ts';
import { Battle, type AbilityDef, type EnemyDef, type UnitAbility, type UnitStats } from '../src/engine/battle.ts';
import { compilePerks, shapesOf, type PerkFn } from '../src/engine/perks.ts';

const fx = (...f: [number, string[]][]) => compilePerks(f as PerkFn[]);
const rel = { 1: { 4: 2, 2: 0.5 }, 2: { 1: 2 } } as any;
const W: [number, number][] = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]];
const ab = (t: number, p: string[], cd = 1): AbilityDef => ({ n: 'T' + t, cd, t, p, r: 100, c: 0, h: 100, icon: null });
const en = (abilities: AbilityDef[] = [], o: Partial<EnemyDef> = {}): EnemyDef => ({
  hp: 100000, atk: 40, cd: 99, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [], abilities, ...o,
});
const cast: UnitAbility = { n: 'A', d: '', cd: 10, t: 101, p: ['10'], icon: null };
const unit = (o: Partial<UnitStats> = {}): UnitStats => ({
  uid: 1, name: 'U', colors: [1], hp: 1000, atk: 100, heal: 50, isDoctor: false, icon: null, abilities: [], ...o,
});
const checker: Board = [
  [1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1], [1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1], [1, 2, 1, 2, 1, 2],
];
const mk = (units: UnitStats[], waves: EnemyDef[][], perks = fx()) =>
  new Battle(units, waves, rel, { dualSame: 0.1, dualDiff: 0.3 }, { board: checker.map((r) => [...r]), weights: W, rng: makeRng(7), perks });
const red = (n: number, row = 4): Match => ({ color: 1, cells: Array.from({ length: n }, (_, i) => [row, i] as [number, number]) });
const lost = (b: Battle) => 100000 - b.enemies[0].hp;

// ---- data: 4 perk types, every function id used is one the engine understands
const data = JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8'));
assert.deepEqual(data.perks.map((p: any) => [p.id, p.groups.length]), [[0, 8], [1, 7], [2, 6], [3, 6]]);
const ids = new Set<number>();
for (const t of data.perks) for (const g of t.groups) for (const s of g.skills) for (const [id] of s.fx) ids.add(id);
for (const id of ids) assert.ok(id >= 1 && id <= 30 && ![9, 16, 28].includes(id), `unexpected perk function ${id}`);
assert.equal(ids.size, 27, 'every function that skills use is handled');
for (const t of data.perks) for (const g of t.groups) for (const s of g.skills) if (s.id !== 0) assert.ok(s.fx.length > 0 && s.img, `${t.id}/${g.id}/${s.id} has effects and art`);

// ---- damage: +% by colour, team attack, combo, match size
{
  const base = mk([unit()], [[en()]]); base.resolveMove([red(3)]);
  assert.equal(lost(base), 200, 'baseline: 100 attack x2 against colour 4');
  const c = mk([unit()], [[en()]], fx([2, ['1', '0.1']])); c.resolveMove([red(3)]);
  assert.equal(lost(c), 220, 'red +10% on the raw damage, then the type bonus');
  const other = mk([unit()], [[en()]], fx([2, ['2', '0.1']])); other.resolveMove([red(3)]);
  assert.equal(lost(other), 200, 'a blue perk does not help red');
  const a = mk([unit()], [[en()]], fx([1, ['atk', '0.05']])); a.resolveMove([red(3)]);
  assert.equal(lost(a), 210, 'team attack +5%');
  const m10 = mk([unit()], [[en()]], fx([27, ['1', '10', '0.1']]));
  m10.resolveMove([red(5, 3), red(5, 4)]); // 10 red gems over two matches, combo 2
  const ref = mk([unit()], [[en()]]); ref.resolveMove([red(5, 3), red(5, 4)]);
  assert.ok(lost(m10) > lost(ref) && lost(m10) <= Math.ceil(lost(ref) * 1.11), 'match 10 red gems: +10%');
  const m9 = mk([unit()], [[en()]], fx([27, ['1', '10', '0.1']]));
  m9.resolveMove([red(5, 3), red(4, 4)]);
  const ref9 = mk([unit()], [[en()]]); ref9.resolveMove([red(5, 3), red(4, 4)]);
  assert.equal(lost(m9), lost(ref9), 'only 9 gems: no bonus');
  // combo master: 3 combos gives +15% of the raw damage (3 matches = combo 3)
  const cm = mk([unit()], [[en()]], fx([22, ['3', '0.15']]));
  const three = [red(3, 4), red(3, 3), red(3, 2)];
  cm.resolveMove(three);
  const cmRef = mk([unit()], [[en()]]); cmRef.resolveMove(three);
  assert.equal(lost(cmRef), 2 * Math.trunc(300 * 1.5), 'baseline combo 3: 300 raw x1.5 x2 type');
  assert.equal(lost(cm), 2 * (450 + Math.trunc(450 * 0.15)));
  const two = mk([unit()], [[en()]], fx([22, ['3', '0.15']])); two.resolveMove([red(3, 4), red(3, 3)]);
  const twoRef = mk([unit()], [[en()]]); twoRef.resolveMove([red(3, 4), red(3, 3)]);
  assert.equal(lost(two), lost(twoRef), 'two combos is not enough');
}

// ---- type table and defence
{
  const c2c = mk([unit()], [[en()]], fx([10, ['1', '4', '0.5']], [10, ['1', '2', '-0.25']])); c2c.resolveMove([red(3)]);
  assert.equal(lost(c2c), 250, 'red against green: 2.0 + 0.5');
  const pen = mk([unit()], [[en([], { def: 100 })]], fx([15, ['4', '-0.25']])); pen.resolveMove([red(3)]);
  assert.equal(lost(pen), 200 - 75, 'ignores 25% of the defence');
  const none = mk([unit()], [[en([], { def: 100 })]]); none.resolveMove([red(3)]);
  assert.equal(lost(none), 100);
}

// ---- damage taken
{
  const hit = (perks: ReturnType<typeof fx>, hp?: number, atk = 100) => {
    const b = mk([unit()], [[en([], { atk, cd: 1 })]], perks);
    if (hp) b.hp = hp;
    b.resolveMove([{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] }]);
    return (hp ?? 1000) - b.hp;
  };
  assert.equal(hit(fx()), 100);
  assert.equal(hit(fx([3, ['4', '-0.1']])), 90, 'colour resistance against a green enemy');
  assert.equal(hit(fx([3, ['1', '-0.1']])), 100, 'a red resistance does nothing against green');
  assert.equal(hit(fx([19, ['0.4', '-0.1']]), 300), 90, 'at 30% HP the 40% rule resists');
  assert.equal(hit(fx([19, ['0.4', '-0.1']]), 900), 100, 'at 90% HP it does not');
  assert.equal(hit(fx([3, ['4', '-0.1']], [19, ['0.4', '-0.4']]), 300), 100 - 10 - 40, 'both stack');
  // extra damage when low
  const low = mk([unit()], [[en()]], fx([18, ['0.4', '0.33']]));
  low.hp = 300;
  low.resolveMove([red(3)]);
  assert.equal(lost(low), 2 * (100 + Math.trunc(100 * 0.33)), 'low HP: +33% damage');
}

// ---- debuff resistance
{
  const stun = mk([unit(), unit()], [[en([ab(201, ['3'])], { cd: 5 })]], fx([7, ['-2']]));
  stun.resolveMove([{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] }]);
  const stunned = stun.unitSt.filter((u) => u.stun);
  assert.equal(stunned.length, 1);
  assert.equal(stunned[0].stun!.turns, 1, 'a 3-turn stun is cut to 1');
  const poison = mk([unit()], [[en([ab(202, ['3', '0.1'])], { cd: 5, atk: 1 })]], fx([5, ['-0.05']]));
  const idle = [{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] as [number, number][] }];
  poison.resolveMove(idle); poison.resolveMove(idle);
  assert.ok(poison.pFx.poison, 'poisoned');
  const hp0 = poison.hp;
  poison.resolveMove(idle);
  assert.equal(hp0 - poison.hp, 50, 'poison 10% - 5% = 5% of max HP');
  const bomb = mk([unit()], [[en([ab(204, ['1', '200'])], { cd: 1 })]], fx([6, ['-0.2']]));
  bomb.resolveMove(idle);
  assert.ok(bomb.pFx.bomb);
  const before = bomb.hp;
  bomb.resolveMove(idle);
  assert.equal(before - bomb.hp, 160 + 0, 'time bomb damage -20%');
  // gem lock shortened to nothing
  const lockE = [[en([ab(214, ['0', '1', '2', '1'])], { cd: 1 })]];
  const locked = mk([unit()], lockE, fx([8, ['-1']]));
  locked.resolveMove(idle);
  assert.ok(locked.meta.every((r) => r.every((g) => !g || g.lock === 0)), 'a 1-turn lock with -1 turn never lands');
  const long = [[en([ab(214, ['0', '1', '2', '3'])], { cd: 1 })]];
  const l2 = mk([unit()], long, fx([8, ['-1']]));
  l2.resolveMove(idle);
  assert.equal(l2.meta[0][0]?.lockTurns, 2, 'a 3-turn lock becomes 2');
}

// ---- healing and the leech/stalwart trade
{
  const idle = [{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] as [number, number][] }];
  const heal = (perks: ReturnType<typeof fx>, matches = [red(3)], hp = 500) => {
    const b = mk([unit()], [[en()]], perks);
    b.hp = hp;
    b.resolveMove(matches);
    return b.hp - hp;
  };
  assert.equal(heal(fx()), 0);
  assert.equal(heal(fx([23, ['0.05']])), 50, 'auto heal 5% after a combo');
  assert.equal(heal(fx([23, ['0.05']]), idle.map((m) => ({ ...m, color: 5 }))), 50, 'the neutral match is still a combo');
  assert.equal(heal(fx([17, ['0.4', '0.1']]), [red(3)], 300), 100, 'under 40% HP: heal 10%');
  assert.equal(heal(fx([17, ['0.4', '0.1']]), [red(3)], 900), 0, 'above 40%: nothing');
  assert.equal(heal(fx([25, ['50']])), 50, 'one attack lands: 50 HP');
  assert.equal(heal(fx([30, ['0.08', '-0.13']])), 80, 'Stalwart heals 8%');
  const stal = mk([unit()], [[en()]], fx([30, ['0.08', '-0.13']])); stal.resolveMove([red(3)]);
  assert.equal(lost(stal), 2 * 87, 'Stalwart: -13% damage');
  const leech = mk([unit()], [[en()]], fx([30, ['-0.13', '0.05']])); leech.resolveMove([red(3)]);
  assert.equal(1000 - leech.hp, 130, 'Leech costs 13% of max HP a turn');
  assert.equal(lost(leech), 2 * 105, 'Leech: +5% damage');
  // ally skill heal
  const skill = mk([unit({ abilities: [cast] })], [[en()]], fx([24, ['0.1']]));
  skill.unitSt[0].now = skill.unitSt[0].max;
  skill.hp = 500;
  skill.useAbility(0);
  assert.equal(skill.hp, 600, 'skill heal 10% when an ally ability is used');
}

// ---- shapes: T, cross and full rows, named like the original ("red_t", "a1 h6")
{
  const at = (cells: [number, number][]): Match => ({ color: 1, cells: cells.map(([c, row]) => [origRow(row), c] as [number, number]) });
  assert.deepEqual([...shapesOf([at([[1, 2], [2, 2], [3, 2], [2, 1], [2, 0]])])], ['red_t']);
  assert.deepEqual([...shapesOf([at([[1, 2], [2, 2], [3, 2], [2, 3], [2, 4]])])], [], 'a T the wrong way up is not a T');
  assert.deepEqual([...shapesOf([at([[1, 2], [2, 2], [3, 2], [2, 1], [2, 3]])])], ['red_cross']);
  assert.deepEqual([...shapesOf([at([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])])], ['a1 h6']);
  assert.deepEqual([...shapesOf([red(3)])], []);
  const T = at([[1, 2], [2, 2], [3, 2], [2, 1], [2, 0]]);
  const t5 = mk([unit()], [[en()]], fx([4, ['Red_T', '0.05']], [4, ['Blue_T', '0.05']])); t5.resolveMove([T]);
  const base = mk([unit()], [[en()]]); base.resolveMove([T]);
  assert.ok(lost(t5) > lost(base) && lost(t5) <= Math.ceil(lost(base) * 1.06), 'T shape +5% (only the Red_T entry applies)');
  const cure = mk([unit()], [[en()]], fx([29, ['Red_T', '0.1']]));
  cure.hp = 500; cure.resolveMove([T]);
  assert.equal(cure.hp, 600, 'T shape cures 10% of max HP');
}

// ---- the Doctor's skill
{
  const doc = (perks: ReturnType<typeof fx>, enemy = en()) => mk([unit({ isDoctor: true, abilities: [cast] })], [[enemy]], perks);
  assert.equal(doc(fx()).unitSt[0].max, 10);
  assert.equal(doc(fx([11, ['-0.3']])).unitSt[0].max, 7, 'cooldown -30%');
  const ally = mk([unit({ abilities: [cast] })], [[en()]], fx([11, ['-0.3']]));
  assert.equal(ally.unitSt[0].max, 10, 'only the Doctor gets the shorter cooldown');
  const combo = doc(fx([12, ['2']]));
  combo.resolveMove([red(3)]);
  assert.equal(combo.unitSt[0].now, 1 + 2, 'one combo + 2 extra charge');
  const killer = doc(fx([13, ['5']]), en([], { hp: 1 }));
  killer.resolveMove([red(3)]);
  assert.equal(killer.unitSt[0].now, Math.min(10, 1 + 5), 'a kill gives 5 charge');
  const hurt = doc(fx([14, ['3']]), en([], { cd: 1 }));
  hurt.resolveMove([{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.equal(hurt.unitSt[0].now, 1 + 3, 'taking a hit gives 3 charge');
}

// ---- base attributes, move time, drop rate, wave boost
{
  const hp = mk([unit(), unit()], [[en()]], fx([1, ['hp', '0.05']]));
  assert.equal(hp.maxHp, 2100); assert.equal(hp.hp, 2100);
  const heal = mk([unit()], [[en()]], fx([1, ['heal', '0.1']]));
  assert.equal(heal.baseHeal, 55);
  assert.equal(mk([unit()], [[en()]]).moveMs, 5000);
  assert.equal(mk([unit()], [[en()]], fx([26, ['1']])).moveMs, 6000, '+1 second to move a gem');
  assert.equal(mk([unit()], [[en()]], fx([26, ['-1']])).moveMs, 4000);
  const drop = mk([unit()], [[en()]], fx([21, ['1', '5']]));
  assert.deepEqual(drop.weights.find(([c]) => c === 1), [1, 6], 'red weight +5');
  assert.deepEqual(drop.weights.find(([c]) => c === 2), [2, 1]);
  const wave = mk([unit()], [[en()], [en()]], fx([20, ['1', '0.1']]));
  const reds = wave.cellsWhere((r, c) => wave.board[r][c] === 1);
  assert.ok(reds.length > 0 && reds.every(([r, c]) => wave.metaOf(r, c).dbl === 0.1), 'every red gem is boosted at wave start');
  const blues = wave.cellsWhere((r, c) => wave.board[r][c] === 2);
  assert.ok(blues.every(([r, c]) => !wave.metaOf(r, c).dbl));
  assert.ok(wave.nextWave());
  assert.ok(wave.cellsWhere((r, c) => wave.board[r][c] === 1).every(([r, c]) => wave.metaOf(r, c).dbl === 0.1), 'and again for the next wave');
}

// ---- the perk book: stars, season gates, free purchases, picking skills
{
  (globalThis as any).fetch = async () => ({ json: async () => data });
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  const d = await import('../src/data.ts');
  await d.loadData();
  const save = await import('../src/save.ts');
  const pb = await import('../src/perkbook.ts');
  save.loadSave();
  const { SAVE } = save;
  const ranks = Object.keys(SAVE.owned).reduce((n, id) => n + d.DATA.units[id].r, 0);
  assert.equal(pb.starCount(), ranks, 'stars are the summed rank of owned units');
  assert.ok(pb.typeUnlocked(0) && pb.typeUnlocked(1));
  assert.ok(!pb.typeUnlocked(2) && !pb.typeUnlocked(3), 'Perk 2 and 3 need Season 7 / Season 6');
  // a star-gated group follows the star count
  const g0 = d.DATA.perks as any[];
  const p1 = g0.find((t) => t.id === 1);
  const first = p1.groups[0];
  assert.equal(pb.groupUnlocked(1, first.id), pb.starCount() >= first.star);
  const need = p1.groups.find((g: any) => g.star > pb.starCount());
  assert.ok(need && !pb.groupUnlocked(1, need.id));
  assert.equal(pb.unlockGroup(1, need.id), false, 'star groups cannot be bought');
  assert.equal(pb.chooseSkill(1, need.id, 1), false, 'a locked group cannot be picked from');
  // a crystal group buys for free, with no crystals at all
  assert.equal(save.itemCount(save.CRYSTAL), 0);
  const s0 = g0.find((t) => t.id === 0);
  const dmg = s0.groups.find((g: any) => g.n === 'Increase Damage');
  assert.ok(!pb.groupUnlocked(0, dmg.id));
  assert.equal(pb.chooseSkill(0, dmg.id, 1), false);
  assert.ok(pb.unlockGroup(0, dmg.id), 'purchase approved automatically');
  assert.equal(save.itemCount(save.CRYSTAL), 0, 'no crystals were spent');
  assert.equal(pb.unlockGroup(0, dmg.id), false, 'buying twice does nothing');
  assert.ok(pb.chooseSkill(0, dmg.id, 1));
  assert.equal(pb.chosenSkill(0, dmg.id), 1);
  assert.equal(pb.chooseSkill(0, dmg.id, 99), false, 'unknown skill');
  const perks = pb.activePerks();
  for (let c = 1; c <= 5; c++) assert.equal(perks.colorDmg[c], 0.1, `Increase All Damage covers colour ${c}`);
  assert.ok(pb.chooseSkill(0, dmg.id, 0));
  assert.equal(pb.activePerks().colorDmg[1], 0, 'None clears it');
  // stars open groups: add every unit and a high star group opens
  for (const u of Object.values(d.DATA.units)) if (u.lp.length) save.grantUnit(u.id);
  assert.ok(pb.starCount() > 500);
  assert.ok(pb.groupUnlocked(1, 6) && pb.groupUnlocked(1, 3));
  assert.ok(pb.chooseSkill(1, 3, 2));
  assert.equal(pb.activePerks().hpPcts.length, 1);
  assert.ok(!pb.typeUnlocked(2), 'stars do not open season-gated types');
  // finishing the season opens the type (and its groups, which are star gated)
  for (const s of d.flowSeasons()) if (s.name === 'Season 7') for (const g of s.groups) for (const l of g.levels) SAVE.cleared[l.id] = 1;
  assert.ok(pb.typeUnlocked(2) && !pb.typeUnlocked(3));
  assert.ok(pb.chooseSkill(2, 0, 3));
  assert.equal(pb.activePerks().stun, -2);
  // the save format round-trips
  save.persist();
  assert.ok(JSON.parse(store.get('dwl.save.v1')!).perks.chosen['2:0'] === 3);
}

console.log('perk tests passed');
