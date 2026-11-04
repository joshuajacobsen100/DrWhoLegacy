// Special gems: skins, the useless gem 7, and crack obstacles.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { COLS, CRACK, ROWS, USELESS, findMatches, makeRng, type Board } from '../src/engine/board.ts';
import { Battle, type EnemyDef } from '../src/engine/battle.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const data = await import('../src/data.ts');
await data.loadData();
const { DATA, gemColor, gemWeights, gemSkins, buildGrids, crackImage } = data;

// ---- skins map onto colours
assert.equal(gemColor(1), 1);
assert.equal(gemColor(7), USELESS);
assert.equal(gemColor(74), 1, 'pixel skin gem 74 plays as red');
assert.equal(gemColor(79), 6, 'pixel skin gem 79 plays as pink (heal)');
for (const [id, attr] of Object.entries(DATA.gemAttr)) assert.ok(attr >= 1 && attr <= 7, `gem ${id} has colour ${attr}`);

// a skinned level: pixel gems 74-79 spawn as colours 1-6 and use the skin art
const pixel = Object.values(DATA.levels).find((l) => l.gems.some(([id]) => id === 74))!;
const pw = gemWeights(pixel);
assert.deepEqual(pw.map(([c]) => c).sort(), [1, 2, 3, 4, 5, 6]);
const ps = gemSkins(pixel);
assert.equal(ps[1], 74);
assert.equal(ps[6], 79);

// a level that includes the useless gem with a real rate
const withSeven = Object.values(DATA.levels).find((l) => l.gems.some(([id, r]) => id === 7 && r > 0))!;
assert.ok(gemWeights(withSeven).some(([c]) => c === USELESS), 'gem 7 spawns when its rate is > 0');
const noSeven = Object.values(DATA.levels).find((l) => l.gems.some(([id, r]) => id === 7 && r === 0))!;
assert.ok(!gemWeights(noSeven).some(([c]) => c === USELESS), 'gem 7 with rate 0 never spawns');

// every skin image was exported
for (const id of Object.keys(DATA.gemAttr)) {
  assert.ok(readFileSync(new URL(`../public/img/gems/gem${id}.png`, import.meta.url)).length > 100, `gem${id}.png missing`);
}

// ---- the useless gem never matches
const mk = (rows: string[]): Board => rows.map((r) => [...r].map(Number));
assert.equal(findMatches(mk(['77712', '21432', '34521', '45123', '51234', '12345'])).length, 0, 'three 7s in a row are not a match');
assert.equal(findMatches(mk(['11123', '21432', '34521', '45123', '51234', '12345'])).length, 1, 'real colours still match');
assert.equal(findMatches(mk(['88812', '21432', '34521', '45123', '51234', '12345'])).length, 0, 'cracks never match');

// ---- crack obstacles
const en = (): EnemyDef => ({ hp: 99999, atk: 1, cd: 99, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [] });
const base: Board = [ // 5 rows x 6 columns
  [1, 2, 3, 4, 5, 1], [2, 3, 4, 5, 1, 2], [3, 4, 5, 1, 2, 3], [4, 5, 1, 2, 3, 4], [5, 1, 2, 3, 4, 5],
];
const W: [number, number][] = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]];
const b = new Battle([{ uid: 1, name: 'U', colors: [1], hp: 100, atk: 10, heal: 1, isDoctor: true, icon: null }], [[en()], [en()]], DATA.typeRel, { dualSame: 0.1, dualDiff: 0.3 }, {
  board: base.map((r) => [...r]),
  weights: W,
  rng: makeRng(3),
  // grid cells are [col, row, obstacle] with row 0 at the bottom: (col 1,row 2) -> board[2][1]; (col 4,row 0) -> board[4][4]; wave 2: (col 3,row 3) -> board[1][3]
  grids: [[[1, 2, 4], [4, 0, 1]], [[3, 3, 3]]],
});
assert.equal(b.board[2][1], CRACK);
assert.equal(b.meta[2][1]?.crack, 4);
assert.equal(b.meta[2][1]?.lock, 6);
assert.equal(b.board[4][4], CRACK, 'row 0 is the bottom row');
// cracks cannot be matched or swapped/picked
assert.equal(findMatches(b.board, b.meta).length, 0);
// a crack stays in place while the gems above it are cleared; gems land on top of it
b.board[1][1] = b.board[0][1] = 1;
const above = b.board[1][1];
b.removeMatches([{ color: 1, cells: [[1, 1], [0, 1]] }]);
assert.equal(b.board[2][1], CRACK, 'crack is not removed by a nearby match');
assert.ok(above > 0);
// next wave: old cracks become normal gems, new ones appear
b.nextWave();
assert.equal(b.meta[2][1]?.crack ?? 0, 0);
assert.ok(b.board[2][1] >= 1 && b.board[2][1] <= 6, 'old crack reverted to a plain colour');
assert.equal(b.board[4][4] >= 1 && b.board[4][4] <= 6, true);
assert.equal(b.board[1][3], CRACK);
assert.equal(b.meta[1][3]?.crack, 3);
// a board reset keeps the wave's cracks
b.resetBoard();
assert.equal(b.board[1][3], CRACK);
assert.equal(b.board.flat().filter((c) => c === CRACK).length, 1);
// cracks are skipped by colour conversion and by shuffles
b.convertColor(1, 2);
assert.equal(b.board[1][3], CRACK);

// ---- all real wave grids are inside the 6x5 board and use known obstacles
let grids = 0;
for (const lv of Object.values(DATA.levels)) {
  buildGrids(lv).forEach((g) => {
    if (!g) return;
    grids++;
    for (const [c, r, v] of g) {
      assert.ok(r >= 0 && r < ROWS && c >= 0 && c < COLS, `level ${lv.id}: cell col ${c} row ${r} out of range`);
      assert.ok(DATA.obstacles[String(v)] !== undefined, `level ${lv.id}: unknown obstacle ${v}`);
      assert.ok(readFileSync(new URL(`../public/${crackImage(v)}`, import.meta.url)).length > 100);
    }
  });
}
assert.equal(grids, 143, 'expected 143 waves with obstacle grids');
console.log('special gem tests passed');
