# Doctor Who: Legacy — modern port (working notes)

Personal-preservation port of the abandoned Android game (APK v3.5.2) to HTML5, so it can be
wrapped as a modern 64-bit APK (Capacitor) later. Original assets stay local; do not redistribute.

## Folder layout
- `apk_extracted/`   raw APK contents (never edit)
- `ripped/`          AssetRipper export of the Unity project (UI atlases, audio, text data)
- `src_decompiled/`  ilspycmd output of Assembly-CSharp.dll (the original C# game logic)
- `data_json/`       every `.dw` content file decoded to JSON (630 MB, pretty-printed; scratch only)
- `scripts/`         decode_dw.py, build_data.py (data + asset pipeline)
- `tools/`           ilspycmd, AssetRipper (downloaded; safe to delete)
- `web/`             the new game (Vite + TypeScript)

## Original game facts
- Unity 4.7.2f1, Mono, armeabi-v7a/x86 only (cannot run on modern 64-bit Android).
- `.dw` files = `base64(name) + "$D%5]0C#O!D=>E>!IGA_M+)E@" + base64(JSON)`.
  For level/unit files the name prefix is the file stem (e.g. `T1N1`); for Config it is `Config.dw`.
- Resource files (png etc.) next to `.dw` = magic prefix (25 bytes) + raw bytes. WAV files have no prefix.
- Content types (Tnn): 1 config, 2 level flow, 3 gem images, 4 exp table, 5 seasons/gacha, 21 units,
  22 levels, 23 scenes (bg/fg lists), 24 enemies, 25 suits (unit art), 26 shop packs, 51 enemy
  images, 52 scene images, 53 sounds, 54 ability icons, 57 combo images.

## Gameplay rules (from decompiled code)
- Board **6 cols x 5 rows** (`new GemBoard(6, 5)`, index = col * 5 + row, row 0 = bottom), team of **6**
  (corrected in milestone 7; the first six milestones wrongly used 5 x 6 and a team of 5).
  Gems 1..6 = Red, Blue, Yellow, Green, Black, Pink(heal); 7 = the useless gem; 8 (internal) = crack.
- Touch a gem and drag it; it swaps with gems it passes. Move time limit 5 s from the first swap.
  On release, matches (>=3 in line, patterns in `matchdata.txt`) resolve with cascades -> combos.
- Damage per unit per color match: `unitAtk * (1 + 0.25*(gems-3))` (x doubles/subs), x dual-color
  factor for the unit's 2nd color (same color 0.1, different 0.3); match of >=5 gems hits all enemies.
  Combo multiplier `1 + 0.25*(combo-1)`.
- vs enemy: `max(1, dmg * typeRel[atk][def] - enemyDef)`. Type table: Red>Green, Blue>Red, Yellow>Black,
  Green>Blue, Black>Yellow (x2) and reverse x0.5 (see `ripped/.../TypeRelationData.txt`).
- Pink match heals `teamHeal * (1 + 0.25*(gems-3))`, combo multiplied.
- Team HP = sum of unit HP. Enemies count down `cd` each turn, attack for `atk` at 0 then reset.
- Turn order: Character -> Check -> Transform -> DeBuff -> Check -> Transform -> Monster -> End.
- Level enemy placement `id` -> `enemies_mod[id]` (first property = hp/atk/cd/def/attribute) and
  `enemy_id` -> T24 enemy template -> link type 51 -> enemy image.

## Status (milestone 1: playable core loop)
Run: `cd web && npm run dev` then open http://127.0.0.1:5173 (`#battle=18` jumps into a level).
Rebuild data/art after changing the pipeline: `python -I scripts/build_data.py`.
Tests (Node 24, no deps): `node tests/engine.test.ts`, `node tests/levels.test.ts`, `node tests/early.test.ts`.

Done: data + art pipeline; board/match/cascade engine; battle rules (damage, type weakness, combos,
heal, enemy countdowns, waves); canvas battle view with drag-to-swap, 5 s move timer, enemy target
tap, synthesized SFX; title / mission list (all seasons) / team builder / prep / result screens;
localStorage save with starter team, XP levelling, unit drops; `vite build` works.

Verified: all 763 levels load and simulate without errors; starter team clears the early Season 7
missions; real browser drag -> match -> damage -> enemy counter-attack confirmed.

### Milestone 2: abilities (done)
All 30 enemy abilities (ids 201-230) and 32 of 33 ally/Doctor abilities (101-133) are ported:
`web/src/engine/skills.ts` (skill logic), `battle.ts` (turn pipeline, statuses, ability roll),
`board.ts` (per-gem metadata: locks, power +/-, bombs, blind). Ported rules:
- Each enemy gets an implicit last "Attack" ability (rate 100, cd = enemy cd). Every round it rolls one
  ability in list order (`rate` > rand, uses left, enemy HP% <= `roll_hp`), counts down that ability's own
  cd, fires it, then re-rolls. Stunned enemies do not count down.
- Status lifecycle (from the original): decrement at move end -> character turn (stun active while
  turns >= 0) -> debuff phase (poison tick, bombs/life-tap fire at 0, reflect) -> remove expired -> monster turn.
- Ally abilities charge count-up from 0 (Doctor +combo per move, allies +1), tap the portrait when it glows;
  "grab/select" abilities enter a tap-a-gem mode; grabbed gems count as matches (full turn).
- Spawn skills respect the 3-living-enemies cap. Locks use the original StateType ids (1 no-match, 2 no-touch,
  3 no-swap, 4 no-pick, 5 no-pick/swap, 6 cracked).
Tests: `abilities.test.ts` (every skill), `levels.test.ts` (all 763 levels, bot uses abilities: 472 won / 283 lost / 8 stuck,
0 errors), `early.test.ts` (starter team clears the first 14 missions). Verified in a real browser: heal ability,
target-gem ability, enemy Lock Column cast during a drag turn, status/lock/bomb/blind overlays.
Known gaps / guesses: ability 122 (+time limit) is a no-op until timed levels exist; resistance perks are not ported;
"Remove Selected Debuff" (133) and move-time bonus (119) semantics are inferred; the Doctor's 2nd ability has no UI yet.

### Milestone 3: special gems (done)
`gems_drop` ids are not new mechanics. Each id maps (via `gemAttr`, from T3 `gems[].attribute`) to a colour:
ids 8-115 are cosmetic skins (Dalek, Cybermen, Pixel, Christmas...) of colours 1-6, and the level uses the first
listed id per colour as that colour's art (`gemSkins`); spawn weights are merged by colour (`gemWeights`).
All 115 skin images are exported to `web/public/img/gems`.
- Gem 7 "Useless Color": spawns where its rate > 0 (28 levels), can be dragged/swapped, never matches.
- Crack obstacles: per-wave preset grids (`match_grid`, 143 waves in 68 levels; values 1-4 -> T59 art via the
  scene-addenda `obstacle_list`). A crack is board colour 8 with lock 6: not matchable, pickable or swappable,
  falls with gravity, is skipped by conversions/shuffles/locks, survives a board reset, and turns back into a
  random plain gem when the next wave loads. The grid is the original's `match_grid[col][row]` (6 columns of 5 rows,
  row 0 at the bottom); an earlier note here called that "transposed" and "fixed" it, which was wrong (see milestone 7).
Tests: `specials.test.ts`; `levels.test.ts` now plays all levels with their crack grids (still 472 won / 283 lost /
8 stuck, 0 errors). Verified in a real browser on levels 500 (cracks), 330 (pixel skin) and 101 (gem 7).

### Milestone 4: timed levels + boss banner (done)
48 levels have `limit_time` (66 s - 20 min); no level uses a turn limit (`limit_count` is 0 everywhere), so that
mode is not implemented. Rules from the original: one level-wide wall-clock budget that starts with wave 1 (it does
not reset per wave); a drag in progress when it runs out is released and resolves first; the level then ends as a
defeat (a winning last move counts). Ability 122 adds seconds to the budget (and is refused/uncharged on untimed
levels). Engine: `Battle.timeLimitMs/timeLeftMs/tickTime/addTime/timeUp`; the view ticks it with real elapsed time
(capped per frame so a hidden tab can't burn the clock), draws a TIME m:ss bar, and shows "TIME UP". The mission
prep screen shows the limit. Boss waves (`boss_fight`, 554 waves) show a "BOSS BATTLE" banner.
Tests: `timed.test.ts` (clock, ability 122, 48 real timed levels: with a 6 s/move bot 28 are won in time, 5 time out,
15 are lost; untimed the same levels give 32 wins, so the limit costs real wins). Verified in a browser on level 341:
bar counts down, TIME UP from idle, and mid-drag expiry resolves the held move before ending (3 of 4 runs clean,
one run lost the move and could not be reproduced; the pane was being resized then).

### Milestone 5: unit upgrades (done)
The original progression, ported from `UnitPropertyComposor`, `UpgradeMenu`, `UpgradeAttributeMenu`, `BagData`:
- **Real exp tables** (`DATA.exp`, keyed by the unit's `exp_id`) replace the earlier placeholder `40 x level` curve.
  Level rewards are 20,000 XP median (max 100,000), which is what those tables expect. Only allies earn battle XP.
- **Attribute points**: each ally level = 1 point; spend on HP (+10), ATK (+5) or Heal (+3). Reset refunds all
  points for 1 Time Crystal. The Doctor takes no points.
- **Derived Doctor level**: `trunc(trunc(sum(allyRank * (allyLevel + add_dr_level)) / doctorRank) / allyCount)`,
  clamped to the Doctor's level range. Alex/George Thompson have `add_dr_level 10`, so the starter Doctor opens
  near its cap, as in the original.
- **Evolution (rank up)**: needs the recipe items (`ei`, fragments 37-42, 496-498, 814, 1311/1312); allies also
  need max level. The unit is replaced by its `evo_target` at the new rank's starting level, keeps its attribute
  points, and keeps its team slot. **Instant evolve** costs `ec` Time Crystals (id 45) instead of fragments.
  Fragments and crystals drop from enemies (crystals in 296 levels, fragments in 70-430 each), so the economy needs
  no invented sources. Duplicate ally drops are ignored.
- Save: `owned[id] = {lv, xp, pts, hp, atk, heal}` plus `items`; older v1 saves are migrated on load.
- UI: Team screen shows the item bar, derived Doctor level, point badges and an "Upgrade" button; a unit page has
  stats with + buttons, ability, XP bar and the evolution panel with a live recipe; the result screen lists XP,
  level-ups, items and new allies.
Code: `web/src/progression.ts` (rules), `save.ts` (state), `screens.ts` (`showUnit`).
Tests: `progression.test.ts` (exp tables, XP, points, reset, derived level, ally/Doctor/instant evolution, every
evolution chain in the data, save migration). Verified in a browser: Doctor evolve, ally point spend/reset/instant
evolve, result-screen items.
Not ported: selling/fusing units, the Team Slot item (251), daily bonus, season XP bonus (`add_exp_ratio`), alternate
"restraint"/special team types, suits (outfits).

### Milestone 6: story scenes (done)
239 levels carry a script (`T22 script`, XML). It is a small language that runs *inside* the battle:
`actor` (create/update a sprite: suit / scene_image / enemy_image art, layer back|center|front, alpha, tint,
scale), `fade`, `move` (endpos is a delta), `wait` (`minwait` = a tap may cut it short), `text` (typewriter:
`spread` chars per `rate` s; `wait=user|finished`, `skippable`), `gameplay`, `setskip` (skip jumps to a tagged
row), `trigger` (suspends the story until a battle condition holds) and `goto`.
Ported from `DialogStorySys` / `DialogStoryFormual` / `SeedStudio.DialogStoryFramework.Action.*`:
- Pipeline: `build_data.py` parses each script with ElementTree into rows -> `public/data/stories.json`
  (1.3 MB, 13,564 rows, loaded lazily on the first battle) and exports the referenced art
  (80 character images `img/suit`, scene and enemy art).
- `web/src/story.ts` is a pure interpreter (no DOM). While a row runs it is `locked` (the board ignores the
  player); a `trigger` unlocks the board and the story waits. Conditions: `waitwaveindex,N` (1-based wave),
  `checkenemycount,N`, `checkgamestate,3` (waiting for input) / `,11` (victory), `checkgettoend` (any move).
- Placement (verified in `CreateActor`): y is measured up from the bottom, `y = ypos + screenHeight * aligny`, so
  `aligny=1` with a negative `ypos` hangs a sprite from the top. Our 640x1130 stage stands in for the 1136 original.
- In the battle view: story layers drawn above the board only while a row is *running* (a suspended story closes
  its window, as in the original), dialogue box with typewriter text and a tap marker, SKIP button above the box
  (original position), blip sounds, `shakecamera`. Winning calls `markVictory()` so scripts that wait for
  "state 11" play their outro before the result screen. The level clock pauses while dialogue is on screen.
Tests: `story.test.ts` unit-tests every action and then plays all 239 real scripts to completion against a
simulated battle (2,051 dialogue lines shown, 351 skip buttons validated, all art present). Verified in a browser on
level 13: intro, tap-through, SKIP, suspension (board clear), auto-resume when the last enemy dies, and an outro
before "Victory!".
Known gaps: tutorial scripting is ignored (`tutorialgem`, `turnonloadgemdata`, `callmonsterattackbyindex`,
`closetutorialmode`, `showallmonsterabilityui`, `changeallgemstate`, `checkenemyattack`, `assignskillcd`: level 18 and
a few others show the dialogue but do not force the scripted moves), `dssprite` / `setspritetolayer` /
`removespritefromlayer` (27+7+7 rows), `rollgift`, `playsound`/`playmusic` ids. Level 517 ships a skip button with no
target (the original also does nothing). No localisation: the `id` text is shown as written.

### Milestone 7: tutorial scripting, plus two core corrections (done)
**Corrections found while doing this** (the tutorial could not work without them):
- The real board is `new GemBoard(6, 5)`: **6 columns x 5 rows**, row 0 at the bottom, column-major index, and the
  team has **6 slots**. The port had 5 x 6 and 5 slots since milestone 1. Fixed everywhere: `COLS=6, ROWS=5`
  (`board.ts`; internal row 0 is the top, `origRow()` converts data rows, which count from the bottom), team size 6,
  view layout, lock-column / lock-row / corner abilities (corners 0..3 = bottom-left, top-left, bottom-right,
  top-right), crack grids `[col, row, obstacle]`, tests. Evidence: `GemBoard(6u, 5u)`, `horizontal-6` in
  matchdata, `tutorialgem` coordinates up to column 5, the `tutorialgem2` board (6 columns), team portraits at
  `70 + 100 * i` for i < 6.
- **A swap that makes no match still ends the turn** (original `CheckPathState` calls `endDestoryCombo()` even with
  zero combos): statuses tick and enemy cooldowns count down. The port used to ignore no-match swaps. The
  tutorial's fifth lesson is exactly this ("swap two gems to complete a turn").
**Tutorial scripting** (nearly all in level 18, the Season 7 tutorial; played with the original new-game party,
Eleventh Doctor id 15 + Madame Vastra id 29, whatever the player's own team is):
- `turnonloadgemdata,<board>`: `Battle.loadPreset` builds the board from `testGemdata.txt` (exported to
  `public/data/boards.json`; rows read from the bottom) and keeps feeding each column's refills from that board
  (`GetGemTypeEX`: per-column queue, wrapping at the definition's last row). Gems fall in from above.
- `tutorialgem,c,r,c,r`: `openTutorialGem` freezes every gem except the start gem (lock 5) and marks the path (columns
  along the start row, then rows along the end column) as swappable-but-not-pickable (lock 4). On release
  `tutorialFinish` accepts the drag only if the start gem reached the end cell (everything is then cured); otherwise the
  board is restored and no turn is spent. `checkgettoend` waits for it.
- Tutorial mode (`Battle.tutorialMode`, level 18): no debuff turn and enemies do not count down until
  `closetutorialmode`; `callmonsterattackbyindex` forces one scripted hit; `assignskillcd,u,n` adds charge (an index
  past the team = everyone); `changeallgemstate,s,t` locks the whole board (the finale: only the Doctor's ability
  can end the fight); `rollgift,id` rolls an enemy's drop table (`(10000 + level*1000 + enemy)*1000 + 100 + card`).
- Guide sprites: `setspritetolayer` makes an independent copy of a story actor's image (alpha 1, rotation 0) in the battle
  layer; `dssprite,name,prop,value` edits the copy; `removespritefromlayer` deletes it. They are drawn in board
  coordinates (`x = 70 + 100 col`, `y = 50 + 100 row`, up from the board bottom) and stay visible while the story waits.
- Code: `story.ts` (layer sprites, `tutorialDone` host hook), `storycmd.ts` (command dispatch shared by the view and
  the tests), `battle.ts` (preset board, scripted drag, tutorial mode), `battleView.ts` (enforcement on release, arrows).
Tests: `tutorial.test.ts` plays the real level-18 script start to finish with a scripted player (preset board order,
drag rules, mode gating, commands, every drag: 4 matches incl. a 6-combo, one deliberate no-match turn that the
enemy punishes, then a win via the Doctor's ability); `story.test.ts` covers layer-sprite semantics. Verified in a
browser: the arrow on the right gem, frozen gems, wrong picks / sideways drags refused with no turn spent, the right
drag resuming the story and killing the first enemy.
Not ported: `checkenemyattack` (one level, flow control the new turn loop does not need),
`showallmonsterabilityui` (enemies already show their next ability), story music/sound ids. The player's real starting
team is still my broader pick (units 1, 5, 9, 13, 17 + one more), not the original's Doctor 15 + Vastra 29 alone.

Not done yet (rough priority):
2. Turn-limited levels (no data uses them).
3. Unit upgrade/evolve/fusion (the original's progression), gacha, perks, daily missions.
4. Story scripts (`script` field in levels is an XML dialog format), original music/SFX (`ripped/.../audio`,
   `T53` sounds), original UI atlases.
5. Package as 64-bit APK with Capacitor (needs Android SDK; JDK 25 may need a Gradle that supports it).
   Converting PNGs to WebP would cut the 188 MB `dist` a lot.
Deliberate changes vs original: battle-XP levelling curve (`40*level`), default target = last enemy
unless the player taps one, gem colours 1-6 only.

## Milestone 8 - story audio cues and checkenemyattack
- Story `playsound`/`playmusic` rows, typing beeps (chatbeeplow/mid/high -> sound ids 25/26/27) and `onesfx` play the original files (exported by scripts/build_data.py to web/public/audio, indexed in data/audio.json).
- Battle music: random battlemusic01-03 loops automatically (scope extension, as in the original). Single mute toggle covers music.
- `checkenemyattack`: original wave-start rule. Enemies whose current ability has countdown 0 act before the first move of each wave (Battle.readyEnemyPhase); story postpones it, `checkenemyattack,0` releases it. Affects ~139 levels.
- Not yet browser-confirmed: the actual fetch of audio/sfx/74.wav on level 156 (battle music fetch confirmed).
- Still not ported: turn-limited levels (no level uses them), selling/fusing (not in the original). APK packaging: see Milestone 16.

## Milestone 9 - outfits, daily bonus, main-menu music
- Original has NO selling or fusing of units (the "Merge" code is cloud-save merging; duplicates are blocked by ContentRule.canGetSameOne). Not ported because nothing exists to port; evolution (milestone 6) is the only unit-consuming mechanic.
- Outfits (suits, T25): cosmetic only. 415 outfits with art exported (img/unit/{id}_sq.png, names in gamedata.suits); each unit lists alternatives in `ss`. Save: `suits` (won), `wear` (unit -> outfit). Worn outfit shows on team screens and the battle portrait; evolving resets to default (as original UpgradeUnit). `web/src/wardrobe.ts`.
- Getting outfits: the original used a season-based Tardis roll (crystal cost per season, weighted lists) and shop sets. Port: Tardis screen, 4 crystals (original default _crystalCost), uniform random among outfits of OWNED units not yet won. Season weights/costs and purchase sets not ported.
- Daily bonus: 5-day table from Config (frags 37/42/41/39, day 5 = 2 Time Crystals). The original asked a server for the day; offline: claim on consecutive local calendar days to advance, miss a day -> day 1, after day 5 -> day 1 (assumption). `web/src/daily.ts`; popup on the title screen once per visit.
- Main-menu music: mainmenu.mp3 loops on menu screens without restarting between screens (original PlayMusicResource restart=false); battles stop it and play battlemusic; browsers that block autoplay retry on the first tap.
- Tests: tests/wardrobe.test.ts.
- Dev note: `npm run build` failed with EPERM removing web/dist/img (a locked folder, not a code problem); `vite build --outDir <fresh dir>` builds fine.

## Milestone 10 - perks
- Source: PerkConfig (T8, 4 types / 27 groups / 58 skills, art T57 -> img/perk) + PerkSkillFramework (30 numbered functions). Exported to gamedata.perks.
- Rules: a perk TYPE is open unless season-gated (Perk 2 = Season 7, Perk 3 = Season 6; "finished" = every playable mission in it cleared once; the Unlock-all option counts as finished). A GROUP opens at its star cost (stars = summed rank of every unit owned) or by buying it with Time Crystals (Perk S groups). One skill (or none) per open group; picks apply in every mission except the scripted tutorial.
- Purchases: per the user, always approved and free (no crystal check or spend). Extended in Milestone 11 to every crystal spend.
- Engine (`engine/perks.ts`, hooks in battle.ts/skills.ts, `perkbook.ts` for selection): team atk/hp/heal percent, colour damage, colour resistance, shape damage and cure (T = bar of 3 with a 2-gem stem BELOW it in bottom-up rows, cross, full row of 6), poison/bomb/stun/lock-turn resistance, colour-to-colour rate, Doctor cooldown/combo/kill/hit charge, defence penetration, low-HP heal/damage/resistance, wave-start gem boost, drop weight, combo master, auto heal, skill heal, hit heal, move time, match-N-gems bonus, leech/stalwart.
- Damage bonuses are added to the raw (post-combo) damage before type/defence, all based on the same raw value (not compounding), like CharacterTurn.HandleShowDamage. Low-HP checks use HP at the start of the move.
- Not used by any perk skill, so not ported: functions 9 (count lock resist), 16 (store skill), 28 (extra gem enhance).
- Guesses: T-shape orientation taken literally from the match data; drop-rate points only added to colours the level already drops; poison resist clamped at 0; a lock cut to 0 turns does not land.
- UI: Perks screen from the title (tabs per type, skill list per group, free Unlock button). Tests: tests/perks.test.ts.

## Milestone 11 - no pay-to-play
Original monetisation (decompiled InAppPurchaseMenu, IAPLevelKeyData, GameOverState): six Time Crystal packs (1/8/17/35/91/221) sold for real money; five paid level packs (BOTI Ch1, Trickster, Sonic Adventure, 2015 Xmas, Kids 01, each with a free sample twin); plus ads and Facebook offers. None of that is in the port, and the paid packs were always playable here (no purchase check; their levels are in the flow data).
User decision: Time Crystals stay an earned reward (mission drops, daily bonus day 5) and every crystal spend is free and unlimited.
- Free now: perk groups, Tardis outfit roll, instant evolve (still needs max level for allies), attribute reset.
- New: game-over/time-up Continue (original cost 1 crystal): full HP, fresh board via resetBoard (cracks kept), poison/bomb/tap/move debuffs and unit stuns cleared, full clock in timed levels; enemies and wave unchanged. Battle.continueAfterDefeat + BattleView.offerContinue.
- New: Max level now (original UpgradeAttributeMenu LEVELMAX, 2 crystals or the evolve cost): ally jumps to its cap, +1 point per level gained, xp 0. progression.maxLevelNow.
- Not built: character "roll sets" (priced bundles) and per-season Tardis costs; they only matter if outfit/unit rolls get season pools.
- Tests updated (progression, wardrobe) and timed.test.ts covers Continue.

## Milestone 12 - drops, Tardis, Doctor's second ability
- Mission drops (`drops.ts`, ported from BaseDropCard/DropCardSingleRate/MultiRate, BagData.canPutInBagMore/canGetSuit, ContentRule.canGetSameOne):
  - Data now keeps every drop row type: 1 unit/item id, 9 outfit id (371 rows in 213 missions; these were dropped before), 4 random fragment (only in enemy property sets 2/3, which the port does not use), nested follow-on cards (one: level 443), and the card rule. "single": rows roll in turn, first allowed hit wins, one gift per card; "multi": one dice over the running total. A row that hits but is not allowed falls through to the next.
  - Allowed (checkpacket): a family (`group`) is owned once (a mission may still give a higher-rank member when you own a lower one; the Tardis never does); outfits need an owned unit that can wear them and must not be owned (a unit's default outfit counts as owned with it); no two units of a family or the same outfit in one run; fragments stop at 250 (T1 time_fragment_limit); a mission can drop at most `crystal_limit` Time Crystals over its whole life (536 missions: 1), counted in SAVE.crystalDrops on victory.
  - Drop-rate bonus (Victorystate/DropBuilder/Main): +0.3 points per victory (max 15) added to unit and outfit rows (truncated), halves for every full day away (gone under 1). SAVE.dropBonus/dropBonusAt.
  - Previously every row rolled independently, so one enemy could drop several things; now one gift per card.
  - `rollgift` story rows go through the same roller (storycmd.giftSource).
- Tardis (`tardis.ts`, T5 season config + T6/T26 packs): one roll hands out a unit OR an outfit, weighted by the season list (duplicate rows combine as independent chances; pa_suit / pa_character bonuses are 0 in the data but applied). Only "Season 7" has available_roll=1 (89 units, 34 outfits). Outfits only enter the list with 8+ allies (GenerateRandomList). Sets: 162 packs of units/outfits/items, listed while anything in them is still obtainable; claiming gives every piece you do not have. All free (crystal prices and per-season discounts, season_crystal, are not used). Not built: team-slot packs (item 251; the team is fixed at 6) and platform filtering (every pack allows Android).
- Doctor's second ability: all 193 Doctors have two abilities (e.g. 15 and 30 combos). Both count the same combos on one shared counter; a tap uses the ready ability with the longest cooldown; using one resets both (CharacterAbility.FlushAll). UnitState.maxes, Battle.readyAbility. Bar shows the longer cooldown with a tick for the shorter; the tip and unit screen list both. Doctor-cooldown perks apply to each.
- Tests: tests/tardis.test.ts (new), abilities.test.ts (Doctor), tutorial.test.ts (giftSource).

## Milestone 13 - news, credits, fuller options
- News (`news.ts`, title-screen News button with a "!" badge until the newest item is opened, SAVE.settings.newsSeen): the original NewsMenu fetched https://news-doctorwho.seedstudio.com/.../NewsRequest.php and, on failure, showed one "Could not contact news server" item. That server is gone, so the port never goes online: news items are written into the game, plus the original's own perk tips (T1 scrolling_data "PerkSkillMenuVer2", word for word; the "EpisodeMenu" tips are about buying TV episodes on iTunes and are left out). tests/options.test.ts scans src for web addresses, XHR/WebSocket/beacon and any fetch() that is not data/ or img/ (so the "no network" claim is checked).
- Credits: the original's `ui/optionsmenu/credits.txt` is copied to web/public/data/credits.txt by build_data.py and rolls on its own at about 60 px/s (the original used 80 on its own scale), loops, and a touch or wheel takes over for 3 s. It includes the BBC trade mark notice and Futile's MIT licence text. Like every extracted asset it is not to be redistributed.
- Options: Settings tab = Music and Effects volume bars (0-10, default 7 = the original's 0.7, so 7 plays at authored loudness; audio.setVolumes), Mute, Gem look (the 18 T3 skins, applied like LevelBuilder.buildLevel: each look gem replaces the level's gem of the same colour; a level with no gem list uses plain gems 1-6), Unlock all levels. App info tab = version, counts, Save backup / Load backup (offline stand-in for "Save Data to Cloud"; save.importSave validates, drops unknown units, trims the team), Credits, sandbox "Add every unit", Reset.
- Left out on purpose: Support and Promo tabs (links and promo codes need the dead servers), Public Player Id / Secret Key / Google sign-in / achievements / restore purchases (all server or store bound), Ads (original default off). Not built because the feature itself is missing: Skill cut-in animation toggle (no cut-in exists) and One Turn Buff toggle (OTB is a real original system, T10 OTBConfig + T58 images, a random buff after each combat level; ported in Milestone 14).
- Tests: tests/options.test.ts.

## Milestone 14 - One Turn Buffs
- Source: OTBSystem, ResultMenu, LeaveSceneState, LevelScene (unit build), DropBuilder, T10 OTBConfig, T58 art (img/otb/N.png). `otb.ts`, Battle `opts.otb`, `drops.rowChance(row, extra)`.
- Ten buffs, enabled all: attack +5/+10, heal +5/+10, max HP +10/+15, drop +10/+20, and "all" (5/5/10/10 and 10/10/15/20); common ones 17%, strong ones 3%. The roll is `dice = 0..99`, first buff whose running total the dice does not pass using `<=` as in the original, so the first buff really has 18 faces and the last 2.
- Lifecycle: leaving any battle (win, defeat, quit) clears the buff (LeaveSceneState); a victory then rolls the next one when the option is on and the mission is not in the 39-mission exempt list (tutorial, story chapters). The original kept the buff in memory only; here it is in the save (SAVE.otb) so a browser refresh keeps an earned buff. Option `settings.otb` (default on) is in Options > Settings.
- Effects: each unit's attack x(1+p), truncated; team max HP x(1+p) and team heal x(1+p), truncated; all before perks, and perk percentages work from the raised totals (original order in LevelScene). Drop points are added to EVERY drop row (units, items, crystals, even 12 rows at 0%), then the sum is truncated once. Crystal caps and ownership rules still apply.
- UI: panel on the mission list and the team screen while a buff is waiting; result screen shows the newly rolled buff. Not shown: the original's first-time tip dialog and the boosted-stat preview in its pre-battle team select (the port has no such screen).
- Tests: tests/otb.test.ts.

## Milestone 15 - the original starter team
- A new game (and "Reset progress") now starts as the original does (UserData.resetData / BagData.AddDefaultUnits / TeamData.default_team): the Eleventh Doctor (15) and Madame Vastra (29), team of two with four empty slots, no items, no extra outfits. It used to be Doctor 1 plus five allies picked one per colour, which the original never gave. save.DEFAULT_DOCTOR / DEFAULT_COMPANION; the tutorial pair is the same two.
- A brand-new game goes straight into the tutorial (LoadingScene.StartTutorialOrMainScene: UITutorialState <= 1) and keeps doing so until a mission has been cleared; `needsTutorial()` is false with any progress or with Unlock all on. Existing saves keep their team.
- Balance check (tests/early.test.ts): the bot, now collecting each won mission's drops as a player would and fielding new allies, wins all 14 early Season 7 missions 20/20 and has a full team of six by the end. With no drops collected, the pair stalls around mission 22 (win rates fall under 30%), which is expected: missions are where allies come from.
- Not saved until the first change: a fresh game is only written to storage when something persists, as before.

## Milestone 16 - Android APK (Capacitor)
- Output: `apk/doctor-who-legacy-debug.apk` (109 MB; the 291 MB of art and audio compress well). Package `com.drowlord.dwlegacy`, name "Doctor Who Legacy", minSdk 24, target/compile SDK 36, versionName 1.0. Debug-signed (v2 scheme), which is enough to sideload; it is not a Play Store build.
- It is pure web content in a WebView (no native libraries), so it runs on 64-bit phones; the original only had 32-bit code. Portrait only. The manifest has no permissions at all: no INTERNET, so the app cannot go online even by accident (Capacitor only uses the network for external URLs and a dev server; bundled files come straight from the APK).
- Android behaviour (`src/native.ts`, no-op in a browser): system bars hidden (swipe from the edge to show), the back button closes a pop-up, presses the screen's Back button, asks to leave a mission, and exits from the title screen; safe-area insets pad the screens and the Quit button.
- Rebuild: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_apk.ps1` (about 5 minutes; log in apk_build.log). It does the web build, clears and re-syncs web/android/app/src/main/assets/public, runs `gradlew assembleDebug` and copies the APK to apk/.
- Tools (not in the repo), under D:\Desktop\Software_Portable: `jdk-21` (Temurin 21.0.13; Gradle 8.14.3 / AGP 8.13 / Capacitor 8 need 21, the JDK 25 there is too new), `android-sdk` (cmdline-tools 23, platform-tools 37.0.1, platforms android-36, build-tools 36.0.0 and 35.0.0, licence accepted), `gradle-home` (GRADLE_USER_HOME, Gradle 8.14.3 and the Maven cache), `downloads` (the original zips). Each download was checked against its published checksum.
- Gotchas found: (1) Java NIO selectors fail inside the Claude Code tool sandbox ("Unable to establish loopback connection") although plain sockets work, so Gradle and the Android SDK manager must be run from a normal terminal; aapt2/apksigner and other short checks work in the sandbox. (2) The new `sdkmanager.bat` is a wrapper over the Android CLI and splits package names at ';' unless they are quoted. (3) The Vite dev server's file watcher held the Android asset copy open and made `cap sync` fail with ENOTEMPTY/EPERM; vite.config.ts now ignores web/android and the dist folders. (4) Capacitor CLI telemetry was turned off (`npx cap telemetry off`).
- Not done: no run on a device or emulator (none available here); the built bundle was checked by serving dist in a browser (loads, no console errors, all data files found) and the APK by aapt2/apksigner. A release-signed build would need a keystore.
- Icon and splash: the original game's own icon (the TARDIS among the gems, apk_extracted/res/drawable-xxxhdpi-v4/app_icon.png, only 192 px), built by `node web/scripts/make_icons.mjs` (uses the sharp dev dependency; writes web/android/app/src/main/res). Legacy icons at 48-192 px, square and round; an adaptive icon (art at 76 of 108 dp on a flat background taken from the art's edge, #2E485D, so every launcher mask shows the whole TARDIS); and splash images in every size the project had (the game's dark #0b1220 background with the rounded icon at 40% of the short side). The source is small, so the adaptive icon is a little soft on high-density screens. Run the script again before rebuilding if the art changes. There is no Android 13 themed (monochrome) icon.

