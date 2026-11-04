import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(new URL('../web/public/data/gamedata.json', import.meta.url), 'utf8'));
const rows = [];
for (const lv of Object.values(d.levels)) {
  let hp = 0, maxdef = 0, maxhp = 0, abil = 0, n = 0, mincd = 99;
  for (const w of lv.w) for (const [id] of w.en) { const m = lv.em[id]; hp += m.hp; maxdef = Math.max(maxdef, m.def); maxhp = Math.max(maxhp, m.hp); abil += m.ab.length ? 1 : 0; n++; mincd = Math.min(mincd, m.cd); }
  rows.push({ id: lv.id, n: lv.n.slice(0, 40), waves: lv.w.length, enemies: n, hp, maxhp: maxhp, maxdef, abil, mincd, lt: lv.lt });
}
const big = rows.filter((r) => r.hp > 500000).length;
console.log('levels with total enemy hp > 500k:', big, 'of', rows.length);
console.log('with any enemy ability:', rows.filter((r) => r.abil).length, ' with def>0:', rows.filter((r) => r.maxdef > 0).length, ' timed:', rows.filter(r=>r.lt>0).length);
rows.sort((a, b) => b.hp - a.hp);
console.table(rows.slice(0, 5));
console.table(rows.slice(Math.floor(rows.length / 2), Math.floor(rows.length / 2) + 5));
