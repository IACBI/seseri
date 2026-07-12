/* Renders public/icons/seseri.svg into every PNG the stores need.
 * Uses headless Edge (already a devDependency path) — no sharp/imagemagick. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');

/* The "sinyal" mark: five round-capped bars (frequency-line crest).
 * Centers x = 100..412 step 78; heights echo the in-app brand mark. */
const BARS = [
  { x: 100, h: 102 },
  { x: 178, h: 216 },
  { x: 256, h: 300 },
  { x: 334, h: 156 },
  { x: 412, h: 240 },
];
const GRAD = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#241c13"/><stop offset="1" stop-color="#14100c"/>
    </linearGradient>
    <!-- userSpaceOnUse: zero-width line bboxes can't carry an objectBoundingBox gradient -->
    <linearGradient id="bar" gradientUnits="userSpaceOnUse" x1="0" y1="106" x2="0" y2="406">
      <stop offset="0" stop-color="#ffc46b"/><stop offset="0.55" stop-color="#f2a33c"/><stop offset="1" stop-color="#c98a33"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.32" cy="0.2" r="0.95">
      <stop offset="0" stop-color="#f2a33c" stop-opacity="0.14"/>
      <stop offset="0.6" stop-color="#f2a33c" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
const SIG_MARK = (scale = 1, stroke = 'url(#bar)') => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    ${BARS.map(
      (b) =>
        `<line x1="${b.x}" y1="${256 - b.h / 2}" x2="${b.x}" y2="${256 + b.h / 2}"
           stroke="${stroke}" stroke-width="44" stroke-linecap="round"/>`,
    ).join('\n    ')}
  </g>`;

/** variant → svg body (512 box) + transparent? */
const VARIANTS = {
  // rounded tile, transparent corners — launcher/"any"
  'icon-192': { size: 192, alpha: true, svg: `${GRAD}<rect width="512" height="512" rx="116" fill="url(#bg)"/><rect width="512" height="512" rx="116" fill="url(#sheen)"/>${SIG_MARK(1)}` },
  'icon-512': { size: 512, alpha: true, svg: `${GRAD}<rect width="512" height="512" rx="116" fill="url(#bg)"/><rect width="512" height="512" rx="116" fill="url(#sheen)"/>${SIG_MARK(1)}` },
  // full-bleed square, mark inside the 80% safe zone — Android maskable
  'maskable-192': { size: 192, alpha: false, svg: `${GRAD}<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/>${SIG_MARK(0.74)}` },
  'maskable-512': { size: 512, alpha: false, svg: `${GRAD}<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/>${SIG_MARK(0.74)}` },
  // white mark on transparency — Android 13 themed icon
  'monochrome-512': { size: 512, alpha: true, svg: SIG_MARK(0.9, '#ffffff') },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const page = await browser.newPage();
  for (const [name, v] of Object.entries(VARIANTS)) {
    await page.setViewport({ width: v.size, height: v.size, deviceScaleFactor: 1 });
    const html = `<!doctype html><style>*{margin:0}body{${v.alpha ? 'background:transparent' : ''}}</style>
      <svg xmlns="http://www.w3.org/2000/svg" width="${v.size}" height="${v.size}" viewBox="0 0 512 512">${v.svg}</svg>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(OUT, name + '.png'), omitBackground: v.alpha });
    console.log('icon', name + '.png');
  }
  await browser.close();
})();
