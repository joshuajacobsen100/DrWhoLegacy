// Daily login bonus. The original asked its server which of 5 days the player was on; offline we keep the streak
// ourselves: claim on consecutive calendar days to advance, miss a day and it starts again at day 1.
import { DATA, type DailyBonusDef } from './data.ts';
import { SAVE, addItem } from './save.ts';

export const DAY_COUNT = 5;

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface DailyStatus {
  canClaim: boolean;
  day: number; // the day being offered (or the day last claimed today)
  rewards: DailyBonusDef[]; // days 1..5
}

export function dailyStatus(now: Date = new Date()): DailyStatus {
  const rewards = [...(DATA.dailyBonus ?? [])].sort((a, b) => a.day - b.day);
  const { last, day } = SAVE.daily;
  const today = dateKey(now);
  if (last === today) return { canClaim: false, day, rewards };
  const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const next = last === yesterday && day >= 1 ? (day % DAY_COUNT) + 1 : 1;
  return { canClaim: rewards.length > 0, day: next, rewards };
}

/** Claim today's reward. Returns the reward, or null if it was already claimed. */
export function claimDaily(now: Date = new Date()): DailyBonusDef | null {
  const st = dailyStatus(now);
  if (!st.canClaim) return null;
  const reward = st.rewards.find((r) => r.day === st.day);
  if (!reward) return null;
  addItem(reward.item_id, reward.count); // every reward in the data is a fragment or Time Crystals
  SAVE.daily = { last: dateKey(now), day: st.day };
  return reward;
}
