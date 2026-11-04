// Enemy (201-230) and ally/Doctor (101-133) ability implementations, ported from
// SeedStudio.SkillFrameWork.Skills in the original game. Type-only imports from battle.ts
// avoid a runtime import cycle.
import { COLS, ROWS, HEAL, origRow, type Match } from './board.ts';
import { mkFx } from './battle.ts';
import type { AbilityDef, Battle, Enemy, UnitAbility } from './battle.ts';

export interface SkillTarget {
  r: number;
  c: number;
}

const num = (p: string[], i: number, d = 0): number => {
  const v = parseFloat(p[i]);
  return Number.isFinite(v) ? v : d;
};

function shuffle<T>(b: Battle, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = b.randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const iconUrl = (id: number | null | undefined) => (id ? `img/ability/${id}.png` : null);
export { iconUrl };

function stealColor(b: Battle, color: number): void {
  if (color <= 0) return;
  const cells = b.cellsWhere((r, c) => b.board[r][c] === color && b.isMatchable(r, c));
  b.removeCells(cells);
}

function sap(b: Battle, color: number, pct: number): void {
  for (const [r, c] of b.cellsWhere((r, c) => b.board[r][c] === color)) b.metaOf(r, c).sub = pct;
  b.emit({ k: 'board', kind: 'sync' });
}

function boost(b: Battle, color: number, pct: number): void {
  for (const [r, c] of b.cellsWhere((r, c) => b.board[r][c] === color)) b.metaOf(r, c).dbl = pct;
  b.emit({ k: 'board', kind: 'sync' });
}

function lockCells(b: Battle, cells: [number, number][], state: number, turns: number): void {
  // perk "Debuff Resistance - Lock Turn": shorter locks; a lock cut to nothing does not happen
  if (b.perks.lockTurn !== 0 && turns > 0) {
    turns = Math.max(0, turns + b.perks.lockTurn);
    if (turns === 0) {
      b.emit({ k: 'text', target: 'player', idx: 0, text: 'Resist', color: '#ffe066' });
      return;
    }
  }
  for (const [r, c] of cells) {
    const g = b.metaOf(r, c);
    if (g.lock === 6) continue;
    g.lock = state;
    g.lockTurns = turns;
  }
  b.emit({ k: 'board', kind: 'sync' });
}

function shuffleLines(b: Battle, rows: boolean): void {
  const lines = rows ? ROWS : COLS;
  const len = rows ? COLS : ROWS;
  for (let l = 0; l < lines; l++) {
    const cell = (k: number): [number, number] => (rows ? [l, k] : [k, l]);
    const idx: number[] = [];
    for (let k = 0; k < len; k++) {
      const [r, c] = cell(k);
      const lk = b.metaOf(r, c).lock;
      if (lk !== 2 && lk !== 6) idx.push(k); // immovable gems and cracks stay put
    }
    const items = idx.map((k) => {
      const [r, c] = cell(k);
      return { color: b.board[r][c], meta: b.meta[r][c] };
    });
    shuffle(b, items);
    idx.forEach((k, n) => {
      const [r, c] = cell(k);
      b.board[r][c] = items[n].color;
      b.meta[r][c] = items[n].meta;
    });
  }
  b.emit({ k: 'board', kind: 'sync' });
}

function bombGems(b: Battle, color: number, amount: number, allowLocked: boolean, turns: number, damage: number, pct: number, reset: boolean): void {
  let cells = b.cellsWhere((r, c) => {
    if (color !== 0 && b.board[r][c] !== color) return false;
    const lock = b.meta[r][c]?.lock ?? 0;
    const movable = lock !== 2 && lock !== 6;
    return (movable || allowLocked) && b.isMatchable(r, c);
  });
  if (amount > 0) cells = shuffle(b, cells).slice(0, amount);
  for (const [r, c] of cells) b.metaOf(r, c).bomb = { turns, damage, pct, reset };
  b.emit({ k: 'board', kind: 'sync' });
}

function stunUnit(b: Battle, i: number, turns: number, icon: string | null): void {
  if (b.perks.stun !== 0) turns = Math.max(1, turns + b.perks.stun); // perk "Debuff Resistance - Stun"
  b.unitSt[i].stun = mkFx(turns, { icon });
  b.emit({ k: 'text', target: 'unit', idx: i, text: 'Stunned', color: '#ffe066' });
}

export function runEnemySkill(b: Battle, e: Enemy, idx: number, d: AbilityDef): void {
  const p = d.p;
  const icon = d.icon;
  switch (d.t) {
    case 201:
      stunUnit(b, b.randInt(b.team.length), num(p, 0, 1), icon);
      break;
    case 219:
      b.team.forEach((_, i) => stunUnit(b, i, num(p, 0, 1), icon));
      break;
    case 220: {
      const color = num(p, 1);
      b.team.forEach((u, i) => {
        if (u.colors.includes(color)) stunUnit(b, i, num(p, 0, 1), icon);
      });
      break;
    }
    case 202:
      b.pFx.poison = mkFx(num(p, 0, 3), { v: num(p, 1), icon });
      b.emit({ k: 'text', target: 'player', idx: 0, text: 'Poisoned', color: '#b36bff' });
      break;
    case 204:
      b.pFx.bomb = mkFx(num(p, 0, 3), { v: num(p, 1), icon });
      b.emit({ k: 'text', target: 'player', idx: 0, text: 'Time bomb', color: '#ff9f43' });
      break;
    case 222:
      b.pFx.tap = mkFx(num(p, 0, 2), { v: num(p, 1), icon });
      b.emit({ k: 'text', target: 'player', idx: 0, text: 'Life tap', color: '#ff6b81' });
      break;
    case 230:
      b.pFx.move = mkFx(num(p, 1, 3), { v: num(p, 0, 1), icon });
      b.emit({ k: 'text', target: 'player', idx: 0, text: 'Slowed', color: '#9ad0ff' });
      break;
    case 224: {
      const dmg = Math.trunc(b.hp * num(p, 0));
      b.hurtPlayer(b.perkHurt(Math.max(1, dmg), e.color), idx);
      b.chargeDoctor(b.perks.doctorHurt);
      break;
    }
    case 203:
      sap(b, HEAL, num(p, 0));
      break;
    case 213:
      sap(b, num(p, 1), num(p, 0));
      break;
    case 225:
      sap(b, num(p, 0), num(p, 1));
      stealColor(b, num(p, 2));
      b.convertColor(num(p, 3), num(p, 4));
      break;
    case 205:
      b.convertColor(num(p, 0), num(p, 1));
      break;
    case 212:
      b.convertColor(num(p, 0), num(p, 1));
      b.convertColor(num(p, 2), num(p, 3));
      break;
    case 206: {
      const present = b.colorsOnBoard;
      if (present.length) stealColor(b, present[b.randInt(present.length)]);
      break;
    }
    case 211:
      stealColor(b, num(p, 0));
      break;
    case 207: {
      const pool = b.waves[b.waveIndex];
      if (pool.length) b.spawn(pool[b.randInt(pool.length)], e);
      break;
    }
    case 208: {
      const def = b.spawnDefs[num(p, 0)];
      if (def) b.spawn(def, e);
      break;
    }
    case 209: {
      let target = idx;
      if (num(p, 1) === -1) {
        const others = b.aliveEnemies.filter((i) => i !== idx);
        if (others.length) target = others[b.randInt(others.length)];
      }
      b.healEnemy(target, Math.trunc(num(p, 0)));
      break;
    }
    case 210: {
      const count = Math.min(num(p, 0), ROWS * COLS);
      const cells = shuffle(b, b.cellsWhere((r, c) => (b.meta[r][c]?.lock ?? 0) !== 6)).slice(0, count);
      lockCells(b, cells, num(p, 1), num(p, 2));
      break;
    }
    case 214: {
      const cols = [num(p, 0, -1), num(p, 1, -1)].filter((c) => c >= 0 && c < COLS);
      lockCells(b, b.cellsWhere((_r, c) => cols.includes(c)), num(p, 2), num(p, 3));
      break;
    }
    case 215: {
      // row numbers in the data count from the bottom of the board
      const rows = [num(p, 0, -1), num(p, 1, -1)].filter((r) => r >= 0 && r < ROWS);
      lockCells(b, b.cellsWhere((r) => rows.includes(origRow(r))), num(p, 2), num(p, 3));
      break;
    }
    case 221: {
      // Original: index = 20 * (n / 2) + {0,1,5,6} + 3 * (n % 2) on a column-major 6x5 board (index = col * 5 + row),
      // i.e. 2x2 blocks: 0 = bottom-left, 1 = top-left, 2 = bottom-right, 3 = top-right (rows counted from the bottom).
      const blocks = [num(p, 0, -1), num(p, 1, -1)].filter((n) => n >= 0 && n < 4);
      const inBlock = (r: number, c: number, n: number) => {
        const row = origRow(r);
        const r0 = n % 2 ? 3 : 0;
        const c0 = n >= 2 ? COLS - 2 : 0;
        return row >= r0 && row < r0 + 2 && c >= c0 && c < c0 + 2;
      };
      lockCells(b, b.cellsWhere((r, c) => blocks.some((n) => inBlock(r, c, n))), num(p, 2), num(p, 3));
      break;
    }
    case 216:
      for (const [r, c] of b.cellsWhere((r, c) => (b.meta[r][c]?.lock ?? 0) !== 6)) b.metaOf(r, c).blind = true;
      b.emit({ k: 'board', kind: 'sync' });
      break;
    case 217:
      shuffleLines(b, true);
      break;
    case 218:
      shuffleLines(b, false);
      break;
    case 223:
      b.clearEnemyDebuffs(e);
      e.fx.immune = mkFx(num(p, 0, 3), { icon });
      break;
    case 226:
      b.clearEnemyDebuffs(e);
      e.fx.shadow = mkFx(num(p, 0, 3), { icon });
      break;
    case 227:
      // [Color, Type, Turn, HurtPercentage, DamagePercentage]
      e.fx.reflect = mkFx(num(p, 2, 2), { c: num(p, 0), t: num(p, 1), v: num(p, 3), w: num(p, 4), icon });
      break;
    case 229:
      // [Turn, Combo, Percentage]
      e.fx.shield = mkFx(num(p, 0, 3), { c: num(p, 1), v: num(p, 2), icon });
      break;
    case 228:
      bombGems(b, num(p, 0), num(p, 1), num(p, 2) !== 0, num(p, 3, 3), num(p, 4), num(p, 5), num(p, 6) === 1);
      break;
    default:
      break;
  }
}

export interface AllyOut {
  ok: boolean;
  needsTarget?: boolean;
  grab?: Match[];
}

const NEEDS_TARGET = new Set([128, 129, 130, 131, 132, 133]);

export function runAllySkill(b: Battle, ui: number, ab: UnitAbility, target?: SkillTarget): AllyOut {
  const p = ab.p;
  const icon = ab.icon;
  if (NEEDS_TARGET.has(ab.t) && !target) return { ok: false, needsTarget: true };
  switch (ab.t) {
    case 101: {
      const ti = b.pickTarget();
      if (ti < 0) return { ok: false };
      const e = b.enemies[ti];
      b.hurtEnemy(ti, b.damageTo(num(p, 1), num(p, 0), e), num(p, 0));
      return { ok: true };
    }
    case 102: {
      const type = num(p, 0);
      const dmg = num(p, 1);
      const mode = num(p, 2);
      for (const i of b.aliveEnemies) {
        const e = b.enemies[i];
        const amount = mode === 0 ? b.damageTo(dmg, type, e) : mode === 1 ? Math.max(1, Math.trunc((e.hp * dmg) / 100)) : dmg;
        b.hurtEnemy(i, amount, type);
      }
      return { ok: true };
    }
    case 123: {
      const alive = b.aliveEnemies;
      if (!alive.length) return { ok: false };
      const each = Math.trunc(num(p, 1) / alive.length);
      for (const i of alive) {
        const e = b.enemies[i];
        b.hurtEnemy(i, b.damageTo(each, num(p, 0), e), num(p, 0));
      }
      return { ok: true };
    }
    case 103:
      b.healPlayer(Math.trunc(num(p, 0)));
      return { ok: true };
    case 116:
      b.healPlayer(Math.trunc(b.maxHp * num(p, 0)));
      return { ok: true };
    case 104:
    case 106:
    case 108: {
      const ti = b.pickTarget();
      if (ti < 0) return { ok: false };
      const e = b.enemies[ti];
      if (!b.canDebuff(e)) {
        b.emit({ k: 'text', target: 'enemy', idx: ti, text: 'Immune', color: '#cfd8e3' });
        return { ok: true };
      }
      if (ab.t === 104) e.fx.poison = mkFx(num(p, 0, 3), { v: num(p, 1), icon });
      else if (ab.t === 106) e.fx.stun = mkFx(num(p, 0, 1), { icon });
      else e.fx.bomb = mkFx(num(p, 0, 3), { v: num(p, 1), icon });
      return { ok: true };
    }
    case 115:
      for (const i of b.aliveEnemies) if (b.canDebuff(b.enemies[i])) b.enemies[i].fx.stun = mkFx(num(p, 0, 1), { icon });
      return { ok: true };
    case 121:
      for (const i of b.aliveEnemies) if (b.canDebuff(b.enemies[i])) b.enemies[i].fx.tap = mkFx(num(p, 0, 2), { v: num(p, 1), icon });
      return { ok: true };
    case 105:
      delete b.pFx.poison;
      return { ok: true };
    case 113:
      delete b.pFx.bomb;
      return { ok: true };
    case 107:
      b.unitSt.forEach((u) => delete u.stun);
      return { ok: true };
    case 109:
      boost(b, num(p, 0), num(p, 1));
      return { ok: true };
    case 124: {
      const colors = shuffle(b, [...b.colorsOnBoard]).slice(0, Math.max(0, Math.min(6, num(p, 0))));
      for (const c of colors) boost(b, c, num(p, 1));
      return { ok: true };
    }
    case 110:
      b.convertColor(num(p, 0), num(p, 1));
      return { ok: true };
    case 114:
      b.convertColor(num(p, 0), num(p, 1));
      b.convertColor(num(p, 2), num(p, 3));
      return { ok: true };
    case 125: {
      const present = shuffle(b, [...b.colorsOnBoard]);
      if (present.length < 2) return { ok: false };
      const options = [1, 2, 3, 4, 5, 6].filter((c) => c !== present[0] && c !== present[1]);
      const to = options[b.randInt(options.length)];
      b.convertColor(present[0], to);
      b.convertColor(present[1], to);
      return { ok: true };
    }
    case 111:
      stealColor(b, num(p, 0));
      return { ok: true };
    case 112:
      for (const [r, c] of b.cellsWhere((r, c) => (b.meta[r][c]?.lock ?? 0) > 0)) {
        const g = b.metaOf(r, c);
        if (g.lock !== 6) {
          g.lock = 0;
          g.lockTurns = 0;
        }
      }
      b.emit({ k: 'board', kind: 'sync' });
      return { ok: true };
    case 117:
      b.resetBoard();
      return { ok: true };
    case 118: {
      const pct = num(p, 0);
      const old = b.pFx.maxhp?.v ?? 0;
      const ratio = b.hp / b.maxHp;
      b.maxHp = Math.trunc((b.maxHp / (1 + old)) * (1 + pct));
      b.hp = Math.min(b.maxHp, Math.max(b.hp, Math.trunc(ratio * b.maxHp)));
      b.pFx.maxhp = mkFx(num(p, 1, 3), { v: pct, icon });
      return { ok: true };
    }
    case 119: {
      const t = num(p, 0, 2);
      b.pFx.moveBonus = mkFx(num(p, 1, 3), { v: t > 5 ? t - 5 : t, icon });
      return { ok: true };
    }
    case 120:
      b.extraDrop = { color: num(p, 0), left: Math.trunc(num(p, 1)) };
      return { ok: true };
    case 122:
      if (!b.timed) {
        b.emit({ k: 'text', target: 'player', idx: 0, text: 'No time limit', color: '#cfd8e3' });
        return { ok: false }; // nothing to extend: do not spend the charge
      }
      b.addTime(num(p, 0, 10));
      b.emit({ k: 'text', target: 'player', idx: 0, text: `+${num(p, 0, 10)}s`, color: '#7dd3fc' });
      return { ok: true };
    case 126:
      for (const [r, c] of b.cellsWhere((r, c) => !!b.meta[r][c]?.blind)) b.metaOf(r, c).blind = false;
      b.emit({ k: 'board', kind: 'sync' });
      return { ok: true };
    case 127: {
      const color = num(p, 0);
      const cells = shuffle(
        b,
        b.cellsWhere((r, c) => !!b.meta[r][c]?.bomb && (color === 0 || b.board[r][c] === color)),
      );
      const n = num(p, 1) > 0 ? num(p, 1) : cells.length;
      for (const [r, c] of cells.slice(0, n)) b.metaOf(r, c).bomb = null;
      b.emit({ k: 'board', kind: 'sync' });
      return { ok: true };
    }
    case 128:
    case 129:
    case 130:
    case 131: {
      const { r, c } = target!;
      const color = b.board[r][c];
      const cells =
        ab.t === 128
          ? b.cellsWhere((rr, cc) => b.board[rr][cc] === color)
          : ab.t === 129
            ? b.cellsWhere((rr) => rr === r)
            : ab.t === 130
              ? b.cellsWhere((_rr, cc) => cc === c)
              : b.cellsWhere((rr, cc) => rr === r || cc === c);
      const grabbed = cells.filter(([rr, cc]) => b.isMatchable(rr, cc));
      // grabbed gems count as matches of their colour, one match per colour
      const byColor = new Map<number, [number, number][]>();
      for (const [rr, cc] of grabbed) {
        const col = b.board[rr][cc];
        if (!byColor.has(col)) byColor.set(col, []);
        byColor.get(col)!.push([rr, cc]);
      }
      const matches: Match[] = [...byColor.entries()].map(([color, cs]) => ({ color, cells: cs }));
      return { ok: matches.length > 0, grab: matches };
    }
    case 132: {
      const { r, c } = target!;
      b.convertColor(b.board[r][c], num(p, 0));
      return { ok: true };
    }
    case 133: {
      const { r, c } = target!;
      const color = b.board[r][c];
      const clearSub = p[0] === '1';
      const clearNoMatch = p[1] === '1';
      const clearNoMove = p[2] === '1';
      for (const [rr, cc] of b.cellsWhere((rr, cc) => b.board[rr][cc] === color)) {
        const g = b.meta[rr][cc];
        if (!g) continue;
        if (clearSub) g.sub = 0;
        if (clearNoMatch && g.lock === 1) g.lock = 0;
        if (clearNoMove && g.lock === 2) g.lock = 0;
      }
      b.emit({ k: 'board', kind: 'sync' });
      return { ok: true };
    }
    default:
      void ui;
      return { ok: false };
  }
}
