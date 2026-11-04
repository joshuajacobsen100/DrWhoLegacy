import { readFileSync } from 'node:fs';
globalThis.fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL('../web/public/data/gamedata.json', import.meta.url), 'utf8')) });
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const data = await import('../web/src/data.ts'); await data.loadData();
const save = await import('../web/src/save.ts'); const prog = await import('../web/src/progression.ts');
save.loadSave();
for (const id of save.SAVE.team) { const u = data.DATA.units[String(id)]; console.log(id, u.n, 'type', u.t, 'rank', u.r, 'il', u.il, 'ml', u.ml, 'adr', u.adr, 'lv', save.SAVE.owned[id].lv); }
console.log('doctor level', prog.doctorLevel(save.SAVE.team));
