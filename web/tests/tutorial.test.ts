// Tutorial scripting: engine pieces, then the real level 18 played start to finish with a scripted player.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { COLS, ROWS, findMatches, makeRng, origRow, type Match } from '../src/engine/board.ts';
import { Battle, type DropRow, type EnemyDef, type PresetBoard, type TurnResult, type UnitStats } from '../src/engine/battle.ts';
import { Story, type StoryHost, type StoryRow } from '../src/story.ts';
import { giftSource, runStoryCommand } from '../src/storycmd.ts';
import { botStep } from './bot.ts';

const file = (p: string) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8'));
(globalThis as any).fetch = async () => ({ json: async () => file('data/gamedata.json') });
const data = await import('../src/data.ts');
await data.loadData();
const prog = await import('../src/progression.ts');
const { DATA, buildWaves, buildSpawnDefs, buildGrids, gemWeights } = data;
const stories: Record<string, StoryRow[]> = file('data/stories.json');
const presets: Record<string, PresetBoard> = file('data/boards.json');

const rel = DATA.typeRel;
const unit = (o: Partial<UnitStats> = {}): UnitStats => ({ uid: 1, name: 'U', colors: [2], hp: 100, atk: 50, heal: 10, isDoctor: true, icon: null, abilities: [], ...o });
const en = (o: Partial<EnemyDef> = {}): EnemyDef => ({ hp: 10, atk: 5, cd: 1, def: 0, color: 3, name: 'E', img: null, w: 1, h: 1, x: 0, y: 0, drops: [], abilities: [], ...o });
const mk = (opts: Record<string, unknown> = {}, enemies: EnemyDef[] = [en(), en()]) =>
  new Battle([unit()], [enemies], rel, { dualSame: 0.1, dualDiff: 0.3 }, { rng: makeRng(5), presets, ...opts });

// ---- the preset board: rows read from the bottom, columns stay columns, refills keep feeding each column
{
  const b = mk();
  const def = presets['tutorialgem2'];
  assert.equal(def.cols, COLS, 'the tutorial board is 6 columns wide, like the real board');
  assert.ok(b.loadPreset('tutorialgem2'));
  for (let c = 0; c < COLS; c++) for (let row = 0; row < ROWS; row++) assert.equal(b.board[origRow(row)][c], def.gems[row][c], `col ${c} row ${row} (from the bottom)`);
  // removing the bottom gem of column 0 makes everything above fall and the next queued gem (def row 5) enter at the top
  b.removeMatches([{ color: 5, cells: [[ROWS - 1, 0]] }]);
  assert.equal(b.board[0][0], def.gems[ROWS][0], 'the column queue continues with the next row of the definition');
  assert.equal(b.board[ROWS - 1][0], def.gems[1][0], 'the gem above fell down one cell');
  assert.equal(b.loadPreset('nope'), false);
}

// ---- tutorialgem: only the start gem can move, along the path, and the drag must end on the target
{
  const b = mk();
  b.loadPreset('tutorialgem2');
  const snapshot = b.board.map((r) => [...r]);
  assert.ok(b.openTutorialGem(5, 3, 5, 4)); // column 5, row 3 -> row 4 (rows from the bottom)
  const start = [origRow(3), 5] as const;
  const end = [origRow(4), 5] as const;
  const lock = (r: number, c: number) => b.meta[r][c]?.lock ?? 0;
  assert.equal(lock(start[0], start[1]), 0, 'the start gem is free');
  assert.equal(lock(end[0], end[1]), 4, 'path gems can be swapped but not picked up');
  assert.equal(b.board.flat().length - b.meta.flat().filter((g) => g && g.lock === 5).length, 2, 'every other gem is frozen');
  assert.equal(b.tutorialOpen, true);
  // a drag that does not reach the end puts everything back
  [b.board[start[0]][4], b.board[start[0]][5]] = [b.board[start[0]][5], b.board[start[0]][4]];
  assert.equal(b.tutorialFinish(), false);
  assert.deepEqual(b.board, snapshot, 'a wrong drag is undone');
  assert.equal(b.tutorialOpen, true, 'and the lesson stays open');
  assert.equal(b.tutDone, false);
  // the right drag frees the board
  const g = b.board[start[0]][5];
  [b.board[start[0]][5], b.board[end[0]][5]] = [b.board[end[0]][5], b.board[start[0]][5]];
  [b.meta[start[0]][5], b.meta[end[0]][5]] = [b.meta[end[0]][5], b.meta[start[0]][5]];
  assert.equal(b.board[end[0]][5], g);
  assert.equal(b.tutorialFinish(), true);
  assert.equal(b.tutDone, true);
  assert.equal(b.tutorialOpen, false);
  assert.equal(b.meta.flat().filter((m) => m && m.lock > 0).length, 0, 'all gems are free again');
  assert.equal(b.openTutorialGem(2, 2, 2, 2), false, 'start and end must differ');
}

// ---- tutorial mode: enemies hold their fire and debuffs are off until the script closes it
{
  const b = mk({ tutorial: true });
  const idle: Match[] = [{ color: 5, cells: [[0, 0], [0, 1], [0, 2]] }];
  const hp = b.hp;
  b.resolveMove(idle);
  assert.equal(b.hp, hp, 'no enemy acts in tutorial mode');
  assert.equal(b.enemies[0].curCd, 1, 'and no countdown ticks');
  b.closeTutorialMode();
  b.resolveMove(idle);
  assert.ok(b.hp < hp, 'after closetutorialmode enemies attack normally');
}

// ---- the small commands
{
  const b = new Battle([unit({ abilities: [{ n: 'A', d: '', cd: 15, t: 103, p: ['5'], icon: null }] })], [[en()]], rel, { dualSame: 0.1, dualDiff: 0.3 }, { rng: makeRng(2) });
  assert.equal(b.abilityReady(0), false);
  b.assignSkillCd(0, 0);
  assert.equal(b.unitSt[0].now, 0, 'adding 0 changes nothing');
  b.assignSkillCd(0, 50);
  assert.equal(b.abilityReady(0), true, 'adding a large charge caps at ready');
  b.changeAllGemState(5, 999);
  assert.ok(b.meta.flat().every((g) => g && g.lock === 5 && g.lockTurns === 999));
  const evs = b.callMonsterAttack(0);
  assert.equal(b.hp, 100 - 5);
  assert.ok(evs.some((e) => e.k === 'hurtPlayer'));
  const levels = { '406': { em: { '1': { dr: [[1, 70, 100], [1, 99, 0]] as DropRow[], dm: 1 } } } };
  assert.deepEqual(giftSource(416001101, levels), { levelId: 406, rows: levels['406'].em['1'].dr, multi: true }, 'rollgift decodes (10000 + level*1000 + enemy)*1000 + 100 + card');
  assert.equal(giftSource(1, levels), null, 'unknown gift ids roll nothing');
}

// ---- level 18, start to finish: the story drives the battle, a scripted player does what the script asks
{
  const lv = DATA.levels['18'];
  const team = prog.tutorialTeamStats();
  assert.equal(team.length, 2, 'the tutorial party is the Doctor and one companion');
  assert.deepEqual(team.map((u) => u.name), ['The Eleventh Doctor', 'Madame Vastra']);
  const b = new Battle(team, buildWaves(lv), rel, { dualSame: 0.1, dualDiff: 0.3 }, {
    weights: gemWeights(lv), rng: makeRng(18), spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv), presets, tutorial: true,
  });
  let moves = 0;
  const log: string[] = [];
  const host: StoryHost = {
    waveNumber: () => b.waveIndex + 1,
    aliveEnemies: () => b.aliveEnemies.length,
    boardIdle: () => true,
    moves: () => moves,
    tutorialDone: () => b.tutDone,
    gameplay: (a, args) => {
      log.push(a);
      runStoryCommand(b, DATA.levels, a, args);
    },
    beep: () => undefined,
    playSound: () => undefined,
    playMusic: () => undefined,
  };
  const story = new Story(stories['18'], host);
  const swap = (r1: number, c1: number, r2: number, c2: number) => {
    [b.board[r1][c1], b.board[r2][c2]] = [b.board[r2][c2], b.board[r1][c1]];
    [b.meta[r1][c1], b.meta[r2][c2]] = [b.meta[r2][c2], b.meta[r1][c1]];
  };
  let victory = false;
  const handle = (res: TurnResult) => {
    if (res.victory) {
      victory = true;
      story.markVictory();
    } else if (res.waveCleared) b.nextWave();
  };
  const cascade = (first: Match[] | null): Match[] => {
    const all: Match[] = [];
    for (let g = 0; g < 40; g++) {
      const ms = first && g === 0 ? first : findMatches(b.board, b.meta);
      if (!ms.length) break;
      all.push(...ms);
      b.removeMatches(ms);
    }
    return all;
  };
  const drags: { combo: number; dmg: number }[] = [];
  let lastHpLoss = 0;
  let steps = 0;
  while (!story.done && steps++ < 60000) {
    story.update(0.05);
    if (story.locked) story.tap();
    if (story.mode !== 'suspended' || victory) continue;
    if (b.tut) {
      // play exactly the drag the arrow shows: along the columns on the start row, then up/down the end column
      let [r, c] = b.tut.start;
      const [er, ec] = b.tut.end;
      while (r !== er || c !== ec) {
        const nr = c !== ec ? r : r + (r < er ? 1 : -1);
        const nc = c !== ec ? c + (c < ec ? 1 : -1) : c;
        swap(r, c, nr, nc);
        [r, c] = [nr, nc];
      }
      assert.ok(b.tutorialFinish(), 'the scripted drag reaches its target');
      const all = cascade(null);
      moves++;
      const hpBefore = b.hp;
      const res = b.resolveMove(all);
      drags.push({ combo: res.combo, dmg: res.hits.reduce((n, h) => n + h.amount, 0) + res.heal });
      lastHpLoss = hpBefore - b.hp;
      handle(res);
    } else {
      // the story waits for something else (an enemy dying, the end of the level): play normally
      const s = botStep(b, true);
      if (s.res) {
        moves++;
        handle(s.res);
      } else b.resetBoard();
    }
  }
  assert.ok(story.done, `the tutorial script finished (row ${story.pc}/${story.rows.length}, ${story.mode})`);
  assert.ok(victory, 'the tutorial ends in a win');
  assert.equal(drags.length, 5, 'the five scripted drags were each performed once');
  // drags 1-4 each teach a match (blue, heal, a 5-gem match, a 6-combo swipe); drag 5 is "swap two gems to complete a
  // turn": it makes no match on purpose, and the enemies then hit back ("we lost a bit of health")
  assert.ok(drags.slice(0, 4).every((d) => d.combo >= 1 && d.dmg > 0), `drags 1-4 each make a match that does something: ${JSON.stringify(drags)}`);
  assert.equal(drags[3].combo, 6, 'the fourth drag is the 6-combo showcase');
  assert.equal(drags[4].combo, 0, 'the last drag deliberately makes no match');
  assert.ok(lastHpLoss > 0, 'but the turn still passes and an enemy attacks');
  for (const a of ['turnonloadgemdata', 'tutorialgem', 'assignskillcd', 'changeallgemstate', 'callmonsterattackbyindex', 'closetutorialmode']) {
    assert.ok(log.includes(a), `the script ran ${a}`);
  }
  assert.equal(b.tutorialMode, false, 'tutorial mode was closed by the script');
  console.log(`level 18 finished in ${moves} moves; scripted drags ${JSON.stringify(drags)}`);
}
// ---- checkenemyattack: 0 releases the wave-start enemy action a story was holding back; 1 does not
{
  const b = mk();
  let called = 0;
  runStoryCommand(b, DATA.levels, 'checkenemyattack', ['1'], { readyEnemies: () => called++ });
  assert.equal(called, 0, 'checkenemyattack,1 only holds the enemies');
  runStoryCommand(b, DATA.levels, 'checkenemyattack', ['0'], { readyEnemies: () => called++ });
  assert.equal(called, 1, 'checkenemyattack,0 lets them act');
  runStoryCommand(b, DATA.levels, 'checkenemyattack', ['0']); // no hook: harmless
}

// ---- level 651 (the only script that uses it): the command is reached once, after the intro, and releases the opening move
{
  const lv = DATA.levels['651'];
  const b = new Battle(prog.tutorialTeamStats(), buildWaves(lv), rel, { dualSame: 0.1, dualDiff: 0.3 }, {
    weights: gemWeights(lv), rng: makeRng(651), spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv),
  });
  let released = 0;
  const order: string[] = [];
  const host: StoryHost = {
    waveNumber: () => b.waveIndex + 1, aliveEnemies: () => b.aliveEnemies.length, boardIdle: () => true, moves: () => 0,
    tutorialDone: () => false,
    gameplay: (a, args) => {
      order.push(a);
      runStoryCommand(b, DATA.levels, a, args, { readyEnemies: () => { released++; order.push('READY'); } });
    },
    beep: () => undefined, playSound: () => undefined, playMusic: () => undefined,
  };
  const story = new Story(stories['651'], host);
  for (let i = 0; i < 4000 && !story.done; i++) {
    story.update(0.05);
    if (story.locked) story.tap();
  }
  assert.ok(story.done);
  assert.equal(released, 1, 'checkenemyattack,0 is reached exactly once');
  assert.deepEqual(order.slice(order.lastIndexOf('shakecamera')), ['shakecamera', 'checkenemyattack', 'READY'], 'it comes right after the last shake of the intro and releases the enemies');
}

console.log('tutorial tests passed');
