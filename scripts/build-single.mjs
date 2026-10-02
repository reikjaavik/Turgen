// Собирает офлайн-версию сайта в один файл dist/turgen.html: стили, код, данные, схема и фото — внутри.
// Такой файл открывается двойным щелчком, без веб-сервера и без интернета.
// Замены — функциями: в минифицированном коде встречаются `$&`, `$'`, которые String.replace иначе подставит.
// Запуск: node scripts/build-single.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const read = (p, enc = 'utf8') => readFileSync(new URL(p, root), enc);

// Все файлы, которые сайт загружает через fetch.
const files = {};
for (const f of readdirSync(new URL('data/', root))) if (f.endsWith('.json') && f !== 'photo-manifest.json') files[`data/${f}`] = read(`data/${f}`);
for (const f of readdirSync(new URL('data/i18n/', root))) files[`data/i18n/${f}`] = read(`data/i18n/${f}`);
files['assets/map/base.svg'] = read('assets/map/base.svg');
files['assets/map/base.geojson'] = read('assets/map/base.geojson');

// Исторические слои карты (картинки старых планов) → data URI прямо в data/overlays.json.
const overlays = JSON.parse(files['data/overlays.json']);
for (const o of overlays.overlays) o.image = `data:image/png;base64,${read(o.image, null).toString('base64')}`;
files['data/overlays.json'] = JSON.stringify(overlays);

// Фото → data URI.
const photos = {};
for (const dir of ['assets/photos/', 'assets/photos/thumb/']) {
  for (const f of readdirSync(new URL(dir, root))) {
    if (f.endsWith('.jpg')) photos[dir + f] = `data:image/jpeg;base64,${read(dir + f, null).toString('base64')}`;
  }
}

// Подмена fetch и путей к фото.
const prelude = `
const __FILES__ = ${JSON.stringify(files)};
const __PHOTOS__ = ${JSON.stringify(photos)};
const __fetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  const key = String(url).replace(/^\\.?\\//, '');
  if (key in __FILES__) return new Response(__FILES__[key], { status: 200 });
  return __fetch(url, opts);
};
const __fix = (img) => { const s = img.getAttribute('src'); if (s && s in __PHOTOS__) img.setAttribute('src', __PHOTOS__[s]); };
new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'attributes') __fix(m.target);
    for (const n of m.addedNodes ?? []) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') __fix(n);
      n.querySelectorAll?.('img').forEach(__fix);
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
`;

const js = await build({ entryPoints: [fileURLToPath(new URL('js/app.js', root))], bundle: true, format: 'iife', write: false, minify: true });
const css = read('css/style.css');
let html = read('index.html')
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${css}</style>`)
  .replace('<link rel="stylesheet" href="vendor/maplibre-gl/maplibre-gl.css">', () => `<style>${read('vendor/maplibre-gl/maplibre-gl.css')}</style>`)
  .replace('<script src="vendor/maplibre-gl/maplibre-gl.js"></script>', () => `<script>${read('vendor/maplibre-gl/maplibre-gl.js').replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(/<script type="importmap">.*?<\/script>\n?/s, '') // three.js уже в бандле
  .replace('<script type="module" src="js/app.js"></script>', () =>
    `<script>${prelude.replace(/<\/script/gi, '<\\/script')}</script>\n<script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/turgen.html', root), html);
console.log(`dist/turgen.html: ${(Buffer.byteLength(html) / 1048576).toFixed(1)} МБ, фото ${Object.keys(photos).length}`);
