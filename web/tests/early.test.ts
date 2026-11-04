// Early-game sanity: can a fresh starter team (what a new save gets) clear the first missions, abilities included?
import { readFileSync } from 'node:fs';
import { makeRng } from '../src/engine/board.ts';
import { Battle } from '../src/engine/battle.ts';
import { playLevel } from './bot.ts';
import type { Gift } from '../src/drops.ts';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const prog = await import('../src/progression.ts');
const drops = await import('../src/drops.ts');
const { DATA, buildWaves, buildSpawnDefs, buildGrids, gemWeights, statsAt, flowSeasons } = data;
save.loadSave();
const label = (uid: number) => {
  const u = DATA.units[String(uid)];
  const s = prog.unitStatsFor(uid)!;
  return `${u.n} [${u.a}] hp${s.hp} atk${s.atk} ${s.abilities?.[0] ? '{' + s.abilities[0].n + '}' : ''}`;
};
console.log('starter team:', save.SAVE.team.map(label).join(' | '));

const season = flowSeasons()[0];
const ids = season.groups.flatMap((g) => g.levels.map((l) => l.id)).slice(0, 14);
const results: string[] = [];
for (const id of ids) {
  const lv = DATA.levels[String(id)];
  const stats = prog.teamStats();
  const N = 20;
  let wins = 0;
  let turns = 0;
  for (let s = 0; s < N; s++) {
    const rng = makeRng(id * 1000 + s);
    const b = new Battle(stats, buildWaves(lv), DATA.typeRel, { dualSame: 0.1, dualDiff: 0.3 }, { weights: gemWeights(lv), rng, spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv) });
    const r = playLevel(b, 200);
    if (r.outcome === 'won') {
      wins++;
      turns += r.turns;
    }
  }
  const hp = lv.w.flatMap((x) => x.en).reduce((n, [eid]) => n + lv.em[eid].hp, 0);
  const abil = new Set(lv.w.flatMap((x) => x.en).flatMap(([eid]) => lv.em[eid].ab.map((a) => a.t))).size;
  results.push(`${String(id).padStart(4)} ${lv.n.slice(0, 40).padEnd(40)} waves ${lv.w.length} hp ${String(hp).padStart(7)} enemy-skills ${abil}  win ${String(wins).padStart(2)}/${N}${wins ? `  avg ${(turns / wins).toFixed(1)} turns` : ''}`);
  if (wins > N / 2) {
    save.SAVE.cleared[id] = 1;
    for (const uid of save.SAVE.team) save.addXp(uid, lv.xp);
    // a won mission defeated every enemy: roll their drops like the battle would, keep what is new, and field new allies
    const run: (Gift | null)[] = [];
    const rng = makeRng(id);
    for (const w of lv.w) {
      for (const [eid] of w.en) {
        const g = drops.rollEnemyDrop(lv.em[eid].dr, lv.em[eid].dm === 1, run.filter((x): x is Gift => !!x), id, rng);
        run.push(g);
        if (g) drops.receiveGift(g);
      }
    }
    for (const g of run) {
      if (g?.kind === 'unit' && DATA.units[String(g.id)].t === 2 && save.SAVE.team.length < save.TEAM_SIZE && !save.SAVE.team.includes(g.id)) save.SAVE.team.push(g.id);
    }
  }
}
console.log(results.join('\n'));
console.log('team after:', save.SAVE.team.length, 'units | ally levels after:', save.SAVE.team.slice(1).map((u) => save.SAVE.owned[u].lv).join(','), '| Doctor level', prog.doctorLevel(save.SAVE.team), '| unspent points', save.SAVE.team.slice(1).map((u) => save.SAVE.owned[u].pts).join(','));
