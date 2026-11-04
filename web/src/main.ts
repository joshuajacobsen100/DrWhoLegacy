import './style.css';
import { loadData } from './data.ts';
import { loadSave } from './save.ts';
import { setMuted, setVolumes } from './audio.ts';
import { showTitle, startBattle } from './screens.ts';
import { TUTORIAL_LEVEL, needsTutorial } from './progression.ts';
import { DATA } from './data.ts';
import { setupNative } from './native.ts';

async function boot(): Promise<void> {
  setupNative();
  const app = document.getElementById('app')!;
  app.innerHTML = '<div class="screen center"><div class="sub">Loading…</div></div>';
  try {
    await loadData();
    const save = loadSave();
    setMuted(save.muted);
    setVolumes(save.settings.music, save.settings.sfx);
    // dev shortcut: index.html#battle=18 jumps straight into a level
    const m = /battle=(\d+)/.exec(location.hash);
    if (m && DATA.levels[m[1]]) startBattle(+m[1], 0);
    else if (needsTutorial() && DATA.levels[TUTORIAL_LEVEL]) startBattle(TUTORIAL_LEVEL, 0); // a new game opens with the tutorial, as the original did
    else showTitle();
  } catch (e) {
    app.innerHTML = `<div class="screen center"><h2>Could not load game data</h2><div class="sub">${String(e)}</div><div class="sub">Run <code>python -I scripts/build_data.py</code> first.</div></div>`;
    console.error(e);
  }
}

void boot();
