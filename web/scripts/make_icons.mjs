// Builds the Android launcher icons and splash screens from the original game's own app icon
// (apk_extracted/res/drawable-xxxhdpi-v4/app_icon.png, 192 px: the TARDIS among the gems).
//   node scripts/make_icons.mjs
// Writes into web/android/app/src/main/res (mipmap-*, drawable*/splash.png, values/ic_launcher_background.xml).
import sharp from 'sharp';
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const SRC = path.join(root, 'apk_extracted', 'res', 'drawable-xxxhdpi-v4', 'app_icon.png');
const RES = path.join(root, 'web', 'android', 'app', 'src', 'main', 'res');
if (!existsSync(SRC)) throw new Error(`original icon not found: ${SRC}`);

const SPLASH_BG = { r: 0x0b, g: 0x12, b: 0x20 }; // the game's own background colour (#0b1220)

// density -> [legacy icon px (48dp), adaptive layer px (108dp)]
const DENSITIES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };

const src = await sharp(SRC).ensureAlpha().png().toBuffer();

// Adaptive icons are masked to about the middle 72 of 108 dp. The art sits at 76 dp: big enough to cover every mask shape, small enough to keep the TARDIS lantern at the top.
const ART_DP = 76;
const LAYER_DP = 108;

// Background colour of the adaptive icon: the average colour of the artwork's own edge, so nothing shows at the seams.
async function edgeColour() {
  const w = 192;
  const e = 6;
  const strips = [
    { left: 0, top: 0, width: w, height: e },
    { left: 0, top: w - e, width: w, height: e },
    { left: 0, top: 0, width: e, height: w },
    { left: w - e, top: 0, width: e, height: w },
  ];
  const sum = [0, 0, 0];
  for (const s of strips) {
    const st = await sharp(src).extract(s).stats();
    for (let i = 0; i < 3; i++) sum[i] += st.channels[i].mean / strips.length;
  }
  return sum.map((v) => Math.round(v));
}

const [er, eg, eb] = await edgeColour();
const hex = '#' + [er, eg, eb].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
writeFileSync(
  path.join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`,
);
console.log('adaptive background', hex);

const circle = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

for (const [d, [legacy, layer]] of Object.entries(DENSITIES)) {
  const dir = path.join(RES, `mipmap-${d}`);
  // legacy (Android 7 and older) icons: square and round
  const square = await sharp(src).resize(legacy, legacy, { kernel: 'lanczos3' }).png().toBuffer();
  writeFileSync(path.join(dir, 'ic_launcher.png'), square);
  const round = await sharp(square).composite([{ input: circle(legacy), blend: 'dest-in' }]).png().toBuffer();
  writeFileSync(path.join(dir, 'ic_launcher_round.png'), round);
  // adaptive foreground: the art centred on a transparent 108 dp layer
  const art = Math.round((layer * ART_DP) / LAYER_DP);
  const artPng = await sharp(src).resize(art, art, { kernel: 'lanczos3' }).png().toBuffer();
  const off = Math.round((layer - art) / 2);
  const fg = await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: artPng, left: off, top: off }])
    .png()
    .toBuffer();
  writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), fg);
  console.log(`mipmap-${d}: ${legacy}px icon, ${layer}px adaptive layer`);
}

// Splash screens: the game's dark background with the icon in the middle, in every size the project already has.
const splashFiles = readdirSync(RES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^drawable(-|$)/.test(e.name) && existsSync(path.join(RES, e.name, 'splash.png')))
  .map((e) => path.join(RES, e.name, 'splash.png'));
for (const f of splashFiles) {
  const { width, height } = await sharp(f).metadata();
  const side = Math.round(Math.min(width, height) * 0.4);
  const rounded = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${Math.round(side * 0.22)}" fill="#fff"/></svg>`);
  const icon = await sharp(src)
    .resize(side, side, { kernel: 'lanczos3' })
    .composite([{ input: rounded, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const out = await sharp({ create: { width, height, channels: 3, background: SPLASH_BG } })
    .composite([{ input: icon, left: Math.round((width - side) / 2), top: Math.round((height - side) / 2) }])
    .png()
    .toBuffer();
  writeFileSync(f, out);
  console.log(`splash ${path.relative(RES, f)}: ${width}x${height}, icon ${side}px`);
}
