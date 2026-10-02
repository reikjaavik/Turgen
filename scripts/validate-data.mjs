// Проверка данных: у каждого факта есть источник, связи ведут на существующие записи,
// годы в пределах 1900–2029, у фото есть файл, превью, подпись и источник, лишних файлов нет.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { intro = [], decades } = load('data/decades.json');
const { events } = load('data/events.json');
const { people, groups } = load('data/people.json');
const { places } = load('data/places.json');
const { sources } = load('data/sources.json');
const project = load('data/project.json');
const { overlays } = load('data/overlays.json');

const errors = [];
const err = (m) => errors.push(m);
const srcIds = new Set(sources.map((s) => s.id));
const usedPhotos = new Set();
const hasText = (f) => f && (typeof f === 'string' ? f.trim() : f.ru?.trim());

function ids(list, kind) {
  const set = new Set();
  list.forEach((x, i) => {
    if (!x.id) err(`${kind}[${i}]: нет id`);
    else if (set.has(x.id)) err(`${kind}: id "${x.id}" повторяется`);
    set.add(x.id);
  });
  return set;
}
const eventIds = ids(events, 'events');
const personIds = ids(people, 'people');
const placeIds = ids(places, 'places');
const groupIds = ids(groups, 'groups');
const themeIds = ids(project.themes, 'themes');

const checkSources = (where, list) => {
  if (!Array.isArray(list) || list.length === 0) return err(`${where}: нет источника`);
  for (const s of list) if (!srcIds.has(s?.id)) err(`${where}: неизвестный источник "${s?.id}"`);
};
const checkYear = (where, y) => {
  if (y != null && !(Number.isInteger(y) && y >= 1900 && y <= 2029)) err(`${where}: год ${y} вне 1900–2029`);
};
const checkRefs = (where, list, set, kind) => {
  for (const id of list ?? []) if (!set.has(id)) err(`${where}: нет ${kind} "${id}"`);
};
const checkPhotos = (where, rec) => {
  for (const p of rec.photos ?? []) {
    if (usedPhotos.has(p.id)) err(`${where}: фото ${p.id} уже использовано в другой записи`);
    usedPhotos.add(p.id);
    if (!existsSync(new URL(`../assets/photos/${p.id}.jpg`, import.meta.url))) err(`${where}: нет файла assets/photos/${p.id}.jpg`);
    if (!existsSync(new URL(`../assets/photos/thumb/${p.id}.jpg`, import.meta.url))) err(`${where}: нет превью assets/photos/thumb/${p.id}.jpg`);
    if (!hasText(p.caption)) err(`${where}: у фото ${p.id} нет подписи`);
    checkSources(`${where} / фото ${p.id}`, p.sources);
  }
};
const checkTime = (where, r) => {
  checkYear(`${where}.year`, r.year);
  checkYear(`${where}.from`, r.from);
  checkYear(`${where}.to`, r.to);
  if (r.from != null && r.to != null && r.from > r.to) err(`${where}: from больше to`);
  for (const d of r.decades ?? []) if (!decades.some((x) => x.decade === d)) err(`${where}: нет десятилетия ${d}`);
};

intro.forEach((x, i) => { if (!hasText(x.text)) err(`intro[${i}]: нет текста`); checkSources(`intro[${i}]`, x.sources); });

const seen = new Set();
for (const d of decades) {
  if (d.decade % 10 !== 0 || d.decade < 1900 || d.decade > 2000) err(`десятилетие ${d.decade} вне шкалы`);
  if (d.decade === 2000 && !hasText(d.label)) err('период 2000 (Сегодня): нужна подпись label');
  if (seen.has(d.decade)) err(`десятилетие ${d.decade} повторяется`);
  seen.add(d.decade);
  (d.population ?? []).forEach((r, i) => {
    const w = `${d.decade}/population[${i}]`;
    checkYear(w, r.year);
    if (!hasText(r.text)) err(`${w}: нет текста`);
    checkSources(w, r.sources);
  });
}

// Главный принцип: у события есть время и источник.
for (const e of events) {
  const w = `event ${e.id}`;
  if (!hasText(e.title) || !hasText(e.text) || !e.when) err(`${w}: нужны title, text, when`);
  if (e.year == null && e.from == null && !e.decades?.length) err(`${w}: нет времени (year / from / decades)`);
  if (!themeIds.has(e.theme)) err(`${w}: неизвестная тема "${e.theme}"`);
  if (e.parent && !eventIds.has(e.parent)) err(`${w}: нет родительского события "${e.parent}"`);
  checkTime(w, e);
  checkRefs(w, e.places, placeIds, 'места');
  checkSources(w, e.sources);
  checkPhotos(w, e);
}
// У человека есть хотя бы одно событие (через него — время) и источник.
for (const p of people) {
  const w = `person ${p.id}`;
  if (!hasText(p.name) || !hasText(p.text)) err(`${w}: нужны name и text`);
  if (!p.events?.length) err(`${w}: не связан ни с одним событием`);
  if (!p.groups?.length) err(`${w}: не указан раздел (groups)`);
  checkRefs(w, p.events, eventIds, 'события');
  checkRefs(w, p.groups, groupIds, 'раздела');
  checkRefs(w, p.places, placeIds, 'места');
  checkSources(w, p.sources);
  checkPhotos(w, p);
}
// У места есть источник и связь с событием или период существования.
for (const pl of places) {
  const w = `place ${pl.id}`;
  if (!hasText(pl.name)) err(`${w}: нет названия`);
  if ((pl.lat == null) !== (pl.lon == null)) err(`${w}: заданы не обе координаты`);
  if (pl.approx && (pl.lat == null || !(pl.approx.radius > 0))) err(`${w}: approx требует lat/lon и radius > 0`);
  if (!pl.events?.length && !pl.present && pl.from == null) err(`${w}: не связано ни с событием, ни со временем`);
  checkTime(w, pl);
  checkRefs(w, pl.events, eventIds, 'события');
  checkSources(w, pl.sources);
  checkPhotos(w, pl);
}
for (const m of project.memories ?? []) {
  if (m.person && !personIds.has(m.person)) err(`memory: нет человека "${m.person}"`);
  checkSources('memory', m.sources);
}

for (const f of readdirSync(new URL('../assets/photos/', import.meta.url))) {
  if (f.endsWith('.jpg') && !usedPhotos.has(f.slice(0, -4))) err(`assets/photos/${f}: файл нигде не используется`);
}

// Исторические слои карты (старые планы): десятилетия, углы, картинка, фото-документ и источники.
const overlayIds = ids(overlays, 'overlays');
for (const o of overlays) {
  const w = `overlays.${o.id}`;
  if (!hasText(o.title) || !hasText(o.text)) err(`${w}: нет названия или пояснения`);
  checkSources(w, o.sources);
  if (!Array.isArray(o.decades) || !o.decades.length) err(`${w}: нет десятилетий`);
  for (const d of o.decades ?? []) if (!decades.some((x) => x.decade === d)) err(`${w}: нет десятилетия ${d}`);
  if (!Array.isArray(o.corners) || o.corners.length !== 4 || o.corners.some((c) => !(c.length === 2 && c[0] > 72 && c[0] < 73 && c[1] > 50 && c[1] < 51))) err(`${w}: углы — четыре точки [lon, lat]`);
  if (!existsSync(new URL(`../${o.image}`, import.meta.url))) err(`${w}: нет файла ${o.image}`);
  if (o.photo && !usedPhotos.has(o.photo)) err(`${w}: фото ${o.photo} нет в фотоархиве`);
}
void overlayIds;

// Внешних ссылок на сайте быть не должно: названия источников — только текстом.
const externalUrl = /https?:\/\/(?!localhost)/;
for (const f of ['data/decades.json', 'data/events.json', 'data/people.json', 'data/places.json', 'data/sources.json', 'data/project.json', 'data/eras.json', 'data/overlays.json', 'index.html']) {
  const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/xmlns='?"?[^'" ]*'?"?/g, '');
  if (externalUrl.test(text)) err(`${f}: внешняя ссылка (адреса сайтов на сайте не нужны)`);
}
for (const s of sources) if (s.url) err(`источник ${s.id}: поле url не нужно`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: событий ${events.length}, людей ${people.length}, мест ${places.length}, фото ${usedPhotos.size}, источников ${sources.length}`);
