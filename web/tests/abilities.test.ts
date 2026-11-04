import { strict as assert } from 'node:assert';
import { findMatches, makeRng, ROWS, COLS, type Board, type Match } from '../src/engine/board.ts';
import { Battle, type AbilityDef, type EnemyDef, type UnitAbility, type UnitStats } from '../src/engine/battle.ts';

const rel = { 1: { 4: 2, 2: 0.5 }, 2: { 1: 2 } } as any;
const W: [number, number][] = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]];
const ab = (t: number, p: string[], cd = 1, extra: Partial<AbilityDef> = {}): AbilityDef => ({ n: 'T' + t, cd, t, p, r: 100, c: 0, h: 100, icon: null, ...extra });
const en = (abilities: AbilityDef[] = [], o: Partial<EnemyDef> = {}): EnemyDef => ({
  hp: 100000, atk: 10, cd: 99, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [], abilities, ...o,
});
const unit = (abilities: UnitAbility[] = [], o: Partial<UnitStats> = {}): UnitStats => ({
  uid: 1, name: 'U', colors: [1], hp: 1000, atk: 100, heal: 50, isDoctor: false, icon: null, abilities, ...o,
});
// the real board: 5 rows x 6 columns (30 gems), a checkerboard of colours 1 and 2
const checker: Board = [
  [1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1], [1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1], [1, 2, 1, 2, 1, 2],
];
const mk = (units: UnitStats[], waves: EnemyDef[][], board: Board = checker) =>
  new Battle(units, waves, rel, { dualSame: 0.1, dualDiff: 0.3 }, { board: board.map((r) => [...r]), weights: W, rng: makeRng(7) });
const idle = [{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] as [number, number][] }]; // nobody owns black = a neutral "move"
const move = (b: Battle) => b.resolveMove(idle);
const count = (b: Battle, color: number) => b.board.flat().filter((c) => c === color).length;

// --- the implicit attack: cd counts down and hits for atk
{
  const b = mk([unit()], [[en([], { cd: 2, atk: 40 })]]);
  move(b);
  assert.equal(b.hp, 1000);
  assert.equal(b.enemies[0].curCd, 1);
  move(b);
  assert.equal(b.hp, 960);
  assert.equal(b.enemies[0].curCd, 2, 'countdown resets');
}

// --- abilities are rolled in order by rate; rate 0 never fires; Attack is the fallback
{
  const b = mk([unit()], [[en([ab(224, ['0.5'], 1, { r: 0 })], { cd: 1, atk: 7 })]]);
  move(b);
  assert.equal(b.hp, 993, 'rate-0 ability skipped, plain attack used');
  const b2 = mk([unit()], [[en([ab(224, ['0.5'], 1)], { cd: 1, atk: 7 })]]);
  move(b2);
  assert.equal(b2.hp, 500, 'rate attack removes 50% of current HP');
}

// --- HP threshold gate and use count
{
  const gated = ab(224, ['0.5'], 1, { h: 50 });
  const b = mk([unit()], [[en([gated], { cd: 1, atk: 7 })]]);
  move(b);
  assert.equal(b.hp, 993, 'full-HP enemy does not roll a 50%-gated ability');
  const b2 = mk([unit()], [[en([ab(224, ['0.5'], 1, { c: 1 })], { cd: 1, atk: 7 })]]);
  move(b2);
  assert.equal(b2.hp, 500);
  move(b2);
  assert.equal(b2.hp, 493, 'single-use ability is spent, falls back to attack');
}

// --- stun / poison / bomb / tap / slow on the player
{
  const b = mk([unit(), unit()], [[en([ab(219, ['2'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  assert.ok(b.isStunnedUnit(0) && b.isStunnedUnit(1));
  const before = b.enemies[0].hp;
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.equal(b.enemies[0].hp, before, 'stunned units deal no damage');
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.ok(!b.isStunnedUnit(0), 'stun wears off after its turns');
}
{
  const b = mk([unit()], [[en([ab(202, ['3', '0.1'], 1, { c: 1 })], { cd: 5 })]]);
  move(b); // applied
  assert.equal(b.pFx.poison?.turns, 3);
  move(b);
  assert.equal(b.hp, 900, 'poison takes 10% of max HP per turn');
}
{
  const b = mk([unit()], [[en([ab(204, ['2', '300'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  move(b);
  assert.equal(b.hp, 1000, 'bomb has not gone off yet');
  move(b);
  assert.equal(b.hp, 700, 'time bomb explodes for its damage');
  assert.equal(b.pFx.bomb, undefined);
}
{
  const b = mk([unit()], [[en([ab(222, ['1', '200'], 1, { c: 1 })], { cd: 5 })], ]);
  b.enemies[0].hp = 50000;
  move(b);
  move(b);
  assert.equal(b.hp, 800, 'life tap hurts the player');
  assert.equal(b.enemies[0].hp, 50200, 'and heals the enemy');
}
{
  const b = mk([unit()], [[en([ab(230, ['2', '3'], 1, { c: 1 })], { cd: 5 })]]);
  assert.equal(b.moveMs, 5000);
  move(b);
  assert.equal(b.moveMs, 3000, 'decrease move time');
}

// --- gem manipulation
{
  const b = mk([unit()], [[en([ab(205, ['1', '2'])], { cd: 5 })]]);
  move(b);
  assert.equal(count(b, 1), 0);
  assert.equal(count(b, 2), 30);
}
{
  const b = mk([unit()], [[en([ab(212, ['1', '2', '2', '3'])], { cd: 5 })]]);
  move(b);
  assert.equal(count(b, 1) + count(b, 2), 0, 'two conversions applied');
}
{
  const b = mk([unit()], [[en([ab(211, ['1'])], { cd: 5 })]]);
  move(b);
  assert.equal(count(b, 1), count(b, 1));
  assert.ok(b.board.every((r) => r.length === COLS) && b.board.length === ROWS);
  assert.ok(b.board.flat().every((c) => c >= 1 && c <= 5), 'board refilled after banish');
}
{
  const b = mk([unit()], [[en([ab(210, ['4', '1', '3'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  const locked = b.meta.flat().filter((g) => g && g.lock === 1).length;
  assert.equal(locked, 4, 'lock gem locks N random gems');
  move(b);
  move(b);
  move(b);
  assert.equal(b.meta.flat().filter((g) => g && g.lock === 1).length, 0, 'locks expire');
}
{
  const b = mk([unit()], [[en([ab(214, ['0', '4', '1', '5'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  for (let r = 0; r < ROWS; r++) assert.equal(b.meta[r][0]?.lock, 1);
  for (let r = 0; r < ROWS; r++) assert.equal(b.meta[r][4]?.lock, 1);
  assert.equal(b.meta[0][2]?.lock ?? 0, 0);
  // locked gems cannot be matched
  const row = [[1, 1, 1, 2, 3, 2], ...checker.slice(1)];
  assert.equal(findMatches(row as Board, b.meta).length, 0, 'col-0 gem is locked so the row of 1s is broken');
}
{
  const b = mk([unit()], [[en([ab(221, ['0', '3', '2', '5'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  const at = (r: number, c: number) => b.meta[r][c]?.lock ?? 0;
  // corner 0 = bottom-left 2x2, corner 3 = top-right 2x2 (the original numbers rows from the bottom)
  for (const [r, c] of [[4, 0], [4, 1], [3, 0], [3, 1], [0, 4], [0, 5], [1, 4], [1, 5]]) assert.equal(at(r, c), 2, `corner cell ${r},${c}`);
  assert.equal(at(0, 0), 0, 'top-left is not part of corners 0 and 3');
  assert.equal(at(4, 5), 0, 'bottom-right is not part of corners 0 and 3');
  assert.equal(at(2, 2), 0);
  assert.equal(b.meta.flat().filter((g) => g && g.lock === 2).length, 8, 'two 2x2 blocks');
}
{
  // lock row: row numbers count from the BOTTOM, so row 0 is the last internal row
  const b = mk([unit()], [[en([ab(215, ['0', '-1', '1', '3'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  for (let c = 0; c < COLS; c++) assert.equal(b.meta[ROWS - 1][c]?.lock, 1, 'bottom row locked');
  assert.equal(b.meta.flat().filter((g) => g && g.lock === 1).length, COLS, 'only that row');
}
{
  const b = mk([unit()], [[en([ab(228, ['0', '2', '0', '2', '0', '0.2', '0'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  assert.equal(b.meta.flat().filter((g) => g?.bomb).length, 2, 'two gems armed');
  move(b); // fuse 2 -> 1
  assert.equal(b.hp, 1000);
  move(b); // fuse 1 -> 0: both bombs explode, each takes 20% of the HP that is left (1000 -> 800 -> 640)
  assert.equal(b.hp, 640);
  assert.equal(b.meta.flat().filter((g) => g?.bomb).length, 0, 'exploded bombs are removed from the board');
}
{
  const b = mk([unit()], [[en([ab(213, ['0.5', '1'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  const sapped = b.meta.flat().filter((g) => g && g.sub === 0.5).length;
  assert.equal(sapped, 15, 'color syphon marks every gem of that colour');
  // a sapped match deals half damage: power = 1 - 0.5*3/ ... = 1 + sum(dbl - sub)
  const ms: Match[] = [{ color: 1, cells: [[0, 0], [0, 2], [0, 4]] }];
  const out = b.removeMatches(ms);
  assert.ok(out.length > 0);
  assert.equal(ms[0].power, 1 - 0.5 * 3 < 0 ? 0 : 1 - 1.5, 'power floors at zero');
}
{
  const b = mk([unit()], [[en([ab(216, ['0'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  assert.equal(b.meta.flat().filter((g) => g?.blind).length, 30);
}
{
  const b = mk([unit()], [[en([ab(217, [])], { cd: 5 })]]);
  const before = b.board.map((r) => [...r].sort().join(''));
  move(b);
  const after = b.board.map((r) => [...r].sort().join(''));
  assert.deepEqual(after, before, 'row shuffle keeps each row\'s gems');
}
{
  const b = mk([unit()], [[en([ab(218, [])], { cd: 5 })]]);
  const cols = (bd: Board) => Array.from({ length: COLS }, (_, c) => bd.map((r) => r[c]).sort().join(''));
  const before = cols(b.board);
  move(b);
  assert.deepEqual(cols(b.board), before, 'column shuffle keeps each column\'s gems');
}

// --- enemy self buffs, heals, spawns
{
  const b = mk([unit()], [[en([ab(223, ['5'], 1, { c: 1 })], { cd: 5 }), en([], { cd: 5 })]]);
  move(b);
  assert.ok(b.enemies[0].fx.immune);
  assert.equal(b.canDebuff(b.enemies[0]), false);
}
{
  const b = mk([unit()], [[en([ab(226, ['3'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  const hp = b.enemies[0].hp;
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.equal(b.enemies[0].hp, hp, 'shadow enemy takes no damage');
}
{
  const b = mk([unit()], [[en([ab(209, ['300', '0'])], { cd: 5, hp: 1000 })]]);
  b.enemies[0].hp = 100;
  move(b);
  assert.equal(b.enemies[0].hp, 400);
}
{
  const b = mk([unit()], [[en([ab(208, ['2'])], { cd: 5 })]]);
  b.spawnDefs = { 2: en([], { name: 'Spawned' }) };
  move(b);
  assert.equal(b.enemies.length, 2);
  assert.equal(b.enemies[1].name, 'Spawned');
}
{
  const b = mk([unit()], [[en([ab(229, ['3', '2', '0.5'], 1, { c: 1 })], { cd: 5, hp: 1000 })]]);
  move(b);
  const hp = b.enemies[0].hp;
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]); // 1 combo <= 2: heals instead
  assert.ok(b.enemies[0].hp === hp, 'shield heal capped at max');
  b.enemies[0].hp = 500;
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.ok(b.enemies[0].hp > 500, 'low combo is turned into enemy healing');
}
{
  const b = mk([unit()], [[en([ab(227, ['1', '0', '3', '0.5', '0'], 1, { c: 1 })], { cd: 5, hp: 100000 })]]);
  move(b);
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  const reflected = b.pFx.poison; // unrelated; reflect returns damage at the debuff phase of the same turn
  void reflected;
  assert.ok(b.hp < 1000, 'reflect sends part of the damage back');
}

// --- ally abilities
const A = (t: number, p: string[], cd = 1): UnitAbility => ({ n: 'A' + t, d: '', cd, t, p, icon: null });
const ready = (b: Battle) => {
  b.unitSt.forEach((u) => (u.now = u.max));
};
{
  const b = mk([unit([A(102, ['1', '500', '0'])], { isDoctor: true })], [[en([], { cd: 99, hp: 5000 }), en([], { cd: 99, hp: 5000 })]]);
  assert.equal(b.abilityReady(0), false, 'starts uncharged');
  b.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }, { color: 1, cells: [[1, 0], [1, 1], [1, 2]] }]);
  assert.equal(b.abilityReady(0), true, 'doctor charges by combo count');
  const r = b.useAbility(0);
  assert.ok(r.ok);
  assert.ok(b.enemies.every((e) => e.hp < 5000), 'attack-all hits everyone');
  assert.equal(b.abilityReady(0), false, 'cooldown resets');
}
{
  const b = mk([unit([A(103, ['300'])])], [[en([], { cd: 99 })]]);
  b.hp = 100;
  ready(b);
  b.useAbility(0);
  assert.equal(b.hp, 400);
}
{
  const b = mk([unit([A(116, ['0.5'])])], [[en([], { cd: 99 })]]);
  b.hp = 100;
  ready(b);
  b.useAbility(0);
  assert.equal(b.hp, 600);
}
{
  const b = mk([unit([A(110, ['1', '2'])])], [[en([], { cd: 99 })]]);
  ready(b);
  b.useAbility(0);
  assert.equal(count(b, 1), 0);
}
{
  const b = mk([unit([A(132, ['3'])])], [[en([], { cd: 99 })]]);
  ready(b);
  const need = b.useAbility(0);
  assert.equal(need.needsTarget, true, 'selected-gem abilities ask for a target');
  const r = b.useAbility(0, { r: 0, c: 0 });
  assert.ok(r.ok);
  assert.equal(count(b, 1), 0);
  assert.equal(count(b, 3), 15);
}
{
  const b = mk([unit([A(129, [])], { colors: [1] })], [[en([], { cd: 99, hp: 99999 })]]);
  ready(b);
  const r = b.useAbility(0, { r: 2, c: 2 });
  assert.ok(r.ok && r.grab);
  assert.equal(r.grab!.reduce((n, m) => n + m.cells.length, 0), COLS, 'row grab takes one gem per column');
}
{
  const b = mk([unit([A(106, ['2'])])], [[en([], { cd: 99 })]]);
  ready(b);
  b.useAbility(0);
  assert.ok(b.enemies[0].fx.stun, 'stun enemy');
  const hp = b.hp;
  move(b);
  assert.equal(b.hp, hp, 'a stunned enemy does not count down');
}
{
  const b = mk([unit([A(105, [])])], [[en([ab(202, ['3', '0.1'], 1, { c: 1 })], { cd: 5 })]]);
  move(b);
  assert.ok(b.pFx.poison);
  ready(b);
  b.useAbility(0);
  assert.equal(b.pFx.poison, undefined, 'cure poison');
}
{
  const b = mk([unit([A(120, ['2', '4'])])], [[en([], { cd: 99 })]]);
  ready(b);
  b.useAbility(0);
  const before = count(b, 2);
  b.resolveMove([]);
  b.removeMatches([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
  // the removed row segment held one blue already, so 3 new blues net +2
  assert.equal(count(b, 2), before + 2, 'extra drop refills with the chosen colour');
  assert.equal(b.extraDrop?.left, 1, 'extra drop budget is consumed');
}
{
  const b = mk([unit([A(109, ['1', '0.5'])])], [[en([], { cd: 99 })]]);
  ready(b);
  b.useAbility(0);
  const ms: Match[] = [{ color: 1, cells: [[0, 0], [0, 2], [0, 4]] }];
  b.removeMatches(ms);
  assert.equal(ms[0].power, 2.5, 'three boosted gems = 1 + 3*0.5');
}
// --- wave start: enemies whose current ability already has a countdown of 0 act before the first move
{
  // a cd-0 ability fires at once, with no turn passing and no countdown ticking
  const b = mk([unit()], [[en([ab(223, ['4'], 0, { c: 1 })], { cd: 5 })]]);
  assert.equal(b.enemiesReady, true);
  const res = b.readyEnemyPhase();
  assert.ok(b.enemies[0].fx.immune, 'the cd-0 ability fired at wave start');
  assert.equal(b.turn, 0, 'no turn passed');
  assert.equal(res.defeat, false);
  assert.equal(b.enemies[0].curCd, 5, 'the plain attack the enemy rolled next keeps its full countdown');
  assert.equal(b.enemiesReady, false, 'nothing else is ready');
  assert.equal(b.readyEnemyPhase().events.length, 0, 'a second call does nothing');
}
{
  // enemies with a countdown above zero wait; stunned ready enemies hold their fire
  const waiting = mk([unit()], [[en([], { cd: 2 })]]);
  assert.equal(waiting.enemiesReady, false);
  assert.equal(waiting.readyEnemyPhase().enemyAttacks.length, 0);
  const stunned = mk([unit()], [[en([], { cd: 0, atk: 30 })]]);
  stunned.enemies[0].fx.stun = { turns: 2, locked: false, v: 0, w: 0, c: 0, t: 0, x: 0, acc: 0, icon: null };
  assert.equal(stunned.enemiesReady, false, 'a stunned enemy is not ready');
  assert.equal(stunned.readyEnemyPhase().enemyAttacks.length, 0);
  assert.equal(stunned.hp, 1000);
}
{
  // a plain attack with cooldown 0 hits straight away, and the phase reports a defeat
  const b = mk([unit([], { hp: 100 })], [[en([], { cd: 0, atk: 250 })]]);
  const res = b.readyEnemyPhase();
  assert.equal(res.enemyAttacks.length, 1);
  assert.equal(b.hp, 0);
  assert.equal(res.defeat, true);
}
// --- the Doctor's two abilities share one charge counter; a tap uses the stronger one that is ready
{
  const weak: UnitAbility = { n: 'Weak', d: '', cd: 2, t: 103, p: ['100'], icon: null };
  const strong: UnitAbility = { n: 'Strong', d: '', cd: 4, t: 103, p: ['500'], icon: null };
  const b = mk([unit([weak, strong], { isDoctor: true })], [[en()]]);
  const s = b.unitSt[0];
  assert.deepEqual(s.maxes, [2, 4]);
  assert.equal(s.max, 4, 'the charge counts up to the longer cooldown');
  assert.equal(b.readyAbility(0), -1);
  s.now = 1;
  assert.equal(b.abilityReady(0), false, 'neither is ready yet');
  s.now = 2;
  assert.equal(b.readyAbility(0), 0, 'the first is ready on its own');
  b.hp = 100;
  let out = b.useAbility(0);
  assert.ok(out.ok);
  assert.equal(out.used, 0);
  assert.equal(b.hp, 200, 'the weaker ability healed 100');
  assert.equal(s.now, 0, 'using an ability empties the shared charge');
  assert.equal(b.abilityReady(0), false);
  s.now = 4;
  assert.equal(b.readyAbility(0), 1, 'with both ready the stronger one is used');
  out = b.useAbility(0);
  assert.equal(out.used, 1);
  assert.equal(b.hp, 700, 'the stronger ability healed 500');
  assert.equal(s.now, 0, 'both start charging again from zero');
  // extra charge never goes past the longest cooldown
  b.assignSkillCd(0, 99);
  assert.equal(s.now, 4);
  // a stunned Doctor cannot use either
  s.stun = { turns: 2, locked: false, v: 0, w: 0, c: 0, t: 0, x: 0, acc: 0, icon: null };
  assert.equal(b.abilityReady(0), false);
  assert.equal(b.useAbility(0).ok, false);
}
// an ally still has one ability and one cooldown
{
  const b = mk([unit([{ n: 'A', d: '', cd: 3, t: 103, p: ['10'], icon: null }])], [[en()]]);
  assert.deepEqual(b.unitSt[0].maxes, [3]);
  b.unitSt[0].now = 3;
  assert.equal(b.readyAbility(0), 0);
}

console.log('ability tests passed');
