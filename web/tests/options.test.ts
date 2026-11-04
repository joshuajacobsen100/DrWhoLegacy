// Options (volumes, gem look, save backup), news and credits, and a check that the game never goes online.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

(globalThis as any).fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
const data = await import('../src/data.ts');
await data.loadData();
const save = await import('../src/save.ts');
const audio = await import('../src/audio.ts');
const news = await import('../src/news.ts');
const { DATA } = data;
save.loadSave();

// ---- the game never goes online: only its own relative files are fetched, and no web address is written in the code
{
  const srcDir = new URL('../src/', import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
      else if (e.name.endsWith('.ts')) files.push(new URL(e.name, dir).pathname);
    }
  };
  walk(srcDir);
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = readFileSync(decodeURIComponent(f.replace(/^\/([A-Za-z]:)/, '$1')), 'utf8');
    assert.ok(!/https?:\/\//.test(text), `${f} mentions a web address`);
    assert.ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon|new EventSource/.test(text), `${f} opens a network channel`);
    for (const m of text.matchAll(/fetch\(\s*([^)]*)\)/g)) {
      assert.ok(/^['`](data|img)\//.test(m[1].trim()) || m[1].trim() === 'url', `${f}: fetch(${m[1]}) is not one of the game's own files`);
    }
  }
}

// ---- settings
{
  const d = save.defaultSettings();
  assert.deepEqual(d, { music: 7, sfx: 7, gemSkin: 0, newsSeen: 0, otb: true }, 'volumes default to 7 of 10, as in the original (0.7)');
  assert.deepEqual(save.SAVE.settings, d, 'a new save has the defaults');
  // an older save without settings, or with some of them, is filled in
  const old = JSON.parse(save.exportSave());
  delete old.settings;
  assert.equal(save.importSave(JSON.stringify(old)), null);
  assert.deepEqual(save.SAVE.settings, d);
  old.settings = { music: 3 };
  assert.equal(save.importSave(JSON.stringify(old)), null);
  assert.deepEqual(save.SAVE.settings, { music: 3, sfx: 7, gemSkin: 0, newsSeen: 0, otb: true });
  save.SAVE.settings = save.defaultSettings();
}

// ---- volume steps: 7 of 10 plays everything at its authored loudness
{
  audio.setVolumes(7, 7);
  assert.deepEqual(audio.volumeFactors(), { music: 1, sfx: 1 });
  audio.setVolumes(0, 10);
  assert.deepEqual(audio.volumeFactors(), { music: 0, sfx: 10 / 7 });
  audio.setVolumes(99, -4);
  assert.deepEqual(audio.volumeFactors(), { music: 10 / 7, sfx: 0 }, 'steps are kept inside 0-10');
  audio.setVolumes(7, 7);
}

// ---- save backup: export, import, and refusing things that are not saves
{
  const S = save.SAVE;
  S.cleared[18] = 2;
  S.items[45] = 5;
  S.settings.gemSkin = 3;
  const text = save.exportSave();
  const copy = JSON.parse(text);
  // damage the live save, then bring it back
  S.cleared = {};
  S.items = {};
  assert.equal(save.importSave(text), null);
  assert.deepEqual(save.SAVE.cleared, copy.cleared);
  assert.equal(save.itemCount(45), 5);
  assert.equal(save.SAVE.settings.gemSkin, 3);
  assert.deepEqual(JSON.parse(store.get('dwl.save.v1')!).cleared, copy.cleared, 'the imported save is stored');
  // refused, and the current save is left alone
  const keep = save.exportSave();
  assert.match(save.importSave('not json at all')!, /not a save/);
  assert.match(save.importSave('{"v":2,"owned":{},"team":[]}')!, /not a save/);
  assert.match(save.importSave(JSON.stringify({ ...copy, owned: {} }))!, /no units/);
  assert.match(save.importSave(JSON.stringify({ ...copy, team: [999999] }))!, /no usable team/);
  assert.match(save.importSave('null')!, /not a save/);
  assert.equal(save.exportSave(), keep, 'a refused file changes nothing');
  // units this game does not know are dropped, and the team keeps only owned units
  const ids = Object.keys(copy.owned);
  const weird = { ...copy, owned: { ...copy.owned, '999999': { lv: 1 } }, team: [999999, ...copy.team] };
  assert.equal(save.importSave(JSON.stringify(weird)), null);
  assert.equal(save.SAVE.owned['999999'], undefined);
  assert.ok(save.SAVE.team.every((id) => save.SAVE.owned[id]));
  assert.ok(Object.keys(save.SAVE.owned).length === ids.length);
  assert.ok(save.SAVE.team.length <= save.TEAM_SIZE);
  save.SAVE.settings.gemSkin = 0;
}

// ---- gem looks
{
  assert.equal(DATA.gemSkins.length, 18);
  assert.equal(DATA.gemSkins[0].n, 'Default');
  assert.deepEqual(DATA.gemSkins[0].gems, [], 'the default look changes nothing');
  const gemDir = new URL('../public/img/gems/', import.meta.url);
  for (const k of DATA.gemSkins) {
    for (const g of k.gems) assert.ok(existsSync(new URL(`gem${g}.png`, gemDir)), `look ${k.n}: gem ${g} has art`);
    assert.equal(new Set(k.gems.map((g) => data.gemColor(g))).size, k.gems.length, `look ${k.n}: one gem per colour`);
  }
  const lv = Object.values(DATA.levels).find((l) => new Set(l.gems.map(([g]) => data.gemColor(g))).size >= 5)!;
  const base = data.gemSkins(lv);
  assert.deepEqual(data.gemSkins(lv, []), base, 'no look = the level as it is');
  for (const k of DATA.gemSkins.slice(1)) {
    const out = data.gemSkins(lv, k.gems);
    assert.deepEqual(Object.keys(out), Object.keys(base), 'a look never adds or removes a colour');
    for (const [c, id] of Object.entries(out)) {
      const fromLook = k.gems.find((g) => data.gemColor(g) === Number(c));
      assert.equal(id, fromLook ?? base[Number(c)], `look ${k.n}: colour ${c} uses the look's gem, or the level's own`);
    }
  }
  // a level with no gem list of its own plays with the six plain gems, and a look restyles all of them
  const bare = Object.values(DATA.levels).find((l) => l.gems.length === 0)!;
  assert.ok(bare, 'some levels list no gems');
  assert.deepEqual(data.gemSkins(bare), { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 });
  const dalek = DATA.gemSkins.find((k) => k.n === 'Dalek')!;
  const dressed = data.gemSkins(bare, dalek.gems);
  assert.deepEqual(Object.values(dressed).sort((a, b) => a - b), [...dalek.gems].sort((a, b) => a - b));
  // a look only restyles colours the level already has
  const colours = Object.keys(base).map(Number);
  const missing = [1, 2, 3, 4, 5, 6].find((c) => !colours.includes(c));
  if (missing !== undefined) assert.equal(data.gemSkins(lv, DATA.gemSkins[2].gems)[missing], undefined);
}

// ---- news: bundled, newest first, the original's own tips included
{
  const items = news.newsItems();
  assert.ok(items.length >= 3);
  assert.equal(new Set(items.map((n) => n.id)).size, items.length, 'ids are unique');
  for (const n of items) assert.ok(n.title && n.body, 'every item has a title and text');
  assert.equal(news.latestNewsId(), Math.max(...items.map((n) => n.id)));
  assert.ok(items.some((n) => /never goes online/i.test(n.body)), 'it says why there is no live news');
  const tips = DATA.tips['PerkSkillMenuVer2'];
  assert.ok(tips.length >= 3);
  const tipItem = items.find((n) => n.title.startsWith('Tips'))!;
  for (const t of tips) assert.ok(tipItem.body.includes(t), 'the original tip is shown word for word');
  // opening the news is what clears the badge
  assert.ok(save.SAVE.settings.newsSeen < news.latestNewsId());
}

// ---- credits: the original's text ships with the game
{
  const text = readFileSync(new URL('../public/data/credits.txt', import.meta.url), 'utf8');
  const lines = text.split(/\r?\n/);
  assert.equal(lines[0].trim(), 'DOCTOR WHO: LEGACY');
  for (const must of ['Tiny Rebel Games', 'Seed Studio Inc.', 'Chris Huelsbeck', 'BBC, DOCTOR WHO', 'Futile']) assert.ok(text.includes(must), `credits mention ${must}`);
  assert.ok(lines.length > 200);
}

console.log('options, news and credits tests passed');
