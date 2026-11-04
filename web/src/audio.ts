// Sound: small synthesized effects for the game itself, plus real recorded samples and music for story cues.
let ctx: AudioContext | null = null;
let muted = false;
// Volume steps 0-10 as in the original's option bars; the default of 7 plays everything at its authored loudness.
const DEFAULT_STEP = 7;
let sfxMul = 1;
let musicMul = 1;
let musicBase = 1; // the volume the current track was started with

/** Apply the options' volume bars (0-10). Music already playing follows at once. */
export function setVolumes(musicStep: number, sfxStep: number): void {
  musicMul = Math.max(0, Math.min(10, musicStep)) / DEFAULT_STEP;
  sfxMul = Math.max(0, Math.min(10, sfxStep)) / DEFAULT_STEP;
  if (music) music.volume = Math.max(0, Math.min(1, musicBase * MUSIC_GAIN * musicMul));
}

export const volumeFactors = (): { music: number; sfx: number } => ({ music: musicMul, sfx: sfxMul });

export function setMuted(m: boolean): void {
  muted = m;
  if (music) music.muted = m;
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.08, slideTo?: number, delay = 0): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol * sfxMul, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export type Sfx = 'blipLow' | 'blipHigh' | 'pick' | 'swap' | 'match' | 'combo' | 'hit' | 'kill' | 'hurt' | 'heal' | 'wave' | 'tick' | 'timeout' | 'win' | 'lose';

export function sfx(name: Sfx, n = 1): void {
  switch (name) {
    case 'blipLow': return tone(210 + Math.random() * 30, 0.04, 'square', 0.02);
    case 'blipHigh': return tone(430 + Math.random() * 40, 0.04, 'square', 0.02);
    case 'pick': return tone(520, 0.08, 'triangle', 0.06);
    case 'swap': return tone(300, 0.05, 'square', 0.025);
    case 'match': return tone(660, 0.14, 'triangle', 0.07, 880);
    case 'combo': return tone(520 + Math.min(n, 12) * 55, 0.18, 'triangle', 0.08, 1100 + n * 40);
    case 'hit': return tone(180, 0.18, 'sawtooth', 0.07, 70);
    case 'kill': return tone(300, 0.35, 'sawtooth', 0.06, 40);
    case 'hurt': return tone(120, 0.3, 'square', 0.09, 50);
    case 'heal': return [0, 0.08, 0.16].forEach((d, i) => tone(520 * [1, 1.25, 1.5][i], 0.18, 'sine', 0.06, undefined, d));
    case 'wave': return tone(220, 0.4, 'triangle', 0.07, 440);
    case 'tick': return tone(900, 0.04, 'square', 0.03);
    case 'timeout': return tone(200, 0.2, 'square', 0.06, 100);
    case 'win': return [0, 0.12, 0.24, 0.4].forEach((d, i) => tone([523, 659, 784, 1047][i], 0.3, 'triangle', 0.08, undefined, d));
    case 'lose': return [0, 0.2, 0.4].forEach((d, i) => tone([392, 330, 262][i], 0.4, 'sawtooth', 0.06, undefined, d));
  }
}

// ------------------------------------------------------------------ recorded samples (story cues, typing beeps)
interface AudioIndex {
  sfx: Record<string, { file: string; name: string }>;
  music: Record<string, string>;
}

let index: AudioIndex | null = null;
let indexPromise: Promise<AudioIndex> | null = null;

/** The list of exported sound files and music tracks (data/audio.json), fetched once. */
export function loadAudioIndex(): Promise<AudioIndex> {
  indexPromise ??= fetch('data/audio.json')
    .then((r) => r.json() as Promise<AudioIndex>)
    .catch(() => ({ sfx: {}, music: {} }))
    .then((j) => (index = j));
  return indexPromise;
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();

function sample(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = (async () => {
      const a = ac();
      if (!a) return null;
      try {
        const res = await fetch(url);
        return await a.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    })();
    buffers.set(url, p);
  }
  return p;
}

/** Play a sound from the original sound table by id (e.g. 57 = the TARDIS) at a volume from 0 to 1. */
export function playSoundId(id: string | number, volume = 1): void {
  if (muted) return;
  const entry = index?.sfx[String(id)];
  if (!entry) return;
  void sample(entry.file).then((buf) => {
    const a = ac();
    if (!buf || !a) return;
    const src = a.createBufferSource();
    const g = a.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume * sfxMul));
    src.buffer = buf;
    src.connect(g).connect(a.destination);
    src.start();
  });
}

/** Typing beeps from the original (RunText): low 25, mid 26, high 27; anything else falls back to mid. */
export function beepId(name: string): number {
  return ({ chatbeeplow: 25, chatbeepmid: 26, chatbeephigh: 27 } as Record<string, number>)[name] ?? 26;
}

// ------------------------------------------------------------------ music
const MUSIC_GAIN = 0.55; // the recordings are loud next to the effects
let music: HTMLAudioElement | null = null;
let musicName = '';

/**
 * Loop a music track by name (battlemusic01-03). Like the original's PlayMusicResource: if the same track is already
 * playing it only restarts when `restart` is true.
 */
export function playMusic(name: string, volume = 1, restart = true): void {
  const file = index?.music[name];
  if (!file) return;
  try {
    if (music && musicName === name) {
      musicBase = volume;
      music.volume = Math.max(0, Math.min(1, volume * MUSIC_GAIN * musicMul));
      if (restart) music.currentTime = 0;
      startWhenAllowed(music);
      return;
    }
    music?.pause();
    music = new Audio(file);
    musicName = name;
    music.loop = true;
    music.muted = muted;
    musicBase = volume;
    music.volume = Math.max(0, Math.min(1, volume * MUSIC_GAIN * musicMul));
    startWhenAllowed(music);
  } catch {
    /* no audio available */
  }
}

/** Browsers block sound until the first tap; if play() is refused, retry on the next pointer press. */
function startWhenAllowed(el: HTMLAudioElement): void {
  el.play().catch(() => {
    const retry = () => {
      if (music === el) void el.play().catch(() => undefined);
    };
    document.addEventListener('pointerdown', retry, { once: true });
  });
}

export function stopMusic(): void {
  music?.pause();
  music = null;
  musicName = '';
}

/** What the original's ChooseRandomInGameMusic picks from. */
export function randomBattleMusic(): string {
  const names = Object.keys(index?.music ?? {}).filter((n) => n.startsWith('battlemusic'));
  return names.length ? names[Math.floor(Math.random() * names.length)] : '';
}
