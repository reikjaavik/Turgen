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
const [cLat = 50.7625, cLon = 72.3200, widthM = 2600] = process.argv.slice(2).map(Number);
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
  const flat = (coords) => coords.map(([lon, lat]) => [lat, lon]);
  const kinds = { zones: [], quarters: [], parcels: [] };
  layers.roads = []; layers.buildings = [];
  for (let i = features.length - 1; i >= 0; i--) if (features[i].properties.kind === 'road') features.splice(i, 1);
  // фон из OSM (поля, жилая зона) оставляем; реку тоже; дороги и здания — из плана
  for (const f of plan.features) {
    const k = f.properties.kind, g = f.geometry;
    if (k === 'road') {
      const pts = flat(g.coordinates);
      if (!inView(pts)) continue;
      const road = f.properties.road;
      layers.roads.push(`<path class="road-${road}" d="${d(pts)}"${f.properties.name ? ` data-name="${esc(f.properties.name)}"` : ''}/>`);
      feat('road', { type: 'LineString', coordinates: ll(pts) }, f.properties.name ? { road, name: f.properties.name } : { road });
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
  attribution: '© OpenStreetMap contributors; Microsoft ML Buildings; Overture Maps Foundation (ODbL); генеральный план с. Турген (ТОО «Колдау», 2020)',
  features,
}));
console.log(`base.svg: ${Object.entries(layers).map(([k, v]) => `${k}=${v.length}`).join(' ')}; ширина ${widthM} м, масштаб ${(widthM / W).toFixed(2)} м/px`);
