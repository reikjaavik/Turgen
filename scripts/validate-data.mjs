// Проверка данных сайта: у каждого факта есть источник, годы в пределах XX века, фото существуют.
import { readFileSync, existsSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { decades } = load('data/decades.json');
const { objects } = load('data/objects.json');
const { sources } = load('data/sources.json');
const ids = new Set(sources.map((s) => s.id));
const errors = [];
const err = (m) => errors.push(m);

const checkSources = (where, rec) => {
  if (!Array.isArray(rec.sources) || rec.sources.length === 0) err(`${where}: нет источника`);
  else for (const s of rec.sources) if (!ids.has(s)) err(`${where}: неизвестный источник "${s}"`);
};
const checkYear = (where, y) => {
  if (y != null && !(Number.isInteger(y) && y >= 1900 && y <= 1999)) err(`${where}: год ${y} вне 1900–1999`);
};
const checkPhotos = (where, rec) => {
  for (const p of rec.photos ?? []) {
    if (!p.src || !existsSync(new URL(`../${p.src}`, import.meta.url))) err(`${where}: нет файла ${p.src}`);
    if (!p.sources?.length) err(`${where}: у фото ${p.src} нет источника`);
  }
};

const seen = new Set();
for (const d of decades) {
  if (d.decade % 10 !== 0 || d.decade < 1900 || d.decade > 1990) err(`десятилетие ${d.decade} вне шкалы`);
  if (seen.has(d.decade)) err(`десятилетие ${d.decade} повторяется`);
  seen.add(d.decade);
  for (const [kind, list] of [['population', d.population], ['events', d.events], ['people', d.people]]) {
    (list ?? []).forEach((r, i) => {
      const w = `${d.decade}/${kind}[${i}]`;
      checkYear(w, r.year);
      if (kind === 'population' && r.value == null) err(`${w}: нет значения`);
      if (kind === 'events' && !r.text) err(`${w}: нет текста`);
      if (kind === 'people' && !r.name) err(`${w}: нет имени`);
      checkSources(w, r);
      checkPhotos(w, r);
    });
  }
}
objects.forEach((o, i) => {
  const w = `objects[${i}]${o.id ? ` (${o.id})` : ''}`;
  if (!o.id || !o.name) err(`${w}: нет id или названия`);
  checkYear(`${w}.from`, o.from);
  checkYear(`${w}.to`, o.to);
  if ((o.lat == null) !== (o.lon == null)) err(`${w}: заданы не обе координаты`);
  checkSources(w, o);
  checkPhotos(w, o);
});

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: десятилетий ${decades.length}, объектов ${objects.length}, источников ${sources.length}`);
