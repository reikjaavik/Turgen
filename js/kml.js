// Выгрузка мест аула в KML — для Google Earth (веб-версия и Google Earth Pro).
// Без DOM: используется и сайтом (кнопка 🌍), и scripts/build-kml.mjs.

const COLORS = { village: 'ff224f9a', social: 'ff866f3f', economy: 'ff2a7d5f', memory: 'ff2b33a0' }; // aabbggrr
const GROUP_NAMES = { village: 'Центр аула', social: 'Социальные объекты', economy: 'Хозяйство и производство', memory: 'Память' };
const ICON = 'https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';

const groupOf = (type) => (type === 'village' ? 'village' : type === 'memorial' ? 'memory'
  : ['farm', 'industry', 'building'].includes(type) ? 'economy' : 'social');
const ru = (f) => (typeof f === 'string' ? f : f?.ru ?? '');
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

// С какого года место есть на схеме — по тем же правилам, что на сайте.
function beginYear(pl, eventsById) {
  if (pl.present) return 2000;
  if (pl.from != null) return pl.from;
  const ys = (pl.events ?? []).map((id) => eventsById.get(id)).filter(Boolean).map((e) => e.year ?? e.from ?? e.decades?.[0]).filter((y) => y != null);
  return ys.length ? Math.min(...ys) : null;
}

function circle(lat, lon, r, n = 48) {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push(`${(lon + dLon * Math.cos(a)).toFixed(6)},${(lat + dLat * Math.sin(a)).toFixed(6)},0`);
  }
  return pts.join(' ');
}

function sourcesText(list, sources) {
  return (list ?? []).map(({ id, ref }) => {
    const name = sources.get(id)?.short ?? id;
    return ref ? `${name}, ${ref}` : name;
  }).join('; ');
}

export function buildKml({ places, eventsById, eventPeople, sources }) {
  const folders = [
    { title: 'Центр аула — с 1903 года', match: (pl) => pl.type === 'village' },
    { title: 'Память — с 1970-х', match: (pl) => pl.type === 'memorial' },
    { title: 'Сегодня — социальные объекты', match: (pl) => pl.present && groupOf(pl.type) === 'social' },
    { title: 'Сегодня — хозяйство и производство', match: (pl) => pl.present && groupOf(pl.type) === 'economy' },
  ];
  const used = new Set();

  const placemark = (pl) => {
    const g = groupOf(pl.type);
    const begin = beginYear(pl, eventsById);
    const evs = (pl.events ?? []).map((id) => eventsById.get(id)).filter(Boolean);
    const people = new Set(evs.flatMap((e) => (eventPeople.get(e.id) ?? []).map((p) => p.id)));
    const desc = [
      pl.text ? `<p>${xml(ru(pl.text))}</p>` : '',
      evs.length ? `<p><b>События:</b><br>${evs.map((e) => `${xml(e.when)} — ${xml(ru(e.title))}`).join('<br>')}</p>` : '',
      people.size ? `<p><b>Люди, связанные с этими событиями:</b> ${people.size} (истории и фото — на сайте проекта)</p>` : '',
      pl.approx ? '<p><i>Место показано примерно (зона): требует проверки.</i></p>' : '',
      `<p><small>Источник: ${xml(sourcesText(pl.sources, sources))}</small></p>`,
    ].join('');
    const time = begin != null ? `<TimeSpan><begin>${begin}</begin></TimeSpan>` : '';
    const point = `<Placemark><name>${xml((pl.approx ? '≈ ' : '') + ru(pl.short ?? pl.name))}</name>${time}<styleUrl>#${g}</styleUrl>`
      + `<description>${cdata(`<h3>${xml(ru(pl.name))}</h3>${desc}`)}</description>`
      + `<Point><coordinates>${pl.lon},${pl.lat},0</coordinates></Point></Placemark>`;
    const zone = pl.approx
      ? `<Placemark><name>${xml(`Примерная зона: ${ru(pl.short ?? pl.name)}`)}</name>${time}<styleUrl>#zone-${g}</styleUrl>`
        + `<Polygon><outerBoundaryIs><LinearRing><coordinates>${circle(pl.lat, pl.lon, pl.approx.radius)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
      : '';
    return point + zone;
  };

  const placed = places.filter((pl) => pl.lat != null && pl.lon != null);
  const body = folders.map((f) => {
    const items = placed.filter((pl) => !used.has(pl.id) && f.match(pl));
    items.forEach((pl) => used.add(pl.id));
    return items.length ? `<Folder><name>${xml(f.title)}</name>${items.map(placemark).join('')}</Folder>` : '';
  }).join('');
  const rest = placed.filter((pl) => !used.has(pl.id));
  const other = rest.length ? `<Folder><name>Другие места</name>${rest.map(placemark).join('')}</Folder>` : '';

  const styles = Object.entries(COLORS).map(([g, c]) => {
    const fill = `66${c.slice(2)}`;
    return `<Style id="${g}"><IconStyle><color>${c}</color><scale>1.1</scale><Icon><href>${ICON}</href></Icon></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>`
      + `<Style id="zone-${g}"><LineStyle><color>${c}</color><width>2</width></LineStyle><PolyStyle><color>${fill}</color></PolyStyle></Style>`;
  }).join('');

  const about = 'Места аула Турген (до 2007 года — Тургеневка), Аршалынский район Акмолинской области. '
    + 'Турген — это не только место. Это люди, события и память. '
    + 'Расположение мест отмечено автором проекта; места с «≈» показаны примерно. '
    + `Цвета: ${Object.values(GROUP_NAMES).join(', ')}. Фото, люди и полная история — на сайте проекта.`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>Турген — места по времени</name>
<description>${cdata(`<p>${xml(about)}</p>`)}</description>
<LookAt><longitude>72.3215</longitude><latitude>50.7625</latitude><altitude>0</altitude><range>2600</range><tilt>45</tilt><heading>-15</heading><altitudeMode>relativeToGround</altitudeMode></LookAt>
${styles}
${body}${other}
</Document>
</kml>
`;
}
