// Timed levels: the level clock, "Increase Time Limit", and the real timed levels.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { makeRng } from '../src/engine/board.ts';
import { Battle, type EnemyDef, type UnitAbility, type UnitStats } from '../src/engine/battle.ts';
import { playLevel } from './bot.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const data = await import('../src/data.ts');
await data.loadData();
const { DATA, buildWaves, buildSpawnDefs, buildGrids, gemWeights, statsAt, unitMaxLevel } = data;

const en = (): EnemyDef => ({ hp: 99999, atk: 1, cd: 99, def: 0, color: 4, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [] });
const A = (t: number, p: string[]): UnitAbility => ({ n: 'A' + t, d: '', cd: 1, t, p, icon: null });
const unit = (abilities: UnitAbility[] = []): UnitStats => ({ uid: 1, name: 'U', colors: [1], hp: 100, atk: 10, heal: 1, isDoctor: false, icon: null, abilities });
const mk = (limit: number | undefined, abilities: UnitAbility[] = []) =>
  new Battle([unit(abilities)], [[en()]], DATA.typeRel, { dualSame: 0.1, dualDiff: 0.3 }, { rng: makeRng(1), timeLimit: limit });

// ---- untimed levels have no clock
{
  const b = mk(undefined);
  assert.equal(b.timed, false);
  b.tickTime(10_000_000);
  assert.equal(b.timeUp, false, 'an untimed level never runs out of time');
}
{
  const b = mk(0);
  assert.equal(b.timed, false, 'limit 0 means untimed (as in the level data)');
}

// ---- the clock counts down and stops at zero
{
  const b = mk(60);
  assert.equal(b.timed, true);
  assert.equal(b.timeLeftMs, 60_000);
  b.tickTime(15_000);
  assert.equal(b.timeLeftMs, 45_000);
  assert.equal(b.timeUp, false);
  b.tickTime(45_000);
  assert.equal(b.timeUp, true);
  b.tickTime(5_000);
  assert.equal(b.timeLeftMs, 0, 'never goes negative');
}

// ---- Increase Time Limit (ability 122)
{
  const b = mk(60, [A(122, ['20'])]);
  b.tickTime(50_000);
  b.unitSt[0].now = b.unitSt[0].max;
  const out = b.useAbility(0);
  assert.ok(out.ok);
  assert.equal(b.timeLeftMs, 30_000, '10s left + 20s');
  assert.equal(b.timeLimitMs, 80_000, 'the budget grows too, so the bar stays meaningful');
  assert.equal(b.abilityReady(0), false, 'charge is spent');
}
{
  const b = mk(undefined, [A(122, ['20'])]);
  b.unitSt[0].now = b.unitSt[0].max;
  const out = b.useAbility(0);
  assert.equal(out.ok, false, 'no point extending an untimed level');
  assert.equal(b.abilityReady(0), true, 'and the charge is kept');
  assert.ok(b.evs.some((e) => e.k === 'text'), 'player is told why');
}

// ---- Continue after a defeat (the original's game-over continue; free here)
{
  const b = mk(60);
  b.tickTime(60_000);
  b.hurtPlayer(b.maxHp);
  b.pFx.poison = { turns: 3, v: 0.1 } as any;
  b.pFx.bomb = { turns: 2, v: 0.2 } as any;
  b.unitSt[0].stun = { turns: 2 } as any;
  b.waves[0][0].hp = 99999;
  const enemyHp = b.enemies[0].hp;
  const waveBefore = b.waveIndex;
  assert.equal(b.hp, 0);
  assert.equal(b.timeUp, true);
  b.continueAfterDefeat();
  assert.equal(b.hp, b.maxHp, 'full HP');
  assert.equal(b.timeLeftMs, 60_000, 'a full clock');
  assert.equal(b.pFx.poison, undefined);
  assert.equal(b.pFx.bomb, undefined);
  assert.equal(b.unitSt[0].stun, undefined, 'harmful effects are cleared');
  assert.equal(b.waveIndex, waveBefore, 'same wave');
  assert.equal(b.enemies[0].hp, enemyHp, 'the enemies keep their HP');
  assert.equal(b.board.length * b.board[0].length, 30, 'a full board');
  assert.ok(b.evs.some((e) => e.k === 'board'), 'the view is told to redraw the board');
  // and it can be done again, as often as you like
  b.hurtPlayer(b.maxHp);
  b.continueAfterDefeat();
  assert.equal(b.hp, b.maxHp);
}

// ---- real data
const timed = Object.values(DATA.levels).filter((l) => l.lt > 0);
assert.equal(timed.length, 48, 'expected 48 timed levels');
for (const l of timed) assert.ok(l.lt >= 30 && l.lt <= 3600, `level ${l.id} has an odd limit ${l.lt}`);
assert.equal(Object.values(DATA.levels).filter((l) => l.lc > 0).length, 0, 'no level uses a turn limit');

// ---- play every timed level with a max-level team, 6 s per move, and see how many fit in the budget
const units = Object.values(DATA.units).filter((u) => u.lp.length);
const best = (t: number, color: number) =>
  units.filter((u) => u.t === t && u.a[0] === color && u.ab.length).sort((a, b) => unitMaxLevel(b) - unitMaxLevel(a) || b.r - a.r)[0];
const team = [best(1, 1), best(2, 2), best(2, 3), best(2, 4), best(2, 5)].filter(Boolean).map((u) => statsAt(u, unitMaxLevel(u)));
const tally = { won: 0, lost: 0, stuck: 0, timeout: 0 };
let untimedWins = 0;
for (const lv of timed) {
  const mkBattle = (limit: number) =>
    new Battle(team, buildWaves(lv), DATA.typeRel, { dualSame: 0.1, dualDiff: 0.3 }, {
      weights: gemWeights(lv), rng: makeRng(lv.id), spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv), timeLimit: limit,
    });
  tally[playLevel(mkBattle(lv.lt), 400, true, 6).outcome]++;
  if (playLevel(mkBattle(0), 400, true, 0).outcome === 'won') untimedWins++;
}
console.log(`timed levels (6s/move): ${JSON.stringify(tally)}; the same levels untimed: ${untimedWins} won of ${timed.length}`);
assert.ok(tally.won > 0, 'at least some timed levels are winnable inside the limit');
assert.ok(tally.won <= untimedWins, 'a time limit can only make a level harder');
console.log('timed level tests passed');
