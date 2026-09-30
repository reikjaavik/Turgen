// Собирает dist/turgen.kml — места аула для Google Earth — из data/*.json.
// Тот же KML скачивает кнопка 🌍 на сайте (js/kml.js).
// Запуск: node scripts/build-kml.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildKml } from '../js/kml.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { events } = load('data/events.json');
const { people } = load('data/people.json');
const { places } = load('data/places.json');
const { sources } = load('data/sources.json');

// Связи — как в loadAll() из js/store.js.
const eventsById = new Map(events.map((e) => [e.id, e]));
const eventPeople = new Map();
for (const p of people) for (const id of p.events ?? []) eventPeople.set(id, [...(eventPeople.get(id) ?? []), p]);

const kml = buildKml({ places, eventsById, eventPeople, sources: new Map(sources.map((s) => [s.id, s])) });
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/turgen.kml', import.meta.url), kml);
console.log(`dist/turgen.kml: ${(Buffer.byteLength(kml) / 1024).toFixed(0)} КБ, мест ${places.filter((p) => p.lat != null).length}`);
