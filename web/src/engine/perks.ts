// Perk effects ported from the original PerkSkillFramework (PerkSkillCommand + PerkSkillHandleOutput).
// A perk "skill" is a list of numbered functions with parameters; every function the player has selected is
// summed into one PerkFx, which the battle engine consults at the same points the original does.
import { COLS, ROWS, origRow, type Match } from './board.ts';

export type PerkFn = [number, string[]];

export interface PerkFx {
  atkPct: number; // 1: team attack x(1 + pct)
  hpAdd: number; // 1: sum of trunc(maxHp * pct) per perk
  healAdd: number; // 1: sum of trunc(heal * pct) per perk
  hpPcts: number[]; // 1 (hp), kept so the engine can truncate against the real total
  healPcts: number[]; // 1 (heal)
  colorDmg: number[]; // 2: [colour] -> extra damage fraction
  colorHurt: number[]; // 3: [colour of the enemy] -> change in damage taken (negative = less)
  shapeDmg: Record<string, number>; // 4: shape key -> fraction
  shapeCure: Record<string, number>; // 29: shape key -> fraction of max HP healed
  poison: number; // 5: added to the poison fraction (negative)
  bomb: number; // 6: fraction of time-bomb damage changed (negative)
  stun: number; // 7: turns added to a stun (negative)
  lockTurn: number; // 8: turns added to a gem lock (negative)
  c2c: [number, number, number][]; // 10: [attack colour, defence colour, rate added]
  doctorCd: number; // 11: fraction of the Doctor's cooldown (negative = shorter)
  doctorCombo: number; // 12: extra Doctor charge after a move with a combo
  doctorKill: number; // 13: Doctor charge per enemy killed
  doctorHurt: number; // 14: Doctor charge whenever an enemy hits
  pen: number[]; // 15: [enemy colour] -> fraction of its defence changed (negative = ignored)
  healBelow: [number, number][]; // 17: [hp fraction, fraction of max HP healed]
  dmgBelow: [number, number][]; // 18: [hp fraction, extra damage fraction]
  hurtBelow: [number, number][]; // 19: [hp fraction, change in damage taken]
  wave: number[]; // 20: [colour] -> gems of that colour are boosted when a wave starts
  drop: number[]; // 21: [colour] -> added to that colour's drop weight
  comboMaster: [number, number][]; // 22: [combo count, extra damage fraction]
  autoHeal: number; // 23: fraction of max HP healed after a move with a combo
  skillHeal: number; // 24: fraction of max HP healed when an ally ability is used
  vampire: number; // 25: HP healed per attack that lands
  moveTime: number; // 26: seconds added to the move timer
  matchNum: [number, number, number][]; // 27: [colour, gems matched, extra damage fraction]
  leechHp: number; // 30: fraction of max HP gained (positive) or lost (negative) each turn
  leechAtk: number; // 30: change in all damage dealt
}

const C = 8; // colours are 1..7 (7 = the useless gem / "stone")

export function emptyPerks(): PerkFx {
  const z = () => new Array<number>(C).fill(0);
  return {
    atkPct: 0, hpAdd: 0, healAdd: 0, hpPcts: [], healPcts: [], colorDmg: z(), colorHurt: z(), shapeDmg: {}, shapeCure: {},
    poison: 0, bomb: 0, stun: 0, lockTurn: 0, c2c: [], doctorCd: 0, doctorCombo: 0, doctorKill: 0, doctorHurt: 0, pen: z(),
    healBelow: [], dmgBelow: [], hurtBelow: [], wave: z(), drop: z(), comboMaster: [], autoHeal: 0, skillHeal: 0, vampire: 0,
    moveTime: 0, matchNum: [], leechHp: 0, leechAtk: 0,
  };
}

export function hasPerks(p: PerkFx | undefined): p is PerkFx {
  return !!p && JSON.stringify(p) !== JSON.stringify(emptyPerks());
}

/** Sum a list of selected perk functions into one PerkFx. Unknown or unused function ids are ignored. */
export function compilePerks(fns: PerkFn[]): PerkFx {
  const p = emptyPerks();
  const n = (a: string[], i: number) => {
    const v = parseFloat(a[i]);
    return Number.isFinite(v) ? v : 0;
  };
  for (const [id, a] of fns) {
    switch (id) {
      case 1: // Basic Attribute: [type, pct]
        if (a[0] === 'atk') p.atkPct += n(a, 1);
        else if (a[0] === 'hp') p.hpPcts.push(n(a, 1));
        else if (a[0] === 'heal') p.healPcts.push(n(a, 1));
        break;
      case 2: p.colorDmg[n(a, 0)] += n(a, 1); break;
      case 3: p.colorHurt[n(a, 0)] += n(a, 1); break;
      case 4: { const k = (a[0] ?? '').toLowerCase(); p.shapeDmg[k] = (p.shapeDmg[k] ?? 0) + n(a, 1); break; }
      case 5: p.poison += n(a, 0); break;
      case 6: p.bomb += n(a, 0); break;
      case 7: p.stun += n(a, 0); break;
      case 8: p.lockTurn += n(a, 0); break;
      case 10: p.c2c.push([n(a, 0), n(a, 1), n(a, 2)]); break;
      case 11: p.doctorCd += n(a, 0); break;
      case 12: p.doctorCombo += n(a, 0); break;
      case 13: p.doctorKill += n(a, 0); break;
      case 14: p.doctorHurt += n(a, 0); break;
      case 15: p.pen[n(a, 0)] += n(a, 1); break;
      case 17: p.healBelow.push([n(a, 0), n(a, 1)]); break;
      case 18: p.dmgBelow.push([n(a, 0), n(a, 1)]); break;
      case 19: p.hurtBelow.push([n(a, 0), n(a, 1)]); break;
      case 20: p.wave[n(a, 0)] += n(a, 1); break;
      case 21: p.drop[n(a, 0)] += n(a, 1); break;
      case 22: p.comboMaster.push([n(a, 0), n(a, 1)]); break;
      case 23: p.autoHeal += n(a, 0); break;
      case 24: p.skillHeal += n(a, 0); break;
      case 25: p.vampire += n(a, 0); break;
      case 26: p.moveTime += n(a, 0); break;
      case 27: p.matchNum.push([n(a, 0), n(a, 1), n(a, 2)]); break;
      case 29: { const k = (a[0] ?? '').toLowerCase(); p.shapeCure[k] = (p.shapeCure[k] ?? 0) + n(a, 1); break; }
      case 30: p.leechHp += n(a, 0); p.leechAtk += n(a, 1); break;
      default: break; // 9, 16 and 28 exist in the original but no perk skill uses them
    }
  }
  return p;
}

// ------------------------------------------------------------------ shapes
const COLOR_NAMES = ['', 'red', 'blue', 'yellow', 'green', 'black', 'pink', 'stone'];

/**
 * Named shapes made by this move's matches (the original's GemComboManager.shapename): a T (bar of three with a
 * two-gem stem hanging below it), a cross (plus sign) and a full row of six. Keys are lower case, e.g. "red_t",
 * "blue_cross", "a1 h6". Perk skills name them the same way ("Red_T", "A1 H6").
 */
export function shapesOf(matches: Match[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const has = new Set(m.cells.map(([r, c]) => c * ROWS + origRow(r))); // [col, row-from-bottom]
    const at = (c: number, row: number) => c >= 0 && c < COLS && row >= 0 && row < ROWS && has.has(c * ROWS + row);
    const name = COLOR_NAMES[m.color] ?? '';
    for (let c = 0; c < COLS; c++) {
      for (let row = 0; row < ROWS; row++) {
        // T: bar (c..c+2, row) with the stem (c+1, row-1) and (c+1, row-2)
        if (at(c, row) && at(c + 1, row) && at(c + 2, row) && at(c + 1, row - 1) && at(c + 1, row - 2)) out.add(`${name}_t`);
        // cross: centre (c+1, row) with all four neighbours
        if (at(c, row) && at(c + 1, row) && at(c + 2, row) && at(c + 1, row - 1) && at(c + 1, row + 1)) out.add(`${name}_cross`);
      }
    }
    for (let row = 0; row < ROWS; row++) {
      if (Array.from({ length: COLS }, (_, c) => at(c, row)).every(Boolean)) out.add(`a${m.color} h6`);
    }
  }
  return out;
}

/** Sum the fractions of the entries of a shape table whose shape was made this move. */
export function shapeBonus(table: Record<string, number>, made: Set<string>): number {
  let s = 0;
  for (const k of made) s += table[k] ?? 0;
  return s;
}
