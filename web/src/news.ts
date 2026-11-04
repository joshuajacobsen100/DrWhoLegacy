// News. The original fetched its news from a Seed Studio server (news-doctorwho.seedstudio.com) and, when it could not
// reach it, showed one "Could not contact news server" message. That server is gone, so this port never goes online:
// the news is written into the game. Nothing is requested or sent.
import { DATA } from './data.ts';

export interface NewsItem {
  id: number; // later items have bigger ids; the title screen badge shows until the newest one has been opened
  title: string;
  date: string;
  body: string;
}

export function newsItems(): NewsItem[] {
  const tips = (DATA.tips?.['PerkSkillMenuVer2'] ?? []).map((t) => `• ${t}`).join('\n');
  const items: NewsItem[] = [
    {
      id: 3,
      title: 'What you can do here',
      date: '2026-11-04',
      body: [
        '• Perks: pick a skill in every group you have opened; Perk groups cost nothing.',
        '• The Tardis: roll for a character or an outfit as often as you like, or take a whole set.',
        '• Outfits drop in missions for the units that can wear them, and Tardis rolls add more.',
        '• If a battle goes badly, Continue brings you back with full health and a fresh board.',
        '• Allies can jump straight to their level cap from their unit screen.',
        '• The Doctor has two abilities that charge together; tap to use the stronger one when it is ready.',
        '• After each victory you may get a One Turn Buff: a random bonus for your next battle only (Options turns it off).',
        '• Log in each day for the daily bonus.',
      ].join('\n'),
    },
    {
      id: 2,
      title: 'About this port',
      date: '2026-11-04',
      body: [
        'This is an unofficial rebuild of Doctor Who: Legacy 3.5.2, made for personal play after the original servers were switched off.',
        'There is no shop and there are no ads. Time Crystals still drop in missions and come from the daily bonus, but nothing needs them.',
        'Your progress is stored in this browser only. Use Options > App info to save a backup file and load it again later.',
      ].join('\n\n'),
    },
    {
      id: 1,
      title: 'News server status',
      date: '',
      body: 'The original game read its news from a server that no longer exists, and showed "Could not contact news server". This port never goes online, so the news you see here is stored in the game itself.',
    },
  ];
  if (tips) items.push({ id: 0, title: 'Tips from the original game', date: '', body: tips });
  return items;
}

/** The newest item's id (what opening the news marks as seen). */
export const latestNewsId = (): number => Math.max(0, ...newsItems().map((n) => n.id));
