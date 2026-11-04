// The `gameplay` rows of a story script that act on the battle. Shared by the battle view and the tests so both
// run the same code. Names arrive lower-cased from the story interpreter.
import type { Battle, DropRow, Ev } from './engine/battle.ts';

/** What a command may need from its surroundings (all optional in tests). */
export interface CmdHooks {
  shake?(): void;
  dropIn?(): void; // a scripted board was loaded: animate it falling in
  refresh?(): void; // gem state changed: redraw the board
  events?(evs: Ev[]): void; // engine events to play (e.g. a scripted enemy attack)
  gift?(card: GiftSource): void; // a drop card to roll for `rollgift`
  readyEnemies?(): void; // `checkenemyattack,0`: let enemies that are ready to act do so now
}

/** Minimal shape of the level data needed to decode `rollgift` ids. */
export interface GiftLevels {
  [levelId: string]: { em: Record<string, { dr: DropRow[]; dm?: number }> } | undefined;
}

/** The drop card a `rollgift` points at. */
export interface GiftSource {
  levelId: number;
  rows: DropRow[];
  multi: boolean;
}

/**
 * `rollgift,<id>` decodes as `(10000 + level * 1000 + enemy) * 1000 + 100 + drop card`: the drop table of that
 * enemy in that level. The caller rolls it (with the usual ownership rules). Null when the id points nowhere.
 */
export function giftSource(id: number, levels: GiftLevels): GiftSource | null {
  if (!Number.isFinite(id)) return null;
  const ref = Math.floor(id / 1000) - 10000;
  const levelId = Math.floor(ref / 1000);
  const enemy = levels[String(levelId)]?.em[String(ref % 1000)];
  return enemy ? { levelId, rows: enemy.dr, multi: enemy.dm === 1 } : null;
}

/** Every command the story interpreter forwards to the battle that `runStoryCommand` knows how to carry out. */
export const HANDLED_COMMANDS = new Set([
  'shakecamera', 'turnonloadgemdata', 'tutorialgem', 'assignskillcd', 'changeallgemstate', 'callmonsterattackbyindex',
  'closetutorialmode', 'checkenemyattack', 'rollgift',
  'showallmonsterabilityui', // enemies already show their next ability, so there is nothing to switch on
]);

export function runStoryCommand(b: Battle, levels: GiftLevels, action: string, args: string[], hooks: CmdHooks = {}): void {
  const n = (i: number) => parseInt(args[i] ?? '', 10);
  switch (action) {
    case 'shakecamera': // shakecamera,<seconds>,<x>,<y>
      hooks.shake?.();
      break;
    case 'turnonloadgemdata': // swap in a scripted board; it falls in from above
      if (b.loadPreset(args[0] ?? '')) hooks.dropIn?.();
      break;
    case 'tutorialgem': // tutorialgem,<col>,<row>,<col>,<row>: only that drag is allowed
      b.openTutorialGem(n(0), n(1), n(2), n(3));
      hooks.refresh?.();
      break;
    case 'assignskillcd': // assignskillcd,<unit>,<charge>
      b.assignSkillCd(n(0), n(1));
      break;
    case 'changeallgemstate': // changeallgemstate,<lock>,<turns>
      b.changeAllGemState(n(0), n(1));
      hooks.refresh?.();
      break;
    case 'callmonsterattackbyindex': // a scripted enemy hit
      hooks.events?.(b.callMonsterAttack(n(0)));
      break;
    case 'closetutorialmode':
      b.closeTutorialMode();
      break;
    case 'showallmonsterabilityui':
      break;
    case 'checkenemyattack': // 0 = release the wave-start enemy action that the story was holding back; 1 = hold it
      if (n(0) === 0) hooks.readyEnemies?.();
      break;
    case 'rollgift': {
      const src = giftSource(n(0), levels);
      if (src) hooks.gift?.(src);
      break;
    }
    default:
      break; // state jumps and ability-icon display: the flow here needs neither
  }
}
