// Строит assets/map/base.svg (2D) и assets/map/base.geojson (3D) из выгрузки OpenStreetMap (data/raw/turgen.osm) и контуров зданий
// Overture Maps (data/raw/overture-buildings.geojson: Microsoft ML Buildings + OSM, лицензия ODbL).
// Если есть data/raw/genplan-2020.geojson (генеральный план с. Турген, ТОО «Колдау», 2020; см. scripts/genplan/),
// то улицы села, здания, кварталы, участки и зоны берутся из него: здания — по плану там, где они на нём показаны,
// иначе остаются контуры Overture; поверх плана — только существующее положение, проектные кварталы не рисуются.
// Запуск: node scripts/build-base-map.mjs [центр_lat центр_lon ширина_м]
// Выгрузка: curl "https://api.openstreetmap.org/api/0.6/map?bbox=W,S,E,N" -o data/raw/turgen.osm
// Данные © участники OpenStreetMap; Microsoft; Overture Maps Foundation — лицензия ODbL.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const W = 800, H = 560;
// Охват: село и площадки МТМ и стоянки к северу от него (как начальный вид 3D-карты в js/map3d.js).
const [cLat = 50.76675, cLon = 72.32125, widthM = 4000] = process.argv.slice(2).map(Number);
const M_PER_DEG_LAT = 111320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((cLat * Math.PI) / 180);
const heightM = (widthM * H) / W;
const view = {
  minLat: cLat - heightM / 2 / M_PER_DEG_LAT, maxLat: cLat + heightM / 2 / M_PER_DEG_LAT,
  minLon: cLon - widthM / 2 / mPerDegLon, maxLon: cLon + widthM / 2 / mPerDegLon,
};
const px = (lat, lon) => [
  ((lon - view.minLon) / (view.maxLon - view.minLon)) * W,
  ((view.maxLat - lat) / (view.maxLat - view.minLat)) * H,
];

const xml = readFileSync(new URL('../data/raw/turgen.osm', import.meta.url), 'utf8');
const nodes = new Map();
for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([\d.-]+)" lon="([\d.-]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
const ways = [];
for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
  const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => r[1]);
  const tags = Object.fromEntries([...m[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)].map((t) => [t[1], t[2]]));
  ways.push({ id: m[1], tags, pts: refs.map((r) => nodes.get(r)).filter(Boolean) });
}
const d = (pts, close) => pts.map(([la, lo], i) => `${i ? 'L' : 'M'}${px(la, lo).map((v) => v.toFixed(1)).join(' ')}`).join('') + (close ? 'Z' : '');
const inView = (pts) => pts.some(([la, lo]) => la >= view.minLat && la <= view.maxLat && lo >= view.minLon && lo <= view.maxLon);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const layers = { farmland: [], residential: [], zones: [], quarters: [], parcels: [], river: [], roads: [], buildings: [] };
// Те же слои в GeoJSON для 3D-вида: [lon, lat], округление до 6 знаков.
const features = [];
const ll = (pts) => pts.map(([la, lo]) => [+lo.toFixed(6), +la.toFixed(6)]);
const feat = (kind, geometry, props = {}) => features.push({ type: 'Feature', properties: { kind, ...props }, geometry });
const ROAD = { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'mid', unclassified: 'mid', residential: 'street', service: 'minor' };
for (const w of ways) {
  if (w.pts.length < 2 || !inView(w.pts)) continue;
  const t = w.tags;
  if (t.landuse === 'farmland') { layers.farmland.push(`<path d="${d(w.pts, true)}"/>`); feat('farmland', { type: 'Polygon', coordinates: [ll(w.pts)] }); }
  else if (t.landuse === 'residential') { layers.residential.push(`<path d="${d(w.pts, true)}"/>`); feat('residential', { type: 'Polygon', coordinates: [ll(w.pts)] }); }
  else if (t.waterway) { layers.river.push(`<path d="${d(w.pts)}"/>`); feat('river', { type: 'LineString', coordinates: ll(w.pts) }); }
  else if (t.highway && ROAD[t.highway]) { layers.roads.push(`<path class="road-${ROAD[t.highway]}" d="${d(w.pts)}"${t.name ? ` data-name="${esc(t.name)}"` : ''}/>`); feat('road', { type: 'LineString', coordinates: ll(w.pts) }, { road: ROAD[t.highway] }); }
  else if (t.building) layers.buildings.push(`<path d="${d(w.pts, true)}"/>`);
}

// Условная высота для 3D: реальных высот в данных нет, поэтому по площади — дом ≈ 1 этаж, крупные постройки выше.
function conventionalHeight(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][1] * mPerDegLon) * (pts[i][0] * M_PER_DEG_LAT) - (pts[i][1] * mPerDegLon) * (pts[j][0] * M_PER_DEG_LAT);
  }
  const area = Math.abs(a / 2);
  return area < 150 ? 4 : area < 600 ? 6 : 8;
}

// Генплан 2020: улицы, здания, кварталы, участки, зоны (data/raw/genplan-2020.geojson).
const GENPLAN = new URL('../data/raw/genplan-2020.geojson', import.meta.url);
const OVERTURE = new URL('../data/raw/overture-buildings.geojson', import.meta.url);
const polyCoords = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
if (existsSync(GENPLAN)) {
  const plan = JSON.parse(readFileSync(GENPLAN, 'utf8'));
  // Улицы, которых не было в основе, и названия улиц — со скриншота карты села от автора сайта (scripts/streets/, data/raw/streets-2026.geojson).
  const STREETS = new URL('../data/raw/streets-2026.geojson', import.meta.url);
  const extra = existsSync(STREETS) ? JSON.parse(readFileSync(STREETS, 'utf8')) : { features: [], labels: [] };
  plan.features.push(...extra.features);
  const flat = (coords) => coords.map(([lon, lat]) => [lat, lon]);
  const kinds = { zones: [], quarters: [], parcels: [] };
  layers.roads = []; layers.buildings = [];
  // Для прошлых десятилетий — «свои логичные улицы»: улица появляется в том десятилетии, когда застройка (число домов периода,
  // data/eras.json) доходит до неё от центра села. Радиус периода — расстояние до последнего из N «участков под жильё», как в js/recon/layout.js.
  const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const placesAll = readJson('../data/places.json').places.filter((p) => p.lat != null);
  const eraList = readJson('../data/eras.json').eras;
  const toM = (lat, lon) => [(lon - cLon) * mPerDegLon, (lat - cLat) * M_PER_DEG_LAT];
  const placeXY = placesAll.map((p) => toM(p.lat, p.lon));
  const social = ['dom-kultury', 'pochta', 'shkola', 'kontora', 'magaziny', 'monument-vov'].map((id) => placesAll.find((p) => p.id === id)).filter(Boolean).map((p) => toM(p.lat, p.lon));
  const core = [social.reduce((a, q) => a + q[0], 0) / social.length, social.reduce((a, q) => a + q[1], 0) / social.length];
  const areaM2 = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const A = toM(ring[j][1], ring[j][0]), B = toM(ring[i][1], ring[i][0]); a += A[0] * B[1] - B[0] * A[1]; } return Math.abs(a / 2); };
  const plotDist = [];
  for (const f of plan.features) {
    if (f.properties.kind !== 'building') continue;
    for (const rings of polyCoords(f.geometry)) {
      const ring = rings[0];
      if (areaM2(ring) >= 260) continue;
      const c = toM(ring.reduce((a, q) => a + q[1], 0) / ring.length, ring.reduce((a, q) => a + q[0], 0) / ring.length);
      if (placeXY.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 14)) continue;
      plotDist.push(Math.hypot(c[0] - core[0], c[1] - core[1]));
    }
  }
  plotDist.sort((a, b) => a - b);
  const radii = eraList.filter((e) => e.scene.houses != null).map((e) => ({ decade: e.decade, r: (plotDist[Math.min(e.scene.houses, plotDist.length) - 1] ?? 0) + 40 }));
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const lineDist = (p, pts) => { let m = Infinity; for (let i = 1; i < pts.length; i++) m = Math.min(m, segDist(p, pts[i - 1], pts[i])); return m; };
  // Асфальт «Сегодня»: по документам асфальтировано лишь 640 м из 3,9 км улиц, где именно — не показано (точки съёмки «асфальт» стоят у
  // торцов построек фермы, а не на дорогах), поэтому по решению автора асфальт — только на главных дорогах (major, mid): допущение.
  const roadsM = new Map(plan.features.filter((f) => f.properties.kind === 'road').map((f) => [f, f.geometry.coordinates.map(([lon, lat]) => toM(lat, lon))]));
  const sinceOf = (f) => {
    const len = roadsM.get(f).reduce((acc, q, i, arr) => acc + (i ? Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) : 0), 0);
    if (f.properties.road === 'major' || (f.properties.road === 'mid' && len > 600)) return 1900; // дороги района существовали и раньше
    const dmin = lineDist(core, roadsM.get(f)); // ближайшая к центру точка улицы
    return Math.max(1960, (radii.find((e) => e.r >= dmin - 15)?.decade) ?? 2000); // современная сетка улиц — не раньше 1960-х
  };
  // Названия улиц на старом плане (1960–1980-е): подпись → ближайшая улица (до 45 м), одна подпись — одной улице.
  const oldNames = new Map();
  const labelsOld = readJson('../data/raw/oldplan-street-labels.json').labels;
  // Сначала улицы плана; улицы, добавленные со скриншота 2026 года, получают старое название, только если у плана подходящей улицы нет.
  const namedOld = new Set();
  for (const pass of [0, 1]) for (const lb of labelsOld) {
    if (namedOld.has(lb)) continue;
    const q = toM(lb.lat, lb.lon);
    let best = null;
    for (const [f, pts] of roadsM) { if (f.properties.road === 'major' || (pass === 0) !== (f.properties.src !== 'streets-2026')) continue; const dd = lineDist(q, pts); if (dd < 45 && (!best || dd < best.dd)) best = { f, dd }; }
    if (best) { namedOld.add(lb); if (!oldNames.has(best.f)) oldNames.set(best.f, lb.name); }
  }
  // Современные названия: точка подписи лежит на улице (до 18 м) и не у её конца — чтобы переулок, упирающийся в улицу, не получил её имя.
  for (const lb of extra.labels ?? []) {
    const q = toM(lb.lat, lb.lon);
    for (const [f, pts] of roadsM) {
      if (f.properties.road === 'major' || lineDist(q, pts) > 18) continue;
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 30 || Math.hypot(q[0] - b[0], q[1] - b[1]) < 30) continue;
      f.properties.name = lb.name;
    }
  }
  for (let i = features.length - 1; i >= 0; i--) if (features[i].properties.kind === 'road') features.splice(i, 1);
  // фон из OSM (поля, жилая зона) оставляем; реку тоже; дороги и здания — из плана
  for (const f of plan.features) {
    const k = f.properties.kind, g = f.geometry;
    if (k === 'road') {
      const pts = flat(g.coordinates);
      if (!inView(pts)) continue;
      const road = f.properties.road, since = sinceOf(f), oldName = oldNames.get(f);
      const asphalt = !f.properties.gen && (road === 'major' || road === 'mid');
      const mid = px(...pts[Math.floor((pts.length - 1) / 2)]);
      layers.roads.push(`<path class="road-${road}" d="${d(pts)}" data-since="${since}"${asphalt ? ' data-asphalt="1"' : ''}${f.properties.name ? ` data-name="${esc(f.properties.name)}"` : ''}${oldName ? ` data-old="${esc(oldName)}"` : ''} data-lx="${mid[0].toFixed(1)}" data-ly="${mid[1].toFixed(1)}"/>`);
      feat('road', { type: 'LineString', coordinates: ll(pts) }, { road, since, ...(asphalt ? { asphalt: true } : {}), ...(f.properties.name ? { name: f.properties.name } : {}), ...(oldName ? { oldName } : {}) });
    } else if (k === 'building') {
      for (const rings of polyCoords(g)) {
        const pts = flat(rings[0]);
        if (!inView(pts)) continue;
        layers.buildings.push(`<path d="${d(pts, true)}"/>`);
        const props = { h: conventionalHeight(pts), src: f.properties.src };
        if (f.properties.label) props.label = f.properties.label;
        if (f.properties.num) props.num = f.properties.num;
        feat('building', { type: 'Polygon', coordinates: [ll(pts)] }, props);
      }
    } else if (k === 'quarter' || k === 'zone') {
      const pts = flat(g.coordinates[0]);
      if (!inView(pts)) continue;
      (k === 'zone' ? kinds.zones : kinds.quarters).push(`<path d="${d(pts, true)}"${k === 'zone' ? ` class="zone-${f.properties.zone}"` : ''}/>`);
      feat(k, { type: 'Polygon', coordinates: [ll(pts)] }, k === 'zone' ? { zone: f.properties.zone } : {});
    } else if (k === 'parcel') {
      const pts = flat(g.coordinates);
      if (!inView(pts)) continue;
      kinds.parcels.push(`<path d="${d(pts, f.properties.closed)}"/>`);
      feat('parcel', { type: 'LineString', coordinates: ll(pts) });
    }
  }
  // 1900–1950-е: «свои логичные улицы». Источников о планировке тех лет нет, поэтому улицы условные: цельная сельская улица через центр,
  // её продолжения и параллельная улица, которые растут с числом домов периода; в 1960-х сеть сменяется той, что выведена из плана.
  const AX = (12 * Math.PI) / 180, U = [Math.sin(AX), Math.cos(AX)], NR = [Math.cos(AX), -Math.sin(AX)];
  const fromM = ([x, y]) => [cLat + y / M_PER_DEG_LAT, cLon + x / mPerDegLon];
  const genLine = (origin, dir, side, t0, t1, bend) => {
    const pts = [];
    const n = Math.max(2, Math.ceil((t1 - t0) / 15));
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n, lat = bend ? (t * t) / 2800 : 0;
      pts.push(fromM([origin[0] + dir[0] * t + side[0] * lat, origin[1] + dir[1] * t + side[1] * lat]));
    }
    return pts;
  };
  const GEN = [];
  const aulXY = placesAll.find((p) => p.id === 'aul') ? toM(placesAll.find((p) => p.id === 'aul').lat, placesAll.find((p) => p.id === 'aul').lon) : core;
  const A = aulXY, B = [aulXY[0] + NR[0] * 120, aulXY[1] + NR[1] * 120]; // улицы условного старого села — у отмеченного центра аула
  const seg = (origin, ranges, since, id, bend = true) => ranges.forEach(([a, b], i) => GEN.push({ pts: genLine(origin, U, NR, a, b, bend), since, id: `${id}${i}` }));
  seg(A, [[-90, 90]], 1900, 'gen-a0'); seg(A, [[90, 135], [-135, -90]], 1910, 'gen-a1'); seg(A, [[135, 180], [-180, -135]], 1920, 'gen-a2');
  seg(A, [[180, 200], [-200, -180]], 1930, 'gen-a3'); seg(A, [[200, 220], [-220, -200]], 1940, 'gen-a4'); seg(A, [[220, 260], [-260, -220]], 1950, 'gen-a5');
  seg(B, [[-100, 100]], 1930, 'gen-b0'); seg(B, [[100, 180], [-180, -100]], 1950, 'gen-b1');
  GEN.push({ pts: genLine(A, NR, U, -60, 130, false), since: 1950, id: 'gen-lane' });
  for (const g of GEN) {
    layers.roads.push(`<path class="road-street" d="${d(g.pts)}" data-since="${g.since}" data-until="1950"/>`);
    feat('road', { type: 'LineString', coordinates: ll(g.pts) }, { road: 'street', since: g.since, until: 1950, gen: true, id: g.id });
  }
  Object.assign(layers, kinds);
} else if (existsSync(OVERTURE)) {
  // Без плана: здания Overture (в них уже есть и здания из OSM), иначе — здания OSM.
  const fc = JSON.parse(readFileSync(OVERTURE, 'utf8'));
  layers.buildings = [];
  for (const f of fc.features) {
    for (const rings of polyCoords(f.geometry)) {
      const pts = rings[0].map(([lon, lat]) => [lat, lon]);
      if (!inView(pts)) continue;
      layers.buildings.push(`<path d="${d(pts, true)}"/>`);
      feat('building', { type: 'Polygon', coordinates: [ll(pts)] }, { h: conventionalHeight(pts) });
    }
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-min-lat="${view.minLat}" data-max-lat="${view.maxLat}" data-min-lon="${view.minLon}" data-max-lon="${view.maxLon}" data-scale-m="${widthM / W}">
<g class="base-farmland">${layers.farmland.join('')}</g>
<g class="base-residential">${layers.residential.join('')}</g>
<g class="base-zones">${layers.zones.join('')}</g>
<g class="base-quarters">${layers.quarters.join('')}</g>
<g class="base-parcels">${layers.parcels.join('')}</g>
<g class="base-river">${layers.river.join('')}</g>
<g class="base-roads">${layers.roads.join('')}</g>
<g class="base-buildings">${layers.buildings.join('')}</g>
</svg>
`;
writeFileSync(new URL('../assets/map/base.svg', import.meta.url), svg);
writeFileSync(new URL('../assets/map/base.geojson', import.meta.url), JSON.stringify({
  type: 'FeatureCollection',
  bounds: [view.minLon, view.minLat, view.maxLon, view.maxLat],
  attribution: '© OpenStreetMap contributors; Microsoft ML Buildings; Overture Maps Foundation (ODbL); генеральный план с. Турген (ТОО «Колдау», 2020); часть улиц и названия улиц — по скриншоту карты села от автора сайта (Яндекс Карты, 2026)',
  features,
}));
console.log(`base.svg: ${Object.entries(layers).map(([k, v]) => `${k}=${v.length}`).join(' ')}; ширина ${widthM} м, масштаб ${(widthM / W).toFixed(2)} м/px`);
