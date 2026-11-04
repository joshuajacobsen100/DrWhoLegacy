// Story interpreter: unit tests, then every real script is played to completion against a simulated battle.
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { Story, buildTagMap, type StoryHost, type StoryRow } from '../src/story.ts';
import { HANDLED_COMMANDS } from '../src/storycmd.ts';

const R = (t: string, a: Record<string, string> = {}): StoryRow => ({ t, ...a });

class FakeHost implements StoryHost {
  wave = 1;
  alive = 3;
  idle = true;
  movesMade = 0;
  log: string[] = [];
  waveNumber() { return this.wave; }
  aliveEnemies() { return this.alive; }
  boardIdle() { return this.idle; }
  moves() { return this.movesMade; }
  tutorialDone() { return this.movesMade >= 1; }
  gameplay(a: string, args: string[]) { this.log.push(`${a}:${args.join(',')}`); }
  beep(n: string, v: number) { this.log.push(`beep:${n}:${v}`); }
  playSound(id: string, v: number) { this.log.push(`snd:${id}:${v}`); }
  playMusic(n: string, v: number, restart: boolean) { this.log.push(`music:${n}:${v}:${restart}`); }
}

const run = (s: Story, secs: number, dt = 0.05) => { for (let t = 0; t < secs; t += dt) s.update(dt); };

// ---- actors: create, then update the same name; defaults
{
  const s = new Story([R('actor', { name: 'a', src_type: 'suit', src_value: '5', xpos: '350', ypos: '450', layer: 'center', alpha: '0' }), R('actor', { name: 'a', xpos: '430', alpha: '1' }), R('wait', { duration: '1' })], new FakeHost());
  run(s, 0.1);
  const a = s.actors.get('a')!;
  assert.equal(a.srcType, 'suit');
  assert.equal(a.x, 430);
  assert.equal(a.y, 450, 'unspecified attributes keep their value');
  assert.equal(a.alpha, 1);
  assert.equal(a.layer, 'center');
  assert.equal(a.alignY, null);
}

// ---- fade and move tweens (move is a delta, as in the original)
{
  const s = new Story([R('actor', { name: 'a', src_type: 'suit', src_value: '5', xpos: '100', ypos: '200', alpha: '0' }), R('fade', { name: 'a', from: '0', to: '1', duration: '2', ease_type: 'fadein' }), R('move', { name: 'a', movement: 'linear, 2', endpos: '50,-20' }), R('wait', { duration: '3' })], new FakeHost());
  run(s, 1.0);
  const a = s.actors.get('a')!;
  assert.ok(a.alpha > 0.05 && a.alpha < 0.5, `cubic-in fade is slow at the start (alpha ${a.alpha})`);
  assert.ok(Math.abs(a.x - 125) < 1.5 && Math.abs(a.y - 190) < 1.5, 'linear move is halfway after half the time');
  run(s, 2.5);
  assert.equal(a.alpha, 1);
  assert.equal(a.x, 150);
  assert.equal(a.y, 180);
}

// ---- text: typewriter, tap to finish (skippable), tap to advance (wait=user)
{
  const h = new FakeHost();
  const s = new Story([R('text', { id: 'abcdefghijkl', spread: '3', rate: '0.1', skippable: 'true', wait: 'user', sfx: 'chatbeeplow' }), R('text', { id: 'next', spread: '4', rate: '0.01', skippable: 'true', wait: 'user' })], h);
  run(s, 0.15);
  assert.equal(s.text!.shown, 3, 'reveals `spread` characters per `rate` seconds');
  assert.ok(h.log.includes('beep:chatbeeplow:0.5'), 'a quiet beep per reveal step');
  assert.equal(s.locked, true);
  s.tap();
  run(s, 0.05);
  assert.equal(s.text!.shown, 12, 'a tap completes a skippable line');
  assert.equal(s.text!.full, 'abcdefghijkl', 'but does not advance yet');
  s.tap();
  run(s, 0.05);
  assert.equal(s.text!.full, 'next', 'a second tap moves to the next row');
  assert.equal(s.text!.shown <= 4, true, 'the same tap does not also skip the new line');
  run(s, 0.5);
  s.tap();
  run(s, 0.05);
  assert.equal(s.done, true, 'finishing the last row ends the story');
  assert.equal(s.locked, false);
}
{
  const s = new Story([R('text', { id: 'auto', spread: '10', rate: '0.01', wait: 'finished' }), R('wait', { duration: '10' })], new FakeHost());
  run(s, 0.1);
  assert.equal(s.mode, 'running');
  assert.equal(s.pc, 1, 'wait=finished moves on by itself once the text has typed out');
}

// ---- typing beeps: one per step, none on the final step; onesfx plays once as the line starts
{
  const h = new FakeHost();
  const s = new Story([R('text', { id: 'abcdefghi', spread: '3', rate: '0.1', sfx: 'chatbeephigh', onesfx: '57', wait: 'user' })], h);
  run(s, 1.0);
  assert.equal(s.text!.done, true);
  assert.deepEqual(h.log.filter((l) => l.startsWith('beep')).length, 2, '9 chars in steps of 3 = 3 steps, so 2 beeps (none on the last)');
  assert.deepEqual(h.log.filter((l) => l.startsWith('snd')), ['snd:57:1'], 'onesfx once, at full volume');
}

// ---- playsound / playmusic rows (attribute names as in the original: sound, music, volume, restart)
{
  const h = new FakeHost();
  const s = new Story([
    R('playsound', { sound: '57' }),
    R('playsound', { sound: '74', volume: '0.4' }),
    R('playmusic', { music: 'battlemusic01', restart: '1' }),
    R('playmusic', { music: 'battlemusic02', volume: '0.8' }),
    R('wait', { duration: '9' }),
  ], h);
  run(s, 0.1);
  assert.deepEqual(h.log, ['snd:57:1', 'snd:74:0.4', 'music:battlemusic01:1:true', 'music:battlemusic02:0.8:false']);
}

// ---- wait: duration, and minwait lets a tap cut it short
{
  const s = new Story([R('wait', { duration: '5', minwait: '0.3' }), R('actor', { name: 'z', src_type: 'suit', src_value: '1' }), R('wait', { duration: '99' })], new FakeHost());
  run(s, 0.1);
  s.tap();
  run(s, 0.05);
  assert.equal(s.actors.has('z'), false, 'a tap before minwait is ignored');
  run(s, 0.3);
  s.tap();
  run(s, 0.05);
  assert.equal(s.actors.has('z'), true, 'a tap after minwait ends the wait');
}
{
  const s = new Story([R('wait', { duration: '1' }), R('actor', { name: 'z', src_type: 'suit', src_value: '1' }), R('wait', { duration: '99' })], new FakeHost());
  run(s, 0.5);
  s.tap();
  run(s, 0.1);
  assert.equal(s.actors.has('z'), false, 'waits without minwait cannot be tapped away');
  run(s, 0.8);
  assert.equal(s.actors.has('z'), true);
}

// ---- trigger: the story suspends (unlocking the board) until the battle condition holds
{
  const h = new FakeHost();
  const s = new Story([R('trigger', { formula: 'waitwaveindex, 3', showtext: 'no' }), R('actor', { name: 'late', src_type: 'enemy_image', src_value: '9' }), R('wait', { duration: '1' })], h);
  run(s, 0.2);
  assert.equal(s.mode, 'suspended');
  assert.equal(s.locked, false, 'the player can play while a trigger is pending');
  h.wave = 2;
  run(s, 0.2);
  assert.equal(s.mode, 'suspended');
  h.wave = 3;
  run(s, 0.1);
  assert.equal(s.mode, 'running', 'wave 3 resumes the story');
  assert.equal(s.locked, true);
  assert.equal(s.actors.has('late'), true);
}
{
  const h = new FakeHost();
  const mk = (f: string) => new Story([R('trigger', { formula: f }), R('wait', { duration: '1' })], h);
  h.alive = 2;
  let s = mk('checkenemycount, 0');
  run(s, 0.1);
  assert.equal(s.mode, 'suspended');
  h.alive = 0;
  run(s, 0.1);
  assert.equal(s.mode, 'running', 'enemy count 0');
  h.idle = false;
  s = mk('checkgamestate, 3');
  run(s, 0.1);
  assert.equal(s.mode, 'suspended', 'state 3 = waiting for input, not while the board is busy');
  h.idle = true;
  run(s, 0.1);
  assert.equal(s.mode, 'running');
  s = mk('checkgamestate, 11');
  run(s, 0.1);
  assert.equal(s.mode, 'suspended', 'state 11 = victory');
  s.markVictory();
  run(s, 0.1);
  assert.equal(s.mode, 'running', 'victory releases the outro');
  h.movesMade = 0;
  s = mk('checkgettoend');
  run(s, 0.1);
  assert.equal(s.mode, 'suspended');
  h.movesMade = 1;
  run(s, 0.1);
  assert.equal(s.mode, 'running');
}

// ---- skip: jumps forward to the tagged row, closing the window / sprites as configured
{
  const rows = [
    R('setskip', { useskip: '1', closewnd: '1', closesprite: '1', jumptag: '1' }),
    R('actor', { name: 'a', src_type: 'suit', src_value: '5' }),
    R('text', { id: 'one', wait: 'user', skippable: 'true', rate: '0.01', spread: '9' }),
    R('text', { id: 'two', wait: 'user', skippable: 'true', rate: '0.01', spread: '9' }),
    R('wait', { duration: '0.3', tag: '1' }),
    R('setskip', { useskip: '0' }),
  ];
  assert.deepEqual([...buildTagMap(rows)], [[1, 4]]);
  const s = new Story(rows, new FakeHost());
  run(s, 0.1);
  assert.equal(s.canSkip, true);
  assert.equal(s.skipNow(), true);
  assert.equal(s.actors.size, 0, 'sprites closed');
  assert.equal(s.text, null, 'window closed');
  run(s, 0.1);
  assert.equal(s.pc, 4, 'jumped past both text rows');
  run(s, 0.5);
  assert.equal(s.done, true);
  assert.equal(s.canSkip, false, 'useskip=0 removes the button');
}

// ---- gameplay rows are forwarded; removeallintoplayer clears the stage
{
  const h = new FakeHost();
  const s = new Story([R('actor', { name: 'a', src_type: 'suit', src_value: '5' }), R('gameplay', { action: 'shakecamera,0.6,10,10' }), R('gameplay', { action: 'JumpGameState,2' }), R('gameplay', { action: 'removeallintoplayer' }), R('gameplay', { action: 'tutorialgem,1' })], h);
  run(s, 0.1);
  assert.deepEqual(h.log, ['shakecamera:0.6,10,10', 'tutorialgem:1'], 'battle commands reach the host; state jumps do not');
  assert.equal(s.actors.size, 0);
  assert.deepEqual(s.forwarded, ['shakecamera', 'tutorialgem'], 'battle commands are forwarded to the host');
  assert.equal(s.done, true);
}

// ---- every real script plays to the end against a simulated battle
const stories: Record<string, StoryRow[]> = JSON.parse(readFileSync(new URL('../public/data/stories.json', import.meta.url), 'utf8'));
const game = JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8'));
const assetOk = (p: string) => existsSync(new URL(`../public/${p}`, import.meta.url));
const forwarded = new Map<string, number>();
const deadSkips: string[] = [];
let textRows = 0, textShown = 0, finished = 0, skipsChecked = 0, missingArt = 0;
const ids = Object.keys(stories);
assert.equal(ids.length, 239, 'expected 239 scripts');
for (const id of ids) {
  const rows = stories[id];
  const lv = game.levels[id];
  assert.ok(lv, `script for unknown level ${id}`);
  // static checks: tags used by skip/goto exist and point forward; every referenced image was exported
  const tags = buildTagMap(rows);
  rows.forEach((r, i) => {
    if (r.t === 'setskip' && r.useskip === '1') {
      const t = tags.get(+r.jumptag);
      if (t === undefined || t <= i) deadSkips.push(id); // the original logs "can't jump" and ignores the press
      skipsChecked++;
    }
    if (r.t === 'actor' && r.src_type && /^\d+$/.test(r.src_value ?? '')) { // rows without a value just update an existing actor
      const file = r.src_type === 'suit' ? `img/suit/${r.src_value}.png` : r.src_type === 'enemy_image' ? `img/enemy/${r.src_value}.png` : `img/scene/${r.src_value}.png`;
      if (!assetOk(file)) missingArt++;
    }
  });
  textRows += rows.filter((r) => r.t === 'text').length;

  // simulated battle: waves clear every few seconds; the player is idle; taps arrive whenever the story waits for one
  const waves = lv.w.length;
  const h = new FakeHost();
  h.alive = lv.w[0].en.length;
  const s = new Story(rows, h);
  let seen: object | null = null;
  let battleT = 0;
  let steps = 0;
  while (!s.done && steps++ < 120000) {
    s.update(0.05);
    if (s.text && s.text !== seen) { seen = s.text; textShown++; }
    if (s.locked) s.tap();
    battleT += 0.05;
    if (battleT > 2.5 && s.mode === 'suspended') {
      battleT = 0;
      h.alive = Math.max(0, h.alive - 1);
      if (h.alive === 0) {
        if (h.wave >= waves) s.markVictory();
        else {
          h.wave++;
          h.alive = lv.w[h.wave - 1].en.length;
        }
      }
    }
    if (battleT > 120) break;
  }
  assert.ok(s.done, `level ${id}: script never finished (pc ${s.pc}/${rows.length}, mode ${s.mode})`);
  finished++;
  for (const u of s.forwarded) forwarded.set(u, (forwarded.get(u) ?? 0) + 1);
}
assert.deepEqual(deadSkips, ['517'], 'only level 517 ships a skip button without a destination');
assert.equal(missingArt, 0, 'story art is missing from public/img');
assert.equal(textShown, textRows, 'every dialogue line is shown at some point when the level is won');
// ---- battle-layer sprites: setspritetolayer makes an independent copy (alpha 1, rotation 0, parked at -300,-300)
{
  const h = new FakeHost();
  const s = new Story([
    R('actor', { name: 'arrow', src_type: 'scene_image', src_value: '23', xpos: '500', ypos: '-30', aligny: '1', rotation: '0', alpha: '0', layer: 'back' }),
    R('gameplay', { action: 'dssprite,arrow,x,5' }), // not in the layer yet: ignored
    R('gameplay', { action: 'setspritetolayer,arrow' }),
    R('gameplay', { action: 'dssprite,arrow,rotation,270' }),
    R('gameplay', { action: 'dssprite,arrow,x,572' }),
    R('gameplay', { action: 'dssprite,arrow,y,400' }),
    R('trigger', { formula: 'checkgettoend', showtext: 'no' }),
    R('gameplay', { action: 'removespritefromlayer,arrow' }),
    R('wait', { duration: '99' }),
  ], h);
  run(s, 0.1);
  const actor = s.actors.get('arrow')!;
  const copy = s.layerSprites.get('arrow')!;
  assert.equal(actor.alpha, 0, 'the story actor keeps its own alpha');
  assert.equal(actor.x, 500, 'and its own position');
  assert.equal(copy.alpha, 1, 'the battle-layer copy starts fully visible');
  assert.deepEqual([copy.x, copy.y, copy.rotation], [572, 400, 270], 'dssprite edits the copy');
  assert.equal(s.mode, 'suspended');
  assert.equal(s.layerSprites.size, 1, 'the copy stays while the story waits for the player');
  h.movesMade = 1;
  run(s, 0.1);
  assert.equal(s.layerSprites.size, 0, 'removespritefromlayer deletes it');
  assert.ok(s.actors.has('arrow'), 'the story actor is untouched');
}

// every sound id and music track the scripts use was exported and is listed in the audio index
const audio = JSON.parse(readFileSync(new URL('../public/data/audio.json', import.meta.url), 'utf8'));
let cues = 0;
for (const [id, rows] of Object.entries(stories)) {
  for (const r of rows) {
    if (r.t === 'playsound') {
      cues++;
      assert.ok(audio.sfx[r.sound], `level ${id}: sound ${r.sound} is not exported`);
      assert.ok(assetOk(audio.sfx[r.sound].file), `level ${id}: ${audio.sfx[r.sound].file} missing`);
    }
    if (r.t === 'playmusic') {
      cues++;
      assert.ok(audio.music[r.music], `level ${id}: music ${r.music} is not exported`);
      assert.ok(assetOk(audio.music[r.music]));
    }
  }
}
for (const id of [25, 26, 27]) assert.ok(audio.sfx[id] && assetOk(audio.sfx[id].file), `typing beep ${id} missing`);
assert.equal(cues, 29, 'expected 28 sound cues and 1 music cue in the scripts');
console.log(`scripts finished: ${finished}/${ids.length}; dialogue lines: ${textRows}; skip buttons checked: ${skipsChecked}`);
console.log('commands forwarded to the battle:', JSON.stringify(Object.fromEntries(forwarded)));
const unknown = [...forwarded.keys()].filter((c) => !HANDLED_COMMANDS.has(c) && !['setspritetolayer', 'dssprite', 'removespritefromlayer'].includes(c));
assert.deepEqual(unknown, [], 'every command used by the 239 scripts is handled');
console.log('story tests passed');
