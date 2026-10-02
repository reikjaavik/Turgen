// Загрузка данных и связи между ними: человек — событие — место — время — источник.
async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const db = {
  project: null, decades: [], intro: [], eras: [], erasNote: null, overlays: [], events: [], people: [], groups: [], places: [], sources: new Map(),
  byId: { event: new Map(), person: new Map(), place: new Map(), group: new Map() },
  eventPeople: new Map(), // id события → люди
  eventPlaces: new Map(), // id события → места
  photos: [],             // [{ photo, owner: { type, id } }]
  photoById: new Map(),
};

export async function loadAll() {
  const [project, dec, ev, pp, pl, src, er, ov] = await Promise.all([
    json('data/project.json'), json('data/decades.json'), json('data/events.json'),
    json('data/people.json'), json('data/places.json'), json('data/sources.json'), json('data/eras.json'), json('data/overlays.json'),
  ]);
  db.eras = er.eras;
  db.overlays = ov.overlays;
  db.erasNote = er.note;
  db.project = project;
  db.decades = dec.decades;
  db.intro = dec.intro ?? [];
  db.events = ev.events;
  db.people = pp.people;
  db.groups = pp.groups;
  db.places = pl.places;
  db.sources = new Map(src.sources.map((s) => [s.id, s]));

  for (const e of db.events) db.byId.event.set(e.id, e);
  for (const p of db.people) db.byId.person.set(p.id, p);
  for (const p of db.places) db.byId.place.set(p.id, p);
  for (const g of db.groups) db.byId.group.set(g.id, g);

  for (const p of db.people) {
    for (const id of p.events ?? []) push(db.eventPeople, id, p);
  }
  for (const e of db.events) for (const id of e.places ?? []) addUnique(db.eventPlaces, id, db.byId.place.get(id));
  for (const pl of db.places) for (const id of pl.events ?? []) addUnique(db.eventPlaces, id, pl);

  const addPhotos = (type, list) => list.forEach((x) => (x.photos ?? []).forEach((photo) => {
    const rec = { photo, owner: { type, id: x.id } };
    db.photos.push(rec);
    db.photoById.set(photo.id, rec);
  }));
  addPhotos('event', db.events);
  addPhotos('person', db.people);
  addPhotos('place', db.places);
}

function push(map, key, val) { if (!map.has(key)) map.set(key, []); map.get(key).push(val); }
function addUnique(map, key, val) { if (!val) return; push(map, key, val); map.set(key, [...new Set(map.get(key))]); }

// ---- время ----
export const decadeEnd = (d) => d.end ?? d.decade + 9;
export const decadeOf = (n) => db.decades.find((d) => d.decade === n);

// Десятилетия, к которым относится запись: явный список decades или пересечение [from/year, to/year].
export function decadesOf(rec) {
  if (rec.decades) return rec.decades;
  const from = rec.from ?? rec.year;
  const to = rec.to ?? rec.year ?? Infinity;
  if (from == null) return [];
  return db.decades.filter((d) => from <= decadeEnd(d) && to >= d.decade).map((d) => d.decade);
}

export const eventsInDecade = (n) => db.events.filter((e) => decadesOf(e).includes(n));

export function personDecades(p) {
  const set = new Set();
  for (const id of p.events ?? []) for (const d of decadesOf(db.byId.event.get(id) ?? {})) set.add(d);
  return [...set].sort((a, b) => a - b);
}

export function peopleInDecade(n) {
  return db.people.filter((p) => personDecades(p).includes(n));
}

// Место видно в десятилетии: present — только в «Сегодня»; иначе по from/to или по связанным событиям.
export function placeInDecade(pl, n) {
  const d = decadeOf(n);
  const start = n, end = d ? decadeEnd(d) : n + 9;
  if (pl.present) return end >= 2000;
  if (pl.from != null || pl.to != null) return (pl.from ?? -Infinity) <= end && (pl.to ?? Infinity) >= start;
  return (pl.events ?? []).some((id) => decadesOf(db.byId.event.get(id) ?? {}).includes(n));
}

// Хронологический порядок событий; sort — явная позиция для периодов без точной даты
// (порядок взят из «Краткой хронологической линии» проекта).
export const sortKey = (e) => (e.sort ?? e.year ?? e.from ?? (e.decades ? e.decades[0] + 0.5 : 9999));
export const chronological = (list) => [...list].sort((a, b) => sortKey(a) - sortKey(b));

// Портрет человека — первое фото.
export const portrait = (p) => p.photos?.[0]?.id ?? null;
