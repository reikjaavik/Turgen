// Проверка данных сайта: у каждого факта есть источник, годы в пределах XX века,
// у каждого фото есть файл, подпись и источник, а в assets/photos нет лишних файлов.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { about = [], decades } = load('data/decades.json');
const { objects } = load('data/objects.json');
const { sources } = load('data/sources.json');
const ids = new Set(sources.map((s) => s.id));
const errors = [];
const err = (m) => errors.push(m);
const usedPhotos = new Set();

const checkSources = (where, list) => {
  if (!Array.isArray(list) || list.length === 0) return err(`${where}: нет источника`);
  for (const s of list) if (!ids.has(s?.id)) err(`${where}: неизвестный источник "${s?.id}"`);
};
const checkYear = (where, y) => {
  if (y != null && !(Number.isInteger(y) && y >= 1900 && y <= 2029)) err(`${where}: год ${y} вне 1900–2029`);
};
const hasText = (f) => f && (typeof f === 'string' ? f.trim() : f.ru?.trim());
const checkPhotos = (where, rec) => {
  for (const p of rec.photos ?? []) {
    usedPhotos.add(p.id);
    if (!p.id || !existsSync(new URL(`../assets/photos/${p.id}.jpg`, import.meta.url))) err(`${where}: нет файла assets/photos/${p.id}.jpg`);
    if (!existsSync(new URL(`../assets/photos/thumb/${p.id}.jpg`, import.meta.url))) err(`${where}: нет превью assets/photos/thumb/${p.id}.jpg`);
    if (!hasText(p.caption)) err(`${where}: у фото ${p.id} нет подписи`);
    checkSources(`${where} / фото ${p.id}`, p.sources);
  }
};
const checkRecord = (where, r, { needText = true } = {}) => {
  checkYear(`${where}.year`, r.year);
  checkYear(`${where}.from`, r.from);
  checkYear(`${where}.to`, r.to);
  if (r.from != null && r.to != null && r.from > r.to) err(`${where}: from больше to`);
  if (needText && !hasText(r.text)) err(`${where}: нет текста`);
  checkSources(where, r.sources);
  checkPhotos(where, r);
};

about.forEach((a, i) => checkRecord(`about[${i}]`, a));

const seen = new Set();
const personIds = new Set();
for (const d of decades) {
  if (d.decade % 10 !== 0 || d.decade < 1900 || d.decade > 2000) err(`десятилетие ${d.decade} вне шкалы`);
  if (d.decade === 2000 && !hasText(d.label)) err('период 2000 (Сегодня): нужна подпись label');
  if (d.end != null && d.end < d.decade) err(`${d.decade}: end меньше начала`);
  if (seen.has(d.decade)) err(`десятилетие ${d.decade} повторяется`);
  seen.add(d.decade);
  (d.population ?? []).forEach((r, i) => checkRecord(`${d.decade}/population[${i}]`, r));
  (d.events ?? []).forEach((r, i) => checkRecord(`${d.decade}/events[${i}]`, r));
  (d.people ?? []).forEach((r, i) => {
    const w = `${d.decade}/people[${i}]`;
    if (!hasText(r.name)) err(`${w}: нет имени`);
    if (!r.id) err(`${w}: нет id`);
    else if (personIds.has(r.id)) err(`${w}: id "${r.id}" повторяется`);
    else personIds.add(r.id);
    checkRecord(w, r);
  });
}
objects.forEach((o, i) => {
  const w = `objects[${i}]${o.id ? ` (${o.id})` : ''}`;
  if (!o.id || !hasText(o.name)) err(`${w}: нет id или названия`);
  if ((o.lat == null) !== (o.lon == null)) err(`${w}: заданы не обе координаты`);
  if (!o.present && o.from == null && o.to == null) err(`${w}: нужны from/to или present: true`);
  checkRecord(w, o, { needText: false });
});

for (const f of readdirSync(new URL('../assets/photos/', import.meta.url))) {
  if (f.endsWith('.jpg') && !usedPhotos.has(f.slice(0, -4))) err(`assets/photos/${f}: файл нигде не используется`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: десятилетий ${decades.length}, людей ${personIds.size}, объектов ${objects.length}, фото ${usedPhotos.size}, источников ${sources.length}`);
