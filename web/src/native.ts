// Things that only matter inside the Android app (Capacitor). In a browser none of this does anything.
import { Capacitor, SystemBars } from '@capacitor/core';
import { App } from '@capacitor/app';

/** Walk back one screen the way the Android back button should: close a pop-up, press the screen's Back, or leave a mission. */
export function goBackOneStep(): 'closed' | 'back' | 'quit-mission' | 'exit' {
  const modal = document.querySelector('.modal');
  if (modal) {
    const out = modal.querySelector<HTMLElement>('#close, #giveup');
    if (out) out.click();
    else modal.remove();
    return 'closed';
  }
  const back = document.querySelector<HTMLElement>('#back');
  if (back) {
    back.click();
    return 'back';
  }
  const quit = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Quit');
  if (quit) {
    quit.click(); // asks "Leave this mission?"
    return 'quit-mission';
  }
  return 'exit';
}

export function setupNative(): void {
  if (!Capacitor.isNativePlatform()) return;
  void SystemBars.hide(); // full screen, like the original; swipe from the edge to bring the bars back
  void App.addListener('backButton', () => {
    if (goBackOneStep() === 'exit') void App.exitApp();
  });
}
