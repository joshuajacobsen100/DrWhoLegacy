// Simulates every level (abilities live) with a greedy bot to catch crashes and bad data. Not a balance test.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { makeRng } from '../src/engine/board.ts';
import { Battle } from '../src/engine/battle.ts';
import { playLevel } from './bot.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const data = await import('../src/data.ts');
await data.loadData();
const { DATA, buildWaves, buildSpawnDefs, buildGrids, gemWeights, statsAt, flowSeasons, unitMaxLevel } = data;

// strongest owned-able team: best doctor + 4 allies covering colours, all at max level
const units = Object.values(DATA.units).filter((u) => u.lp.length);
const best = (t: number, color: number) =>
  units.filter((u) => u.t === t && u.a[0] === color && u.ab.length).sort((a, b) => unitMaxLevel(b) - unitMaxLevel(a) || b.r - a.r)[0];
const team = [best(1, 1), best(2, 2), best(2, 3), best(2, 4), best(2, 5)].filter(Boolean).map((u) => statsAt(u, unitMaxLevel(u)));
assert.ok(team.length >= 4, 'could not assemble a test team');

let won = 0, lost = 0, stuck = 0, bad = 0;
const problems: string[] = [];
const abilityUse = new Map<number, number>();
const levelIds = Object.keys(DATA.levels).map(Number).sort((a, b) => a - b);
const t0 = Date.now();
for (const id of levelIds) {
  const lv = DATA.levels[String(id)];
  try {
    const waves = buildWaves(lv);
    waves.forEach((w, i) => {
      assert.ok(w.length > 0, `wave ${i} empty`);
      w.forEach((e) => assert.ok(e.hp > 0 && e.cd >= 0 && Number.isFinite(e.atk), `bad enemy ${JSON.stringify(e)}`));
    });
    const rng = makeRng(id);
    const battle = new Battle(team, waves, DATA.typeRel, { dualSame: 0.1, dualDiff: 0.3 }, { weights: gemWeights(lv), rng, spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv) });
    const { outcome } = playLevel(battle, 300);
    if (outcome === 'won') won++; else if (outcome === 'lost') lost++; else stuck++;
    for (const e of battle.enemies) for (const a of e.abilities) abilityUse.set(a.t, (abilityUse.get(a.t) ?? 0) + 1);
    // invariants after every level
    assert.ok(battle.hp >= 0 && battle.hp <= battle.maxHp, 'hp out of range');
    assert.ok(battle.board.every((r) => r.every((c) => c >= 1 && c <= 8)), 'board has invalid gems'); // 7 = useless gem, 8 = crack
    assert.ok(battle.aliveEnemies.length <= Math.max(3, ...waves.map((w) => w.length)), 'too many living enemies (spawn cap broken)');
  } catch (e) {
    bad++;
    problems.push(`level ${id} (${lv.n}): ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}

const seasons = flowSeasons();
const inMenu = new Set(seasons.flatMap((s) => s.groups.flatMap((g) => g.levels.map((l) => l.id))));
console.log(`levels: ${levelIds.length}, in menu: ${inMenu.size}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`bot with max-level team + abilities -> won ${won}, lost ${lost}, stuck ${stuck}, errors ${bad}`);
if (problems.length) console.log(problems.slice(0, 8).join('\n'));
assert.equal(bad, 0, 'errors while simulating levels');
console.log('level simulation passed');
