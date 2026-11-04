// A simple greedy bot that plays on the engine-owned board (used by simulation tests).
import { COLS, ROWS, canBeSwapped, canPick, findMatches, type Match } from '../src/engine/board.ts';
import type { Battle, TurnResult } from '../src/engine/battle.ts';

function score(b: Battle): number {
  return findMatches(b.board, b.meta).reduce((n, m) => n + m.cells.length, 0);
}

function swap(b: Battle, r1: number, c1: number, r2: number, c2: number): void {
  [b.board[r1][c1], b.board[r2][c2]] = [b.board[r2][c2], b.board[r1][c1]];
  [b.meta[r1][c1], b.meta[r2][c2]] = [b.meta[r2][c2], b.meta[r1][c1]];
}

/** Resolve cascades from the current board, applying them to the battle. */
function cascade(b: Battle, first: Match[] | null): Match[] {
  const all: Match[] = [];
  for (let g = 0; g < 40; g++) {
    const ms = first && g === 0 ? first : findMatches(b.board, b.meta);
    if (!ms.length) break;
    all.push(...ms);
    b.removeMatches(ms);
  }
  return all;
}

export interface BotStep {
  res: TurnResult | null;
  acted: boolean;
}

/** One bot action: use a ready ability if it has one, otherwise play the best adjacent swap. */
export function botStep(b: Battle, useAbilities = true): BotStep {
  if (useAbilities) {
    for (let i = 0; i < b.team.length; i++) {
      if (!b.abilityReady(i)) continue;
      const out = b.useAbility(i, { r: 2, c: 2 });
      if (out.ok) {
        if (out.grab) {
          const all = cascade(b, out.grab);
          return { res: b.resolveMove(all), acted: true };
        }
        return { res: out.res!, acted: true };
      }
    }
  }
  let best: [number, number, number, number] | null = null;
  let bestScore = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!canPick(b.meta[r][c])) continue;
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        if (r2 < 0 || c2 < 0 || r2 >= ROWS || c2 >= COLS || !canBeSwapped(b.meta[r2][c2])) continue;
        swap(b, r, c, r2, c2);
        const s = score(b);
        swap(b, r, c, r2, c2);
        if (s > bestScore) {
          bestScore = s;
          best = [r, c, r2, c2];
        }
      }
    }
  }
  if (!best) return { res: null, acted: false };
  swap(b, best[0], best[1], best[2], best[3]);
  const all = cascade(b, null);
  if (!all.length) return { res: null, acted: false };
  return { res: b.resolveMove(all), acted: true };
}

/** Play until victory/defeat/stuck. Returns the outcome and turns used. */
export function playLevel(b: Battle, maxTurns = 400, useAbilities = true, secPerMove = 0): { outcome: 'won' | 'lost' | 'stuck' | 'timeout'; turns: number } {
  let idleSteps = 0;
  // enemies that are ready (countdown 0) open every wave before the player's first move
  if (b.enemiesReady && b.readyEnemyPhase().defeat) return { outcome: 'lost', turns: 0 };
  for (let t = 1; t <= maxTurns; t++) {
    const s = botStep(b, useAbilities);
    if (!s.acted) {
      // no productive move: reshuffle by resetting the board (the real game never deadlocks)
      b.resetBoard();
      if (++idleSteps > 5) return { outcome: 'stuck', turns: t };
      continue;
    }
    idleSteps = 0;
    const r = s.res!;
    if (r.victory) return { outcome: 'won', turns: t };
    if (r.defeat) return { outcome: 'lost', turns: t };
    if (r.waveCleared) {
      b.nextWave();
      if (b.enemiesReady && b.readyEnemyPhase().defeat) return { outcome: 'lost', turns: t };
    }
    // a move costs real time (drag + animations); running out of time is a defeat (a winning move counts first)
    if (secPerMove > 0 && b.timed) {
      b.tickTime(secPerMove * 1000);
      if (b.timeUp) return { outcome: 'timeout', turns: t };
    }
  }
  return { outcome: 'stuck', turns: maxTurns };
}
