import { DATA, GEM_CSS, GEM_NAMES, POINT_VALUE, buildGrids, buildSpawnDefs, buildWaves, flowSeasons, gemSkins, gemWeights, levelTitle, unitIcon, unitMaxLevel, type UnitDef } from './data.ts';
import { CRYSTAL, SAVE, TEAM_SIZE, addItem, addXp, exportSave, grantUnit, importSave, persist, resetSave, xpToNext } from './save.ts';
import { TUTORIAL_LEVEL, effectiveLevel, evoStatus, evolve, maxLevelNow, resetPoints, spendPoint, teamStats, tutorialTeamStats, unitStatsFor, type Stat } from './progression.ts';
import { BattleView, type BattleOutcome } from './ui/battleView.ts';
import { loadAudioIndex, playMusic, setMuted, setVolumes, sfx } from './audio.ts';
import { latestNewsId, newsItems } from './news.ts';
import { activeOtb, otbDropPoints, otbFx, otbSummary, settleOtb } from './otb.ts';
import { claimDaily, dailyStatus } from './daily.ts';
import { activePerks, chooseSkill, chosenSkill, groupUnlocked, perkTypes, seasonFor, starCount, typeUnlocked, unlockGroup } from './perkbook.ts';
import { ownedSuits, wearSuit, wornSuit } from './wardrobe.ts';
import { OUTFIT_ALLIES_NEEDED, allyCount, availableSets, claimSet, rollSeason, rollableSeasons, seasonPool } from './tardis.ts';
import { receiveGift, recordVictory, refreshDropBonus, rollEnemyDrop, type Gift } from './drops.ts';
import type { StoryRow } from './story.ts';
import type { PresetBoard } from './engine/battle.ts';

const app = () => document.getElementById('app')!;
let view: BattleView | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function mount(node: HTMLElement, battle = false): void {
  if (view) {
    view.destroy();
    view = null;
  }
  const a = app();
  a.className = battle ? 'battle' : '';
  a.replaceChildren(node);
  // menus play the main-menu track; the same track is not restarted from screen to screen (a battle starts its own)
  if (!battle) void loadAudioIndex().then(() => playMusic('mainmenu', 1, false));
}

function pips(u: UnitDef): string {
  return `<span class="pips">${u.a.map((c) => `<i class="pip" style="background:${GEM_CSS[c]}"></i>`).join('')}</span>`;
}

function unitImg(u: UnitDef): string {
  const src = unitIcon(u, true, wornSuit(u.id));
  return src ? `<img src="${src}" alt="" loading="lazy">` : '';
}

/** Colour fragments have no art of their own; they get a coloured dot (red, yellow, pink, black, green, blue). */
const FRAGMENT_COLOR: Record<number, string> = { 37: '#e5484d', 38: '#f5d90a', 39: '#ff7ac6', 40: '#6b6b78', 41: '#30a46c', 42: '#3e7bfa' };

function itemIcon(id: number): string {
  const it = DATA.items[String(id)];
  if (it?.icon) return `<img class="itemicon" src="${it.icon}" alt="" loading="lazy">`;
  return `<i class="itemicon dot" style="background:${FRAGMENT_COLOR[id] ?? '#8fa0c4'}"></i>`;
}

/** Inventory bar: Time Crystals first, then every fragment the player holds. */
function itemBar(): string {
  const ids = Object.keys(SAVE.items).map(Number).filter((i) => SAVE.items[i] > 0).sort((a, b) => (a === CRYSTAL ? -1 : b === CRYSTAL ? 1 : a - b));
  if (!ids.length) return '<div class="sub">No items yet. Time Fragments and Time Crystals drop in missions.</div>';
  return `<div class="items">${ids
    .map((i) => `<span class="chip" title="${esc(DATA.items[String(i)]?.n ?? String(i))}">${itemIcon(i)}<b>${SAVE.items[i]}</b></span>`)
    .join('')}</div>`;
}

/** The One Turn Buff waiting for the next battle (original: shown in the mission list). */
function otbPanel(): string {
  const o = activeOtb();
  if (!o) return '';
  return `<div class="panel otb"><img src="${o.img ?? ''}" alt=""><div><b>One Turn Buff: ${esc(otbSummary(o))}</b><div class="sub">${esc(o.desc.replace(/^OTB\s*:\s*/, ''))} It lasts your next battle.</div></div></div>`;
}

// ------------------------------------------------------------------ title
export function showTitle(): void {
  const s = el('div', 'screen center');
  s.innerHTML = `
    <div>
      <h1>Doctor Who: Legacy</h1>
      <div class="sub">Preservation port · unofficial · for personal play</div>
    </div>
    <div class="menu">
      <button class="primary big" id="play">Play</button>
      <button class="big" id="team">Team</button>
      <button class="big" id="perks">Perks</button>
      <button class="big" id="tardis">Tardis</button>
      <button class="big" id="news">News${SAVE.settings.newsSeen < latestNewsId() ? ' <span class="dot-new">!</span>' : ''}</button>
      <button class="big" id="daily">Daily bonus${dailyStatus().canClaim ? ' <span class="dot-new">!</span>' : ''}</button>
      <button class="big" id="opts">Options</button>
    </div>
    <div class="sub" style="margin-top:24px">Drag a gem around the board to line up three or more. Match your team's colours to attack, pink to heal.</div>`;
  mount(s);
  s.querySelector('#play')!.addEventListener('click', () => { sfx('tick'); showLevels(); });
  s.querySelector('#team')!.addEventListener('click', () => { sfx('tick'); showTeam(); });
  s.querySelector('#opts')!.addEventListener('click', () => { sfx('tick'); showOptions(); });
  s.querySelector('#news')!.addEventListener('click', () => { sfx('tick'); showNews(); });
  s.querySelector('#tardis')!.addEventListener('click', () => { sfx('tick'); showTardis(); });
  s.querySelector('#perks')!.addEventListener('click', () => { sfx('tick'); showPerks(); });
  s.querySelector('#daily')!.addEventListener('click', () => { sfx('tick'); openDaily(s); });
  if (!dailyOffered && dailyStatus().canClaim) {
    dailyOffered = true;
    openDaily(s);
  }
}

// ------------------------------------------------------------------ daily bonus
let dailyOffered = false; // the bonus pops up once per visit; the Daily bonus button reopens it

function openDaily(host: HTMLElement): void {
  const st = dailyStatus();
  const box = el('div', 'modal');
  const tiles = st.rewards
    .map((r) => {
      const done = st.canClaim ? r.day < st.day : r.day <= st.day;
      const today = r.day === st.day;
      return `<div class="day ${done ? 'done' : ''} ${today ? 'today' : ''}"><small>Day ${r.day}</small>${itemIcon(r.item_id)}<b>×${r.count}</b><small>${esc(DATA.items[String(r.item_id)]?.n ?? '')}</small></div>`;
    })
    .join('');
  const today = st.rewards.find((r) => r.day === st.day);
  box.innerHTML = `
    <div class="panel dialog">
      <h2>Daily bonus</h2>
      <div class="sub">Log in on consecutive days for bigger rewards. Miss a day and the streak starts again.</div>
      <div class="days">${tiles}</div>
      ${st.canClaim && today ? `<button class="primary big" id="claim">Claim day ${today.day}: ${today.count} × ${esc(DATA.items[String(today.item_id)]?.n ?? '')}</button>` : '<div class="sub">The bonus for today is already claimed. Come back tomorrow!</div>'}
      <button id="close">Close</button>
    </div>`;
  host.appendChild(box);
  box.querySelector('#close')!.addEventListener('click', () => box.remove());
  box.querySelector('#claim')?.addEventListener('click', () => {
    if (claimDaily()) { sfx('win'); persist(); }
    box.remove();
    showTitle();
    openDaily(app().firstElementChild as HTMLElement);
  });
}

// ------------------------------------------------------------------ perks
function showPerks(typeId = 0, note = ''): void {
  const types = perkTypes();
  const type = types.find((t) => t.id === typeId) ?? types[0];
  const stars = starCount();
  const open = typeUnlocked(type.id);
  const s = el('div', 'screen');
  const tabs = types
    .map((t) => `<button class="tab ${t.id === type.id ? 'sel' : ''}" data-type="${t.id}">${esc(t.n)}${typeUnlocked(t.id) ? '' : ' 🔒'}</button>`)
    .join('');
  const groups = type.groups
    .map((g) => {
      const unlocked = groupUnlocked(type.id, g.id);
      const chosen = chosenSkill(type.id, g.id);
      const need = g.star - stars;
      const status = unlocked
        ? '<span class="okt">Unlocked</span>'
        : g.star !== 0
          ? `<span class="not">Locked · ${need} more star${need === 1 ? '' : 's'} (needs ${g.star})</span>`
          : '<span class="not">Locked</span>';
      const skills = g.skills
        .map((k) => {
          const img = k.img ? `<img src="${k.img}" alt="">` : '<i class="blank"></i>';
          return `<button class="skill ${k.id === chosen ? 'sel' : ''}" data-group="${g.id}" data-skill="${k.id}" ${unlocked && open ? '' : 'disabled'}>${img}<span><b>${esc(k.n)}</b>${k.id === 0 ? '' : `<small>${esc(k.d)}</small>`}</span></button>`;
        })
        .join('');
      const buy = !unlocked && g.cry > 0 ? `<button class="primary" data-buy="${g.id}">Unlock · ${itemIcon(CRYSTAL)} ${g.cry} (free)</button>` : '';
      return `<div class="panel perkgroup"><div class="row sp"><b>${esc(g.n)}</b>${status}</div><div class="skills">${skills}</div>${buy}</div>`;
    })
    .join('');
  s.innerHTML = `
    <div class="row sp"><h2>Perks</h2><button id="back">Back</button></div>
    <div class="sub">★ <b>${stars}</b> stars (the combined rank of every unit you own). Pick one perk in each unlocked group; they apply in every mission.</div>
    <div class="tabs">${tabs}</div>
    ${open ? '' : `<div class="panel note">Finish every mission of ${esc(seasonFor(type.id))} to open this tab.</div>`}
    ${note ? `<div class="panel note">${esc(note)}</div>` : ''}
    <div class="scroll">${groups}</div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', showTitle);
  s.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.addEventListener('click', () => { sfx('tick'); showPerks(Number(b.dataset.type)); }));
  s.querySelectorAll<HTMLElement>('.skill').forEach((b) =>
    b.addEventListener('click', () => {
      if (chooseSkill(type.id, Number(b.dataset.group), Number(b.dataset.skill))) { sfx('tick'); persist(); showPerks(type.id); }
    }),
  );
  s.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
    b.addEventListener('click', () => {
      if (unlockGroup(type.id, Number(b.dataset.buy))) { sfx('heal'); persist(); showPerks(type.id, 'Unlocked. Purchases are approved automatically.'); }
    }),
  );
}

// ------------------------------------------------------------------ Tardis (season rolls and purchase sets)
function giftCard(g: Gift): string {
  if (g.kind === 'unit') {
    const u = DATA.units[String(g.id)];
    return `<span class="drop">${unitImg(u)}<span>${esc(u.n)}</span></span>`;
  }
  if (g.kind === 'suit') {
    const su = DATA.suits[String(g.id)];
    return `<span class="drop"><img class="suitimg" src="${su.img}" alt=""><span>${esc(su.n.replace(/_/g, ' '))}</span></span>`;
  }
  return `<span class="drop">${itemIcon(g.id)}<span>${esc(DATA.items[String(g.id)]?.n ?? '')}</span></span>`;
}

function giftName(g: Gift): string {
  if (g.kind === 'unit') return DATA.units[String(g.id)].n;
  if (g.kind === 'suit') return DATA.suits[String(g.id)].n.replace(/_/g, ' ');
  return DATA.items[String(g.id)]?.n ?? '';
}

function showTardis(tab: 'roll' | 'sets' = 'roll', result = '', note = ''): void {
  const s = el('div', 'screen');
  const tabs = `<div class="tabs">
    <button class="tab ${tab === 'roll' ? 'sel' : ''}" data-tab="roll">Roll</button>
    <button class="tab ${tab === 'sets' ? 'sel' : ''}" data-tab="sets">Sets</button></div>`;
  let body = '';
  if (tab === 'roll') {
    const allies = allyCount();
    const seasons = rollableSeasons()
      .map((se, i) => {
        const pool = seasonPool(se);
        const units = pool.filter((e) => e.gift.kind === 'unit').length;
        const suits = pool.filter((e) => e.gift.kind === 'suit').length;
        return `<div class="panel">
          <b>${esc(se.n)}</b>
          <div class="sub">${units} character${units === 1 ? '' : 's'} and ${suits} outfit${suits === 1 ? '' : 's'} still to win. Each roll is free.</div>
          <button class="primary big" data-roll="${i}" ${pool.length ? '' : 'disabled'}>Roll</button>
        </div>`;
      })
      .join('');
    body = `${seasons || '<div class="sub">Nothing to roll.</div>'}
      <div class="sub">Outfits join the roll once you have ${OUTFIT_ALLIES_NEEDED} allies (you have ${allies}). Characters you already have never come up again.</div>`;
  } else {
    const sets = availableSets();
    body = sets.length
      ? `<div class="sub">${sets.length} set${sets.length === 1 ? '' : 's'} with something you do not have yet. Getting one is free.</div><div class="sets">${sets
          .map(
            (st) => `<div class="panel setrow">
              <div class="row sp"><b>${esc(st.def.n)}</b><span class="sub">${st.have}/${st.total} owned</span></div>
              <div class="setitems">${st.gifts.map((x) => `<span class="${x.have ? 'got' : ''}">${giftCard(x.gift)}</span>`).join('')}</div>
              <button class="primary" data-set="${st.def.id}">Get</button>
            </div>`,
          )
          .join('')}</div>`
      : '<div class="sub">You already own everything in the sets.</div>';
  }
  s.innerHTML = `
    <div class="row sp"><h2>Tardis</h2><button id="back">Back</button></div>
    ${tabs}
    ${note ? `<div class="panel note">${esc(note)}</div>` : ''}
    ${result ? `<div class="panel rolled">${result}</div>` : ''}
    <div class="scroll">${body}</div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', showTitle);
  s.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.addEventListener('click', () => { sfx('tick'); showTardis(b.dataset.tab as 'roll' | 'sets'); }));
  s.querySelectorAll<HTMLElement>('[data-roll]').forEach((b) =>
    b.addEventListener('click', () => {
      const se = rollableSeasons()[Number(b.dataset.roll)];
      const r = rollSeason(se.bind, Math.random);
      if (!r.ok) return showTardis('roll', '', 'There is nothing left to win here.');
      sfx('win');
      persist();
      const g = r.gift;
      const extra = g.kind === 'suit'
        ? `Can be worn by ${Object.values(DATA.units).filter((u) => SAVE.owned[u.id] && (u.suit === g.id || u.ss.includes(g.id))).slice(0, 4).map((u) => u.n).join(', ')}.`
        : 'Added to your team roster.';
      showTardis('roll', `<div class="row">${giftCard(g)}<div><b>New ${g.kind === 'suit' ? 'outfit' : 'ally'}: ${esc(giftName(g))}</b><div class="sub">${esc(extra)}</div></div></div>`);
    }),
  );
  s.querySelectorAll<HTMLElement>('[data-set]').forEach((b) =>
    b.addEventListener('click', () => {
      const got = claimSet(Number(b.dataset.set));
      if (!got.length) return showTardis('sets', '', 'Nothing in that set could be added.');
      sfx('win');
      persist();
      showTardis('sets', '', `Received: ${got.map(giftName).join(', ')}.`);
    }),
  );
}

// ------------------------------------------------------------------ news
function showNews(): void {
  const items = newsItems();
  SAVE.settings.newsSeen = latestNewsId();
  persist();
  const s = el('div', 'screen');
  s.innerHTML = `
    <div class="row sp"><h2>News</h2><button id="back">Back</button></div>
    <div class="scroll">${items
      .map((n) => `<div class="panel newsitem"><div class="row sp"><b>${esc(n.title)}</b><span class="sub">${esc(n.date)}</span></div><div class="newsbody">${esc(n.body)}</div></div>`)
      .join('')}</div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', showTitle);
}

// ------------------------------------------------------------------ credits
async function showCredits(): Promise<void> {
  const s = el('div', 'screen');
  s.innerHTML = `
    <div class="row sp"><h2>Credits</h2><button id="back">Back</button></div>
    <div class="credits scroll" id="cr"><div class="crpad"></div><div id="crtext"></div><div class="crpad"></div></div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', () => showOptions('app'));
  let text: string;
  try {
    text = await (await fetch('data/credits.txt')).text();
  } catch {
    text = 'The credits could not be loaded.';
  }
  const box = s.querySelector<HTMLElement>('#cr')!;
  s.querySelector('#crtext')!.innerHTML = text
    .split(/\r?\n/)
    .map((l, i) => (l.trim() ? `<div class="crline${i === 0 ? ' crtitle' : ''}">${esc(l)}</div>` : '<div class="crgap"></div>'))
    .join('');
  // The credits roll on their own (the original scrolled them at 80 px/s); touching or wheeling takes over for a moment.
  let pos = 0;
  let hold = 0;
  let last = performance.now();
  const stop = () => (hold = performance.now() + 3000);
  box.addEventListener('wheel', stop, { passive: true });
  box.addEventListener('pointerdown', stop);
  box.addEventListener('touchmove', stop, { passive: true });
  const tick = (now: number) => {
    if (!s.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (Math.abs(box.scrollTop - pos) > 2) {
      pos = box.scrollTop; // the player scrolled
      stop();
    }
    if (now >= hold) {
      pos += 60 * dt;
      if (pos >= box.scrollHeight - box.clientHeight) {
        pos = 0;
        hold = now + 1500;
      }
      box.scrollTop = pos;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ options
const VOL_BAR = (n: number) => '▮'.repeat(n) + '▯'.repeat(10 - n);

function showOptions(tab: 'settings' | 'app' = 'settings', note = ''): void {
  const s = el('div', 'screen');
  const st = SAVE.settings;
  const tabs = `<div class="tabs">
    <button class="tab ${tab === 'settings' ? 'sel' : ''}" data-tab="settings">Settings</button>
    <button class="tab ${tab === 'app' ? 'sel' : ''}" data-tab="app">App info</button></div>`;
  let body: string;
  if (tab === 'settings') {
    const skin = DATA.gemSkins[st.gemSkin] ?? DATA.gemSkins[0];
    const gems = skin && skin.gems.length ? skin.gems : [1, 2, 3, 4, 5, 6];
    const vol = (key: 'music' | 'sfx', label: string) => `
      <div class="row sp optrow"><b>${label}</b>
        <span class="stepper"><button data-vol="${key}" data-d="-1" ${st[key] <= 0 ? 'disabled' : ''}>−</button><span class="bars">${VOL_BAR(st[key])}</span><button data-vol="${key}" data-d="1" ${st[key] >= 10 ? 'disabled' : ''}>+</button></span>
      </div>`;
    body = `
      <div class="panel list">
        ${vol('music', 'Music')}
        ${vol('sfx', 'Effects')}
        <label class="chk"><input type="checkbox" id="mute" ${SAVE.muted ? 'checked' : ''}> Mute sound</label>
      </div>
      <div class="panel">
        <div class="row sp optrow"><b>Gem look</b>
          <span class="stepper"><button id="skinprev">◀</button><button id="skinnext">▶</button></span></div>
        <div class="gemlook">${gems.map((g) => `<img src="img/gems/gem${g}.png" alt="">`).join('')}</div>
        <div class="sub">${esc(skin?.n ?? 'Default')} (${st.gemSkin + 1} of ${DATA.gemSkins.length}). Changes the art of the gems in battle.</div>
      </div>
      <div class="panel list">
        <label class="chk"><input type="checkbox" id="otb" ${st.otb ? 'checked' : ''}> One Turn Buff (a random bonus after each victory)</label>
        <label class="chk"><input type="checkbox" id="unlock" ${SAVE.unlockAll ? 'checked' : ''}> Unlock all levels (skip progression)</label>
      </div>`;
  } else {
    body = `
      <div class="panel list">
        <div>Doctor Who: Legacy 3.5.2 · unofficial web port</div>
        <div>Units owned: <b>${Object.keys(SAVE.owned).length}</b> · Levels cleared: <b>${Object.keys(SAVE.cleared).length}</b> · Outfits won: <b>${SAVE.suits.length}</b></div>
        <div class="sub">Progress is stored in this browser only. Nothing is sent anywhere.</div>
      </div>
      <div class="panel list">
        <b>Save backup</b>
        <div class="sub">A backup file keeps your progress safe if the browser's data is cleared, and lets you move it to another device.</div>
        <div class="row"><button id="export">Save backup</button><button id="import">Load backup</button></div>
        <input type="file" id="file" accept=".json,application/json" hidden>
      </div>
      <div class="panel list">
        <div class="row"><button id="credits">Credits</button><button id="all">Add every unit (sandbox)</button><button id="reset">Reset progress</button></div>
      </div>`;
  }
  s.innerHTML = `
    <div class="row sp"><h2>Options</h2><button id="back">Back</button></div>
    ${tabs}
    ${note ? `<div class="panel note">${esc(note)}</div>` : ''}
    <div class="scroll">${body}</div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', showTitle);
  s.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.addEventListener('click', () => { sfx('tick'); showOptions(b.dataset.tab as 'settings' | 'app'); }));
  if (tab === 'settings') {
    s.querySelectorAll<HTMLElement>('[data-vol]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.vol as 'music' | 'sfx';
        st[key] = Math.max(0, Math.min(10, st[key] + Number(b.dataset.d)));
        setVolumes(st.music, st.sfx);
        persist();
        showOptions('settings');
        if (key === 'sfx') sfx('win'); // a sample at the new level
      }),
    );
    const skinStep = (d: number) => {
      const n = DATA.gemSkins.length;
      st.gemSkin = (st.gemSkin + d + n) % n;
      persist();
      showOptions('settings');
    };
    s.querySelector('#skinprev')!.addEventListener('click', () => skinStep(-1));
    s.querySelector('#skinnext')!.addEventListener('click', () => skinStep(1));
    s.querySelector<HTMLInputElement>('#mute')!.addEventListener('change', (e) => { SAVE.muted = (e.target as HTMLInputElement).checked; setMuted(SAVE.muted); persist(); });
    s.querySelector<HTMLInputElement>('#otb')!.addEventListener('change', (e) => { st.otb = (e.target as HTMLInputElement).checked; persist(); });
    s.querySelector<HTMLInputElement>('#unlock')!.addEventListener('change', (e) => { SAVE.unlockAll = (e.target as HTMLInputElement).checked; persist(); });
  } else {
    s.querySelector('#credits')!.addEventListener('click', () => void showCredits());
    s.querySelector('#export')!.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportSave()], { type: 'application/json' }));
      a.download = 'doctor-who-legacy-save.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const file = s.querySelector<HTMLInputElement>('#file')!;
    s.querySelector('#import')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const err = importSave(await f.text());
      if (err) return showOptions('app', err);
      setMuted(SAVE.muted);
      setVolumes(SAVE.settings.music, SAVE.settings.sfx);
      showOptions('app', 'Backup loaded.');
    });
    s.querySelector('#all')!.addEventListener('click', () => {
      for (const u of Object.values(DATA.units)) if (u.lp.length) grantUnit(u.id);
      persist();
      showOptions('app');
    });
    s.querySelector('#reset')!.addEventListener('click', () => {
      if (confirm('Erase all progress?')) { resetSave(); setVolumes(SAVE.settings.music, SAVE.settings.sfx); showTitle(); }
    });
  }
}

// ------------------------------------------------------------------ levels
function showLevels(openSeason = -1): void {
  const seasons = flowSeasons();
  const s = el('div', 'screen');
  s.innerHTML = `<div class="row sp"><h2>Choose a mission</h2><button id="back">Back</button></div>${otbPanel()}<div class="scroll" id="list"></div>`;
  const list = s.querySelector('#list')!;

  // progression: a level is open when the previous playable level in its season has been cleared
  seasons.forEach((season, si) => {
    const d = el('details');
    const total = season.groups.reduce((n, g) => n + g.levels.length, 0);
    const done = season.groups.reduce((n, g) => n + g.levels.filter((l) => SAVE.cleared[l.id]).length, 0);
    d.innerHTML = `<summary>${esc(season.name)} <span class="sub">· ${done}/${total}</span></summary>`;
    if (openSeason === si || (openSeason < 0 && si === 0)) d.open = true;
    let prevCleared = true;
    for (const g of season.groups) {
      const gd = el('details');
      gd.innerHTML = `<summary>${esc(g.name)}</summary>`;
      const hasNext = g.levels.some((l) => !SAVE.cleared[l.id]);
      if (hasNext && prevCleared) gd.open = true;
      for (const l of g.levels) {
        const open = SAVE.unlockAll || prevCleared;
        const lv = DATA.levels[String(l.id)];
        const t = levelTitle(l.name);
        const b = el('button', 'lv' + (open ? '' : ' locked'));
        b.innerHTML = `<span class="tag">${esc(t.tag)}</span><span class="ttl">${esc(t.title)}</span><span class="sub">${lv.w.length}w</span><span class="ok">${SAVE.cleared[l.id] ? '✓' : ''}</span>`;
        b.disabled = !open;
        b.addEventListener('click', () => { sfx('tick'); showPrep(l.id, si); });
        gd.appendChild(b);
        prevCleared = !!SAVE.cleared[l.id];
      }
      d.appendChild(gd);
    }
    list.appendChild(d);
  });
  mount(s);
  s.querySelector('#back')!.addEventListener('click', showTitle);
}

// ------------------------------------------------------------------ team
function teamUnits(): UnitDef[] {
  return SAVE.team.map((id) => DATA.units[String(id)]).filter(Boolean);
}

function showTeam(): void {
  const s = el('div', 'screen');
  let sel = 0;
  const render = () => {
    const slots = Array.from({ length: TEAM_SIZE }, (_, i) => {
      const u = DATA.units[String(SAVE.team[i])];
      const lv = u ? effectiveLevel(u.id) : 0;
      return `<button class="slot ${i === sel ? 'sel' : ''}" data-i="${i}">${u ? unitImg(u) + pips(u) + `<span class="lvl">Lv ${lv}</span>` : '<span class="sub">empty</span>'}</button>`;
    }).join('');
    const stats = teamStats();
    const hp = stats.reduce((n, s) => n + s.hp, 0);
    const heal = stats.reduce((n, s) => n + s.heal, 0);
    const selId = SAVE.team[sel];
    const wantDoctor = sel === 0;
    const owned = Object.keys(SAVE.owned)
      .map((id) => DATA.units[id])
      .filter((u) => u && u.lp.length && (wantDoctor ? u.t === 1 : u.t === 2))
      .sort((a, b) => b.r - a.r || (SAVE.owned[b.id].lv - SAVE.owned[a.id].lv) || a.id - b.id);
    s.innerHTML = `
      <div class="row sp"><h2>Your team</h2><button id="back">Back</button></div>
      <div class="slots">${slots}</div>
      ${otbPanel()}
      <div class="row sp"><div class="sub">Team HP <b>${hp}</b> · Heal <b>${heal}</b> · Slot ${sel + 1}: ${wantDoctor ? 'Doctor' : 'Ally'}</div>
        <button id="manage" ${selId ? '' : 'disabled'}>Upgrade ${wantDoctor ? 'Doctor' : 'ally'}</button></div>
      ${itemBar()}
      <div class="scroll"><div class="grid">${owned
        .map((u) => {
          const o = SAVE.owned[u.id];
          const st = unitStatsFor(u.id, wantDoctor ? [u.id, ...SAVE.team.slice(1)] : SAVE.team)!;
          const lv = u.t === 1 ? st && effectiveLevel(u.id, [u.id, ...SAVE.team.slice(1)]) : o.lv;
          const badge = o.pts > 0 ? `<span class="pts">+${o.pts}</span>` : '';
          return `<button class="card ${SAVE.team.includes(u.id) ? 'used' : ''}" data-u="${u.id}"><div class="im">${unitImg(u)}${pips(u)}<span class="lvl">Lv ${lv}</span>${badge}</div><div class="nm">${esc(u.n)}<br><span class="sub">ATK ${st.atk} · HP ${st.hp}</span></div></button>`;
        })
        .join('')}</div></div>`;
    s.querySelector('#back')!.addEventListener('click', () => { persist(); showTitle(); });
    s.querySelector('#manage')?.addEventListener('click', () => { if (selId) showUnit(selId, 'team'); });
    s.querySelectorAll<HTMLElement>('.slot').forEach((b) => b.addEventListener('click', () => { sel = +b.dataset.i!; render(); }));
    s.querySelectorAll<HTMLElement>('.card').forEach((b) =>
      b.addEventListener('click', () => {
        const id = +b.dataset.u!;
        const at = SAVE.team.indexOf(id);
        if (at >= 0) SAVE.team.splice(at, 1);
        if (sel < SAVE.team.length && at !== sel) SAVE.team[sel] = id;
        else SAVE.team.splice(Math.min(sel, SAVE.team.length), 0, id);
        SAVE.team = SAVE.team.slice(0, TEAM_SIZE);
        persist();
        render();
      }),
    );
  };
  mount(s);
  render();
}

// ------------------------------------------------------------------ unit upgrade page
function showUnit(id: number, from: 'team', note = ''): void {
  const u = DATA.units[String(id)];
  const o = SAVE.owned[id];
  if (!u || !o) return showTeam();
  const s = el('div', 'screen');
  const isDoc = u.t === 1;
  const max = unitMaxLevel(u);
  const lv = effectiveLevel(id);
  const st = unitStatsFor(id)!;
  const evo = evoStatus(id)!;
  const stars = '★'.repeat(u.r);

  const statRow = (label: string, key: Stat, base: number, value: number) => `
    <div class="statrow"><span class="lab">${label}</span>
      <span class="val">${value}${o[key] ? ` <span class="sub">(${base} + ${o[key] * POINT_VALUE[key]})</span>` : ''}</span>
      ${isDoc ? '' : `<button class="plus" data-stat="${key}" ${o.pts > 0 ? '' : 'disabled'} title="+${POINT_VALUE[key]} per point">+</button>`}
    </div>`;
  const baseAt = (k: 'hp' | 'atk' | 'heal') => st[k] - (isDoc ? 0 : o[k] * POINT_VALUE[k]);

  const xpHtml = isDoc
    ? `<div class="sub">The Doctor's level is worked out from your allies: the higher their levels and ranks, the stronger the Doctor.</div>`
    : lv >= max
      ? `<div class="sub">Max level for this rank${evo.target ? ' — ready to evolve once you have the fragments.' : '.'}</div>`
      : `<div class="bar"><i style="width:${Math.min(100, (o.xp / xpToNext(u, o.lv)) * 100)}%"></i></div><div class="sub">XP ${o.xp} / ${xpToNext(u, o.lv)}</div>
         <button id="maxlv">Max level now · free</button>`;

  let evoHtml: string;
  if (!evo.target) {
    evoHtml = '<div class="sub">Fully evolved: this is the final rank.</div>';
  } else {
    const t = evo.target;
    const recipe = evo.items
      .map((i) => `<span class="need ${i.have >= i.need ? 'ok' : 'no'}">${itemIcon(i.id)}<b>${i.have}/${i.need}</b><small>${esc(DATA.items[String(i.id)]?.n ?? String(i.id))}</small></span>`)
      .join('');
    evoHtml = `
      <div class="row evo"><div class="evoimg">${unitImg(t)}</div>
        <div><b>${esc(t.n)}</b><div class="sub">${'★'.repeat(t.r)} · Lv ${t.il}–${unitMaxLevel(t)}</div></div></div>
      ${isDoc ? '' : `<div class="sub ${evo.levelOk ? 'okt' : 'not'}">${evo.levelOk ? '✓' : '✗'} Reach level ${max} (now ${o.lv})</div>`}
      <div class="recipe">${recipe || '<span class="sub">No fragments needed</span>'}</div>
      <div class="row">
        <button class="primary" id="evolve" ${evo.canEvolve ? '' : 'disabled'}>Evolve</button>
        <button id="instant" ${evo.canInstant ? '' : 'disabled'} title="Skip the fragments">Instant evolve · free</button>
      </div>`;
  }

  const spent = o.hp + o.atk + o.heal;
  const missing = u.ss.filter((x) => !ownedSuits(id).includes(x)).length;
  s.innerHTML = `
    <div class="row sp"><h2>${isDoc ? 'Doctor' : 'Ally'}</h2><button id="back">Back</button></div>
    <div class="scroll">
      <div class="panel unitpanel">
        <div class="portrait">${unitImg(u)}${pips(u)}</div>
        <div class="info"><b>${esc(u.n)}</b><div class="sub">${stars} · Lv ${lv} / ${max}</div>${xpHtml}</div>
      </div>
      ${note ? `<div class="panel note">${esc(note)}</div>` : ''}
      <div class="panel">
        <div class="row sp"><b>Stats</b>${isDoc ? '' : `<span class="sub">Attribute points: <b class="ptsval">${o.pts}</b></span>`}</div>
        ${statRow('HP', 'hp', baseAt('hp'), st.hp)}
        ${statRow('ATK', 'atk', baseAt('atk'), st.atk)}
        ${statRow('Heal', 'heal', baseAt('heal'), st.heal)}
        ${isDoc ? '' : `<div class="row sp"><span class="sub">Each level earns a point: HP +${POINT_VALUE.hp}, ATK +${POINT_VALUE.atk}, Heal +${POINT_VALUE.heal}.</span>
          <button id="reset" ${spent > 0 ? '' : 'disabled'}>Reset points · free</button></div>`}
      </div>
      ${u.ab.length ? `<div class="panel">${u.ab
        .slice(0, isDoc ? 2 : 1)
        .map((ab) => `<div class="abil"><b>Ability: ${esc(ab.n)}</b><div class="sub">${esc(ab.d)}</div><div class="sub">Charges in ${ab.cd} ${isDoc ? 'combos' : 'moves'}.</div></div>`)
        .join('')}${isDoc && u.ab.length > 1 ? '<div class="sub">Both charge together; tapping the Doctor uses the stronger one when it is ready, otherwise the first.</div>' : ''}</div>` : ''}
      <div class="panel"><b>Outfit</b><div class="suits">${ownedSuits(id)
        .map((sid) => `<button class="suit ${sid === wornSuit(id) ? 'sel' : ''}" data-suit="${sid}" title="${esc((DATA.suits[String(sid)]?.n ?? '').replace(/_/g, ' '))}"><img src="${DATA.suits[String(sid)]?.img ?? ''}" alt=""></button>`)
        .join('')}</div><div class="sub">${missing} more outfit${missing === 1 ? '' : 's'} to win in the Tardis.</div></div>
      <div class="panel"><b>Evolution</b>${evoHtml}</div>
    </div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', () => { persist(); showTeam(); });
  s.querySelectorAll<HTMLElement>('.plus').forEach((b) =>
    b.addEventListener('click', () => {
      if (spendPoint(id, b.dataset.stat as Stat)) { sfx('tick'); persist(); showUnit(id, from); }
    }),
  );
  s.querySelector('#maxlv')?.addEventListener('click', () => {
    const n = maxLevelNow(id);
    if (n) { sfx('win'); persist(); showUnit(id, from, `Reached max level: +${n} attribute point${n === 1 ? '' : 's'}.`); }
  });
  s.querySelector('#reset')?.addEventListener('click', () => {
    if (resetPoints(id)) { sfx('heal'); persist(); showUnit(id, from, 'Attribute points refunded.'); }
  });
  const doEvolve = (instant: boolean) => {
    const to = evolve(id, instant);
    if (!to) return;
    sfx('win');
    persist();
    showUnit(to, from, `Evolved into ${DATA.units[String(to)].n}!`);
  };
  s.querySelectorAll<HTMLElement>('.suit').forEach((b) =>
    b.addEventListener('click', () => {
      if (wearSuit(id, Number(b.dataset.suit))) { sfx('tick'); persist(); showUnit(id, from); }
    }),
  );
  s.querySelector('#evolve')?.addEventListener('click', () => doEvolve(false));
  s.querySelector('#instant')?.addEventListener('click', () => doEvolve(true));
}

// ------------------------------------------------------------------ pre-battle
function showPrep(levelId: number, season: number): void {
  const lv = DATA.levels[String(levelId)];
  const t = levelTitle(lv.n);
  const team = teamUnits().filter((u) => SAVE.owned[u.id]);
  const hasDoctor = team[0]?.t === 1;
  const s = el('div', 'screen');
  const hp = teamStats().reduce((n, st) => n + st.hp, 0);
  s.innerHTML = `
    <div class="row sp"><h2>${esc(t.tag)}</h2><button id="back">Back</button></div>
    <div class="panel"><b>${esc(t.title)}</b><div class="sub">${lv.w.length} wave${lv.w.length > 1 ? 's' : ''} · reward ${lv.xp} XP per unit${lv.lt > 0 ? ` · <b>time limit ${Math.floor(lv.lt / 60)}:${String(lv.lt % 60).padStart(2, '0')}</b>` : ''}</div></div>
    <div class="slots">${team.map((u) => `<div class="slot">${unitImg(u)}${pips(u)}<span class="lvl">Lv ${effectiveLevel(u.id)}</span></div>`).join('')}</div>
    <div class="sub">Team HP ${hp}</div>
    ${hasDoctor ? '' : '<div class="panel">Slot 1 needs a Doctor. Open Team to fix this.</div>'}
    <div class="row"><button id="team">Edit team</button><button class="primary" id="go" ${hasDoctor ? '' : 'disabled'}>Start</button></div>`;
  mount(s);
  s.querySelector('#back')!.addEventListener('click', () => showLevels(season));
  s.querySelector('#team')!.addEventListener('click', showTeam);
  s.querySelector('#go')!.addEventListener('click', () => startBattle(levelId, season));
}

// ------------------------------------------------------------------ battle
/** Story scripts for every level, fetched once the first time a battle starts. */
let storiesPromise: Promise<Record<string, StoryRow[]>> | null = null;
function loadStories(): Promise<Record<string, StoryRow[]>> {
  storiesPromise ??= fetch('data/stories.json')
    .then((r) => r.json() as Promise<Record<string, StoryRow[]>>)
    .catch(() => ({}));
  return storiesPromise;
}

/** Scripted gem layouts (testGemdata.txt) a story can switch on. */
let boardsPromise: Promise<Record<string, PresetBoard>> | null = null;
function loadBoards(): Promise<Record<string, PresetBoard>> {
  boardsPromise ??= fetch('data/boards.json')
    .then((r) => r.json() as Promise<Record<string, PresetBoard>>)
    .catch(() => ({}));
  return boardsPromise;
}

export async function startBattle(levelId: number, season: number): Promise<void> {
  const lv = DATA.levels[String(levelId)];
  const tutorial = levelId === TUTORIAL_LEVEL;
  const stats = tutorial ? tutorialTeamStats() : teamStats(); // the tutorial always uses the original starter pair
  const story = (await loadStories())[String(levelId)];
  await loadAudioIndex(); // so story sounds can play from the first row
  const presets = story ? await loadBoards() : undefined;
  const host = el('div', 'screen');
  host.style.padding = '0';
  host.style.maxWidth = 'none';
  host.style.alignItems = 'center';
  mount(host, true);
  const quit = el('button', '', 'Quit');
  quit.style.cssText = 'position:fixed;top:calc(8px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));right:8px;z-index:5;padding:6px 12px;opacity:.7';
  quit.addEventListener('click', () => { if (confirm('Leave this mission?')) { quit.remove(); settleOtb(levelId, false); persist(); showLevels(season); } });
  document.body.appendChild(quit);
  const finish = (o: BattleOutcome) => { quit.remove(); showResult(levelId, season, o); };
  refreshDropBonus();
  const buff = tutorial ? null : activeOtb(); // the One Turn Buff rolled after the last victory
  view = new BattleView(host, lv, buildWaves(lv), gemWeights(lv), stats, finish, {
    spawnDefs: buildSpawnDefs(lv), grids: buildGrids(lv), skins: gemSkins(lv, DATA.gemSkins[SAVE.settings.gemSkin]?.gems), timeLimit: lv.lt, story, presets, tutorial,
    perks: tutorial ? undefined : activePerks(),
    otb: otbFx(buff),
    rollDrop: (rows, multi, run) => rollEnemyDrop(rows, multi, run, levelId, Math.random, otbDropPoints(buff)),
  });
  (window as unknown as { __dwl: unknown }).__dwl = { get view() { return view; } };
}

// ------------------------------------------------------------------ result
function showResult(levelId: number, season: number, o: BattleOutcome): void {
  const lv = DATA.levels[String(levelId)];
  const s = el('div', 'screen center');
  const newBuff = settleOtb(levelId, o.victory); // the used buff is gone; a victory rolls the next one
  if (o.victory) {
    sfx('win');
    SAVE.cleared[levelId] = (SAVE.cleared[levelId] ?? 0) + 1;
    const ups: string[] = [];
    for (const id of SAVE.team) {
      const u = DATA.units[String(id)];
      if (!u || !SAVE.owned[id] || u.t === 1) continue; // the Doctor's level comes from the allies
      const before = SAVE.owned[id].lv;
      addXp(id, lv.xp);
      const after = SAVE.owned[id].lv;
      if (after > before) ups.push(`${u.n} → Lv ${after} (+${after - before} attribute point${after - before > 1 ? 's' : ''})`);
    }
    // drops are units (new allies), outfits or items (fragments, Time Crystals); items stack
    const newUnits: UnitDef[] = [];
    const newSuits: number[] = [];
    const gained = new Map<number, number>();
    for (const g of o.drops) {
      if (!receiveGift(g)) continue;
      if (g.kind === 'item') gained.set(g.id, (gained.get(g.id) ?? 0) + 1);
      else if (g.kind === 'unit') newUnits.push(DATA.units[String(g.id)]);
      else newSuits.push(g.id);
    }
    recordVictory(levelId, o.drops);
    persist();
    const itemsHtml = [...gained.entries()]
      .map(([id, n]) => `<span class="drop">${itemIcon(id)}<span>${esc(DATA.items[String(id)].n)} ×${n}</span></span>`)
      .join('');
    s.innerHTML = `
      <h1>Victory!</h1>
      <div class="sub">${o.turns} turns · ${lv.xp} XP to every ally</div>
      ${ups.length ? `<div class="panel list" style="margin-top:12px">${ups.map((x) => `<div>⬆ ${esc(x)}</div>`).join('')}</div>` : ''}
      ${itemsHtml ? `<h2 style="margin-top:16px">Items</h2><div>${itemsHtml}</div>` : ''}
      ${newUnits.length ? `<h2 style="margin-top:16px">New allies</h2><div>${newUnits.map((u) => `<span class="drop">${unitImg(u)}<span>${esc(u.n)}</span></span>`).join('')}</div>` : ''}
      ${newSuits.length ? `<h2 style="margin-top:16px">New outfits</h2><div>${newSuits.map((sid) => `<span class="drop"><img class="suitimg" src="${DATA.suits[String(sid)].img}" alt=""><span>${esc(DATA.suits[String(sid)].n.replace(/_/g, ' '))}</span></span>`).join('')}</div>` : ''}
      ${newBuff ? `<div class="panel otb" style="margin-top:16px"><img src="${newBuff.img ?? ''}" alt=""><div><b>New One Turn Buff: ${esc(otbSummary(newBuff))}</b><div class="sub">${esc(newBuff.desc.replace(/^OTB\s*:\s*/, ''))} It lasts one battle, then it is replaced with a new buff.</div></div></div>` : ''}
      <div class="menu"><button class="primary big" id="again">Next</button></div>`;
  } else {
    sfx('lose');
    s.innerHTML = `<h1>Defeated</h1><div class="sub">Try levelling your team, or changing the lineup.</div>
      <div class="menu"><button class="primary big" id="again">Retry</button><button class="big" id="lv">Missions</button></div>`;
  }
  persist();
  mount(s);
  s.querySelector('#again')!.addEventListener('click', () => (o.victory ? showLevels(season) : startBattle(levelId, season)));
  s.querySelector('#lv')?.addEventListener('click', () => showLevels(season));
}

export { unitMaxLevel, xpToNext, GEM_NAMES };
