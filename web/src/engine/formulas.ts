// Damage formulas ported from the original BattleFormula.
export type TypeRel = Record<string, Record<string, number>>;

export const COMBO_RATE = 0.25;
export const BASE_MATCH = 3;

export function comboDamage(damage: number, combo: number): number {
  return Math.trunc(damage * (1 + COMBO_RATE * (combo - 1)));
}

export function matchGemDamage(base: number, count: number): number {
  return base * (1 + COMBO_RATE * (count - BASE_MATCH));
}

export function totalDamage(att: number, attColor: number, def: number, defColor: number, rel: TypeRel): number {
  const r = rel[attColor]?.[defColor] ?? 1;
  const n = Math.trunc(att * r - def);
  return n <= 0 ? 1 : n;
}
