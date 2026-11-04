// Story script interpreter, ported from the original DialogStorySys / DialogStoryFormual / *Action classes.
// A script is a list of rows (actor, fade, move, wait, text, gameplay, setskip, trigger, ...). Rows run in order;
// a `trigger` row suspends the story until a battle condition holds, and while a row is active the board is locked.

export interface StoryRow {
  t: string;
  [attr: string]: string;
}

/** What the story needs to know about (and do to) the battle. Implemented by the battle view. */
export interface StoryHost {
  waveNumber(): number; // 1-based current wave
  aliveEnemies(): number;
  boardIdle(): boolean; // the board is waiting for player input
  moves(): number; // moves the player has made so far
  tutorialDone(): boolean; // the last scripted drag (`tutorialgem`) was completed
  gameplay(action: string, args: string[]): void;
  beep(name: string, volume: number): void; // typing blip (chatbeeplow / chatbeepmid / chatbeephigh)
  playSound(id: string, volume: number): void; // a sound from the original sound table by id
  playMusic(name: string, volume: number, restart: boolean): void; // loop a music track by name
}

export type Ease = 'linear' | 'in' | 'out';

export interface Actor {
  name: string;
  srcType: string;
  srcValue: string;
  x: number;
  y: number;
  alignY: number | null; // 1 = y is the centre measured down from the top; null = y is measured up from the bottom
  layer: 'back' | 'center' | 'front';
  alpha: number;
  color: [number, number, number, number];
  scaleX: number;
  scaleY: number;
  rotation: number;
  width?: number;
  height?: number;
}

interface Tween {
  actor: Actor;
  prop: 'alpha' | 'pos';
  t: number;
  dur: number;
  ease: Ease;
  from: number;
  to: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

export interface TextState {
  full: string;
  shown: number; // characters revealed
  done: boolean;
  wait: 'user' | 'finished';
  skippable: boolean;
  sfx: string | null;
  one: string | null; // `onesfx`: a sound played once as the line starts
  hideActors: boolean;
}

const LAYER_ORDER = { back: 0, center: 1, front: 2 } as const;

function num(v: string | undefined, d: number): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
}

function easeFn(e: Ease, k: number): number {
  const t = Math.max(0, Math.min(1, k));
  if (e === 'in') return t * t * t; // CubicIn
  if (e === 'out') return 1 - Math.pow(1 - t, 3); // CubicOut
  return t;
}

/** Row indexes that carry a `tag` attribute (skip and goto jump to these). */
export function buildTagMap(rows: StoryRow[]): Map<number, number> {
  const m = new Map<number, number>();
  rows.forEach((r, i) => {
    if (r.tag !== undefined && !m.has(+r.tag)) m.set(+r.tag, i);
  });
  return m;
}

export class Story {
  rows: StoryRow[];
  host: StoryHost;
  tags: Map<number, number>;
  pc = 0;
  mode: 'running' | 'suspended' | 'done' = 'running';
  actors = new Map<string, Actor>();
  /**
   * Sprites in the battle layer (`setspritetolayer`): independent copies of a story actor's image, positioned in board
   * coordinates (x = 70 + 100 * col, y = 50 + 100 * row, up from the board bottom). They stay visible while the story waits.
   */
  layerSprites = new Map<string, Actor>();
  text: TextState | null = null;
  textVisible = false;
  skip: { tag: number; closeWnd: boolean; closeSprite: boolean } | null = null;
  victory = false; // the level has been won: every remaining trigger counts as satisfied
  private tweens: Tween[] = [];
  private clock = 0;
  private waitUntil = -1;
  private waitMin = -1;
  private textClock = 0;
  private tapQueued = false;
  private begun = false; // the current row has been started
  forwarded: string[] = []; // gameplay commands handed to the host (battle) to carry out, for diagnostics

  constructor(rows: StoryRow[], host: StoryHost) {
    this.rows = rows;
    this.host = host;
    this.tags = buildTagMap(rows);
    if (!rows.length) this.mode = 'done';
  }

  /** The board must ignore the player while a row is actively running. */
  get locked(): boolean {
    return this.mode === 'running';
  }

  get done(): boolean {
    return this.mode === 'done';
  }

  get canSkip(): boolean {
    return this.mode === 'running' && this.skip !== null;
  }

  /** Visible actors, back to front. */
  get sortedActors(): Actor[] {
    return [...this.actors.values()].sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
  }

  // ------------------------------------------------------------------ input
  tap(): void {
    this.tapQueued = true;
  }

  /** Skip button: jump to the row with the skip tag (only forwards, like the original). */
  skipNow(): boolean {
    if (!this.canSkip || !this.skip) return false;
    const target = this.tags.get(this.skip.tag);
    if (target === undefined || target <= this.pc) return false;
    if (this.skip.closeWnd) {
      this.text = null;
      this.textVisible = false;
    }
    if (this.skip.closeSprite) {
      this.actors.clear();
      this.layerSprites.clear();
      this.tweens = [];
    }
    this.pc = target;
    this.begun = false;
    this.waitUntil = -1;
    return true;
  }

  // ------------------------------------------------------------------ conditions
  /** Evaluate a trigger formula such as "waitwaveindex, 3" against the battle. */
  condition(formula: string): boolean {
    if (this.victory) return true; // after the win, play out whatever is left
    const [name, ...args] = formula.split(',').map((s) => s.trim());
    const n = parseInt(args[0] ?? '', 10);
    switch (name.toLowerCase()) {
      case 'waitwaveindex':
        return this.host.waveNumber() === n;
      case 'checkenemycount':
        return this.host.aliveEnemies() === n;
      case 'checkgamestate':
        // 3 = waiting for input, 11 = victory (handled above); anything else is a transient state
        return n === 3 || n === 2 || n === 10 || n === 12 ? this.host.boardIdle() : n !== 11 ? !this.host.boardIdle() : false;
      case 'checkgettoend':
        return this.host.tutorialDone(); // the scripted drag was completed
      default:
        return true;
    }
  }

  // ------------------------------------------------------------------ the VM
  update(dt: number): void {
    this.clock += dt;
    this.updateTweens(dt);
    let guard = 0;
    while (this.mode !== 'done' && guard++ < 500) {
      if (this.mode === 'suspended') {
        const row = this.rows[this.pc];
        if (this.condition(row.formula ?? '')) {
          this.mode = 'running';
          this.pc++;
          this.begun = false;
          continue;
        }
        break;
      }
      if (this.pc >= this.rows.length) {
        this.finish();
        break;
      }
      if (!this.step(dt)) break; // blocking row still active
    }
    if (this.tapQueued) this.tapQueued = false; // a tap only counts for the row that was active
  }

  private finish(): void {
    this.mode = 'done';
    this.text = null;
    this.textVisible = false;
    this.actors.clear();
    this.layerSprites.clear();
    this.tweens = [];
    this.skip = null;
  }

  /** Run the current row. Returns true when the row finished and the VM should continue. */
  private step(dt: number): boolean {
    const row = this.rows[this.pc];
    const advance = () => {
      this.pc++;
      this.begun = false;
      return true;
    };
    switch (row.t) {
      case 'actor':
        this.doActor(row);
        return advance();
      case 'fade':
        this.doFade(row);
        return advance();
      case 'move':
        this.doMove(row);
        return advance();
      case 'setskip':
        if (num(row.useskip, 0) > 0) this.skip = { tag: num(row.jumptag, 0), closeWnd: num(row.closewnd, 1) > 0, closeSprite: num(row.closesprite, 1) > 0 };
        else this.skip = null;
        return advance();
      case 'gameplay':
        this.doGameplay(row);
        return advance();
      case 'playsound': // <playsound sound="57" volume="1"/>
        if (row.sound) this.host.playSound(row.sound, num(row.volume, 1));
        return advance();
      case 'playmusic': // <playmusic music="battlemusic01" restart="1" volume="1"/>
        if (row.music) this.host.playMusic(row.music, num(row.volume, 1), num(row.restart, 0) !== 0);
        return advance();
      case 'goto':
        if (this.condition(row.formula ?? '')) {
          if (row.jumptag !== undefined) {
            const t = this.tags.get(+row.jumptag);
            if (t !== undefined) {
              this.pc = t;
              this.begun = false;
              return true;
            }
          } else if (row.jumprow !== undefined) {
            this.pc += Math.max(1, parseInt(row.jumprow, 10));
            this.begun = false;
            return true;
          }
        }
        return advance();
      case 'trigger':
        // suspend: the player plays on until the condition holds (the row resumes the story itself)
        this.mode = 'suspended';
        this.textVisible = row.showtext === 'no' ? false : this.textVisible;
        if (row.showtext === 'no') this.text = null;
        return false;
      case 'wait':
        return this.doWait(row, dt);
      case 'text':
        return this.doText(row, dt);
      default:
        return advance();
    }
  }

  // ------------------------------------------------------------------ rows
  private doActor(row: StoryRow): void {
    let a = this.actors.get(row.name);
    if (!a) {
      a = {
        name: row.name,
        srcType: row.src_type ?? '',
        srcValue: row.src_value ?? '',
        x: 0,
        y: 0,
        alignY: null,
        layer: 'front',
        alpha: 1,
        color: [1, 1, 1, 1],
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      };
      this.actors.set(row.name, a);
    }
    if (row.src_type) a.srcType = row.src_type;
    if (row.src_value) a.srcValue = row.src_value;
    if (row.xpos !== undefined) a.x = num(row.xpos, a.x);
    if (row.ypos !== undefined) a.y = num(row.ypos, a.y);
    if (row.aligny !== undefined) a.alignY = num(row.aligny, 0);
    if (row.layer) a.layer = (['back', 'center', 'front'].includes(row.layer.toLowerCase()) ? row.layer.toLowerCase() : 'front') as Actor['layer'];
    if (row.alpha !== undefined) a.alpha = num(row.alpha, 1);
    if (row.color) {
      const c = row.color.split(/\s+/).map((v) => num(v, 1));
      a.color = [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1];
    }
    if (row.scalex !== undefined) a.scaleX = num(row.scalex, 1);
    if (row.scaley !== undefined) a.scaleY = num(row.scaley, 1);
    if (row.rotation !== undefined) a.rotation = num(row.rotation, 0);
    if (row.width !== undefined) a.width = num(row.width, 0);
    if (row.height !== undefined) a.height = num(row.height, 0);
  }

  private doFade(row: StoryRow): void {
    const a = this.actors.get(row.name);
    if (!a) return;
    if (row.from !== undefined) a.alpha = num(row.from, a.alpha);
    const ease: Ease = (row.ease_type ?? '').toLowerCase() === 'fadein' ? 'in' : 'out';
    this.tweens = this.tweens.filter((t) => !(t.actor === a && t.prop === 'alpha'));
    this.tweens.push({ actor: a, prop: 'alpha', t: 0, dur: Math.max(0.001, num(row.duration, 1)), ease, from: a.alpha, to: num(row.to, 1), x0: 0, y0: 0, dx: 0, dy: 0 });
  }

  /** `endpos` is a delta, `movement` is "ease, seconds" (the original adds it to the current position). */
  private doMove(row: StoryRow): void {
    const a = this.actors.get(row.name);
    if (!a) return;
    const [kind, secs] = (row.movement ?? 'linear, 1').split(',').map((s) => s.trim().toLowerCase());
    const [dx, dy] = (row.endpos ?? '0,0').split(',').map((s) => num(s.trim(), 0));
    const ease: Ease = kind === 'easein' ? 'in' : kind === 'easeout' ? 'out' : 'linear';
    this.tweens = this.tweens.filter((t) => !(t.actor === a && t.prop === 'pos'));
    // y deltas follow the sign convention of the actor's own y (original Futile y-up space)
    this.tweens.push({ actor: a, prop: 'pos', t: 0, dur: Math.max(0.001, num(secs, 1)), ease, from: 0, to: 0, x0: a.x, y0: a.y, dx, dy });
  }

  private doGameplay(row: StoryRow): void {
    const [name, ...args] = (row.action ?? '').split(',').map((s) => s.trim());
    switch (name.toLowerCase()) {
      case 'setspritetolayer': {
        // the original builds a NEW sprite from the actor's image (alpha 1, rotation 0) parked off-screen at (-300,-300)
        const src = this.actors.get(args[0]);
        if (src) {
          this.layerSprites.set(args[0], {
            name: args[0], srcType: src.srcType, srcValue: src.srcValue, x: -300, y: -300, alignY: null, layer: 'front',
            alpha: 1, color: [1, 1, 1, 1], scaleX: 1, scaleY: 1, rotation: 0,
          });
        }
        break;
      }
      case 'removespritefromlayer':
        this.layerSprites.delete(args[0]);
        break;
      case 'dssprite': {
        // dssprite,<name>,<property>,<value>: set one property of a battle-layer sprite
        const a = this.layerSprites.get(args[0]);
        const v = parseFloat(args[2]);
        if (a && Number.isFinite(v)) {
          const prop = (args[1] ?? '').toLowerCase();
          if (prop === 'rotation') a.rotation = v;
          else if (prop === 'x') a.x = v;
          else if (prop === 'y') a.y = v;
          else if (prop === 'alpha') a.alpha = v;
          else if (prop === 'scale') a.scaleX = a.scaleY = v;
          else if (prop === 'scalex') a.scaleX = v;
          else if (prop === 'scaley') a.scaleY = v;
        }
        break;
      }
      case 'removeallintoplayer':
        this.actors.clear();
        this.tweens = [];
        this.text = null;
        this.textVisible = false;
        break;
      case 'showteamlayer': // UI visibility and game-state jumps have no equivalent in this flow
      case 'jumpgamestate':
        break;
      default:
        this.forwarded.push(name.toLowerCase());
        this.host.gameplay(name.toLowerCase(), args);
    }
  }

  private doWait(row: StoryRow, dt: number): boolean {
    if (!this.begun) {
      this.begun = true;
      this.waitUntil = this.clock + num(row.duration, 0);
      this.waitMin = row.minwait !== undefined ? this.clock + num(row.minwait, 0) : -1;
      if (row.showtext === 'no') {
        this.textVisible = false;
        this.text = null;
      }
    }
    void dt;
    if (this.tapQueued && this.waitMin >= 0 && this.clock >= this.waitMin) this.waitUntil = 0; // a tap cuts the wait short
    if (this.clock >= this.waitUntil) {
      this.pc++;
      this.begun = false;
      return true;
    }
    return false;
  }

  private doText(row: StoryRow, dt: number): boolean {
    if (!this.begun) {
      this.begun = true;
      this.textClock = 0;
      this.text = {
        full: row.id ?? '',
        shown: 0,
        done: false,
        wait: row.wait === 'finished' ? 'finished' : 'user',
        skippable: row.skippable === 'true',
        sfx: row.sfx ?? null,
        one: row.onesfx ?? null,
        hideActors: row.showactor === 'no',
      };
      this.textVisible = true;
      this.tapQueued = false; // the tap that ended the previous line must not also skip this one
    }
    const t = this.text!;
    if (!t.done) {
      if (this.tapQueued && t.skippable) {
        t.shown = t.full.length;
        t.done = true;
        this.tapQueued = false;
        return t.wait === 'finished' ? this.endText() : false;
      }
      const rate = Math.max(0.001, num(row.rate, 0.03));
      const spread = Math.max(1, Math.trunc(num(row.spread, 4)));
      this.textClock += dt;
      while (this.textClock >= rate && !t.done) {
        this.textClock -= rate;
        if (t.shown === 0 && t.one) this.host.playSound(t.one, 1);
        t.shown = Math.min(t.full.length, t.shown + spread);
        if (t.shown >= t.full.length) t.done = true;
        else if (t.sfx) this.host.beep(t.sfx, 0.5); // a quiet blip per step, none on the last (as the original)
      }
      if (t.done && t.wait === 'finished') return this.endText();
      return false;
    }
    if (t.wait === 'finished') return this.endText();
    if (this.tapQueued) {
      this.tapQueued = false;
      return this.endText();
    }
    return false;
  }

  private endText(): boolean {
    this.pc++;
    this.begun = false;
    return true;
  }

  // ------------------------------------------------------------------ tweens
  private updateTweens(dt: number): void {
    for (const tw of this.tweens) {
      tw.t = Math.min(tw.dur, tw.t + dt);
      const k = easeFn(tw.ease, tw.t / tw.dur);
      if (tw.prop === 'alpha') tw.actor.alpha = tw.from + (tw.to - tw.from) * k;
      else {
        tw.actor.x = tw.x0 + tw.dx * k;
        tw.actor.y = tw.y0 + tw.dy * k;
      }
    }
    this.tweens = this.tweens.filter((t) => t.t < t.dur);
  }

  /** Called when the level is won: remaining triggers fire so any outro dialogue plays. */
  markVictory(): void {
    this.victory = true;
  }
}
