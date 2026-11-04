import { strict as assert } from 'node:assert';
import { COLS, ROWS, findMatches, makeRng, newBoard, resolveAll, type Board } from '../src/engine/board.ts';
import { Battle, comboDamage, matchGemDamage, totalDamage, type DropRow } from '../src/engine/battle.ts';

const W: [number, number][] = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
const rel = { 1: { 4: 2, 2: 0.5 }, 2: { 1: 2 } } as any;

// new boards never start with matches and every cell is a real gem
for (let s = 1; s <= 200; s++) {
  const b = newBoard(W, makeRng(s));
  assert.equal(findMatches(b).length, 0, `seed ${s} starts with a match`);
  assert.ok(b.length === ROWS && b.every((r) => r.length === COLS && r.every((c) => c >= 1 && c <= 6)));
}

// horizontal 3, vertical 4, and an L shape merge correctly (the real board is 6 columns x 5 rows)
const mk = (rows: string[]): Board => rows.map((r) => [...r].map(Number));
let b = mk(['111234', '234512', '451235', '312451', '523143']);
let m = findMatches(b);
assert.equal(m.length, 1);
assert.equal(m[0].cells.length, 3);
b = mk(['123452', '135245', '142531', '154324', '215135']);
m = findMatches(b);
assert.equal(m.length, 1);
assert.equal(m[0].cells.length, 4);
b = mk(['162345', '153426', '111234', '524361', '235142']);
m = findMatches(b);
assert.equal(m.length, 1, 'L shape is one match');
assert.equal(m[0].cells.length, 5);

// resolveAll terminates with a stable, full board
for (let s = 1; s <= 200; s++) {
  const rng = makeRng(s);
  const bb = newBoard(W, rng);
  bb[2][1] = bb[2][2] = bb[2][3] = 1; // force a match
  const steps = resolveAll(bb, W, rng);
  assert.ok(steps.length >= 1);
  assert.equal(findMatches(bb).length, 0);
  assert.ok(bb.every((r) => r.every((c) => c >= 1 && c <= 6)));
}

// formulas from the decompiled BattleFormula
assert.equal(comboDamage(100, 1), 100);
assert.equal(comboDamage(100, 5), 200);
assert.equal(matchGemDamage(100, 3), 100);
assert.equal(matchGemDamage(100, 5), 150);
assert.equal(totalDamage(100, 1, 10, 4, rel), 190);
assert.equal(totalDamage(100, 1, 10, 2, rel), 40);
assert.equal(totalDamage(1, 1, 99, 2, rel), 1, 'damage never below 1');

// battle: red unit hits a green enemy, enemy countdown ticks and hits back
const unit = { uid: 1, name: 'T', colors: [1], hp: 100, atk: 100, heal: 10, isDoctor: true, icon: null };
const en = (hp: number, cd: number) => ({ hp, atk: 7, cd, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [] as DropRow[] });
const bt = new Battle([unit], [[en(500, 2)], [en(10, 1)]], rel, { dualSame: 0.1, dualDiff: 0.3 });
let r = bt.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
assert.equal(r.hits[0].amount, 200);
assert.equal(bt.enemies[0].hp, 300);
assert.equal(r.enemyAttacks.length, 0);
assert.equal(bt.enemies[0].curCd, 1);
r = bt.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] }]);
assert.equal(r.hits[0].amount, 300); // 100 * 1.5 (five gems), x2 weakness
assert.equal(bt.enemies[0].alive, false);
assert.ok(r.waveCleared && !r.victory);
assert.ok(bt.nextWave());
r = bt.resolveMove([{ color: 1, cells: [[0, 0], [0, 1], [0, 2]] }]);
assert.ok(r.victory);

// heal caps at max hp, and an enemy at cd 1 attacks right away
const bt2 = new Battle([unit], [[en(9999, 1)]], rel, { dualSame: 0.1, dualDiff: 0.3 });
bt2.hp = 40;
r = bt2.resolveMove([{ color: 6, cells: [[0, 0], [0, 1], [0, 2]] }]);
assert.equal(r.heal, 10);
assert.equal(r.enemyAttacks.length, 1);
assert.equal(bt2.hp, 43);
// a swap that makes no match still ends the turn: enemy cooldowns tick and they attack (original CheckPath state)
{
  const bt3 = new Battle([unit], [[en(500, 2)]], rel, { dualSame: 0.1, dualDiff: 0.3 });
  bt3.resolveMove([]);
  assert.equal(bt3.enemies[0].curCd, 1, 'cooldown ticks on a move with no match');
  assert.equal(bt3.hp, 100);
  const out = bt3.resolveMove([]);
  assert.equal(out.enemyAttacks.length, 1, 'and the enemy attacks when it reaches zero');
  assert.equal(bt3.hp, 93);
  assert.equal(out.hits.length, 0);
  assert.equal(bt3.unitSt[0].now, 0, 'no combo, so no ability charge');
}
console.log('engine tests passed');
