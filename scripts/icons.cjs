/* Renders public/icons/seseri.svg into every PNG the stores need.
 * Uses headless Edge (already a devDependency path) — no sharp/imagemagick. */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');

const S_PATH = 'M 334 184 A 78 78 0 1 0 256 262 A 78 78 0 1 1 178 340';
const GRAD = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#948af9"/><stop offset="1" stop-color="#6a5ad6"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.32" cy="0.22" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
const S_MARK = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="${S_PATH}" fill="none" stroke="rgba(20,16,50,0.22)" stroke-width="60" stroke-linecap="round" transform="translate(0 5)"/>
    <path d="${S_PATH}" fill="none" stroke="#ffffff" stroke-width="60" stroke-linecap="round"/>
  </g>`;

/** variant → svg body (512 box) + transparent? */
const VARIANTS = {
  // rounded tile, transparent corners — launcher/"any"
  'icon-192': { size: 192, alpha: true, svg: `${GRAD}<rect width="512" height="512" rx="116" fill="url(#bg)"/><rect width="512" height="512" rx="116" fill="url(#sheen)"/>${S_MARK(1)}` },
  'icon-512': { size: 512, alpha: true, svg: `${GRAD}<rect width="512" height="512" rx="116" fill="url(#bg)"/><rect width="512" height="512" rx="116" fill="url(#sheen)"/>${S_MARK(1)}` },
  // full-bleed square, mark inside the 80% safe zone — Android maskable
  'maskable-192': { size: 192, alpha: false, svg: `${GRAD}<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/>${S_MARK(0.74)}` },
  'maskable-512': { size: 512, alpha: false, svg: `${GRAD}<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#sheen)"/>${S_MARK(0.74)}` },
  // white mark on transparency — Android 13 themed icon
  'monochrome-512': { size: 512, alpha: true, svg: `<g transform="translate(256 256) scale(0.9) translate(-256 -256)"><path d="${S_PATH}" fill="none" stroke="#ffffff" stroke-width="60" stroke-linecap="round"/></g>` },
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
