// Pure board rules for the drag-and-swap match-3 (no DOM, no timers).
// The original board is `new GemBoard(6, 5)`: 6 columns x 5 rows, index = col * 5 + row, with row 0 at the BOTTOM.
// Here row 0 is the top (so gravity falls towards higher row numbers); use origRow() for any row number that comes
// from the game data (lock rows, preset grids, tutorial paths), which count from the bottom.
export const COLS = 6;
export const ROWS = 5;

/** Convert a data row (0 = bottom) to an internal row (0 = top), and back (the mapping is its own inverse). */
export const origRow = (r: number): number => ROWS - 1 - r;
export const HEAL = 6; // pink gem colour id

export type Rng = () => number;
export type Board = number[][]; // [row][col], row 0 is the top; 0 = empty

export interface Match {
  color: number;
  cells: [number, number][]; // [row, col]
  power?: number; // gem power factor (1 + boosts - penalties), set when the match is removed
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Weights = [number, number][]; // [gemColor, weight]

/** Per-gem state that travels with the gem. Lock ids follow the original GemState.StateType:
 *  0 normal, 1 cannot be matched, 2 cannot be touched/moved, 3 cannot be swapped with,
 *  4 cannot be picked up, 5 cannot be picked or swapped, 6 cracked (inert). */
export interface GemMeta {
  lock: number;
  lockTurns: number;
  dbl: number; // power bonus (0.5 = +50%)
  sub: number; // power penalty
  bomb: { turns: number; damage: number; pct: number; reset: boolean } | null;
  blind: boolean;
  tut?: boolean; // the gem the tutorial wants the player to drag
  crack: number; // obstacle id (1-4) when this cell is a crack obstacle, else 0
}
export type Meta = (GemMeta | null)[][];

/** Board colour ids: 1-6 are the real colours (6 = heal), 7 is the "Useless" gem that never matches,
 *  8 marks a crack obstacle (inert, immovable, unmatchable). */
export const USELESS = 7;
export const CRACK = 8;

export function emptyMeta(): Meta {
  return Array.from({ length: ROWS }, () => Array<GemMeta | null>(COLS).fill(null));
}

export function metaAt(m: Meta, r: number, c: number): GemMeta {
  return (m[r][c] ??= { lock: 0, lockTurns: 0, dbl: 0, sub: 0, bomb: null, blind: false, crack: 0 });
}

export const canMatch = (m: GemMeta | null) => !m || (m.lock !== 1 && m.lock !== 6);
export const canPick = (m: GemMeta | null) => !m || (m.lock !== 2 && m.lock !== 4 && m.lock !== 5 && m.lock !== 6);
export const canBeSwapped = (m: GemMeta | null) => !m || (m.lock !== 2 && m.lock !== 3 && m.lock !== 5 && m.lock !== 6);

export function pickGem(w: Weights, rng: Rng): number {
  let total = 0;
  for (const [, r] of w) total += r;
  let x = rng() * total;
  for (const [c, r] of w) {
    x -= r;
    if (x < 0) return c;
  }
  return w[w.length - 1][0];
}

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
}

/** Random board that starts without any ready-made matches. */
export function newBoard(w: Weights, rng: Rng): Board {
  const b = emptyBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let g = pickGem(w, rng);
      let tries = 0;
      while (tries++ < 50 && wouldMatch(b, r, c, g)) g = pickGem(w, rng);
      b[r][c] = g;
    }
  }
  return b;
}

function wouldMatch(b: Board, r: number, c: number, g: number): boolean {
  if (c >= 2 && b[r][c - 1] === g && b[r][c - 2] === g) return true;
  if (r >= 2 && b[r - 1][c] === g && b[r - 2][c] === g) return true;
  return false;
}

/** Find all matches: runs of >=3, with runs that share a gem merged (L/T/+ shapes). */
export function findMatches(b: Board, meta?: Meta): Match[] {
  type Run = [number, number][];
  const runs: Run[] = [];
  // gems that cannot be matched (locked) read as -1 so they never join a run
  // gems that never match (locked, the useless gem 7, cracks) read as -1 so they never join a run
  const at = (r: number, c: number): number => (b[r][c] > HEAL || (meta && !canMatch(meta[r][c])) ? -1 : b[r][c]);
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const g = at(r, c);
      let e = c;
      while (e + 1 < COLS && g > 0 && at(r, e + 1) === g) e++;
      if (g > 0 && e - c + 1 >= 3) {
        const run: Run = [];
        for (let k = c; k <= e; k++) run.push([r, k]);
        runs.push(run);
      }
      c = e + 1;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const g = at(r, c);
      let e = r;
      while (e + 1 < ROWS && g > 0 && at(e + 1, c) === g) e++;
      if (g > 0 && e - r + 1 >= 3) {
        const run: Run = [];
        for (let k = r; k <= e; k++) run.push([k, c]);
        runs.push(run);
      }
      r = e + 1;
    }
  }
  // union runs that share a cell
  const parent = runs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map<number, number>();
  runs.forEach((run, i) => {
    for (const [r, c] of run) {
      const key = r * COLS + c;
      const o = owner.get(key);
      if (o === undefined) owner.set(key, i);
      else parent[find(i)] = find(o);
    }
  });
  const groups = new Map<number, Map<number, [number, number]>>();
  runs.forEach((run, i) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = new Map()));
    for (const [r, c] of run) g.set(r * COLS + c, [r, c]);
  });
  const out: Match[] = [];
  for (const g of groups.values()) {
    const cells = [...g.values()];
    out.push({ color: b[cells[0][0]][cells[0][1]], cells });
  }
  // stable order: top-most then left-most, like a scan from the top
  out.sort((a, z) => Math.min(...a.cells.map(([r]) => r)) - Math.min(...z.cells.map(([r]) => r)));
  return out;
}

export interface FallMove {
  col: number;
  fromRow: number; // may be negative for brand-new gems entering from above
  toRow: number;
  color: number;
  isNew: boolean;
}

/** Remove matched cells, drop gems, and refill. Mutates the board. */
export function removeAndFill(b: Board, matches: Match[], w: Weights, rng: Rng, meta?: Meta, pick?: (col: number) => number): FallMove[] {
  for (const m of matches) {
    for (const [r, c] of m.cells) {
      b[r][c] = 0;
      if (meta) meta[r][c] = null;
    }
  }
  const moves: FallMove[] = [];
  for (let c = 0; c < COLS; c++) {
    const kept: { row: number; color: number; meta: GemMeta | null }[] = [];
    for (let r = ROWS - 1; r >= 0; r--) if (b[r][c] !== 0) kept.push({ row: r, color: b[r][c], meta: meta ? meta[r][c] : null });
    let to = ROWS - 1;
    for (const k of kept) {
      b[to][c] = k.color;
      if (meta) meta[to][c] = k.meta;
      if (k.row !== to) moves.push({ col: c, fromRow: k.row, toRow: to, color: k.color, isNew: false });
      to--;
    }
    let n = 0;
    for (let r = to; r >= 0; r--) {
      const color = pick ? pick(c) : pickGem(w, rng);
      b[r][c] = color;
      if (meta) meta[r][c] = null;
      moves.push({ col: c, fromRow: -1 - n, toRow: r, color, isNew: true });
      n++;
    }
  }
  return moves;
}

export interface Cascade {
  matches: Match[];
  moves: FallMove[];
  combo: number; // running combo count after this step
}

/** Fully resolve a board; returns each cascade step for animation. */
export function resolveAll(b: Board, w: Weights, rng: Rng): Cascade[] {
  const steps: Cascade[] = [];
  let combo = 0;
  for (let guard = 0; guard < 40; guard++) {
    const ms = findMatches(b);
    if (ms.length === 0) break;
    combo += ms.length;
    const moves = removeAndFill(b, ms, w, rng);
    steps.push({ matches: ms, moves, combo });
  }
  return steps;
}
