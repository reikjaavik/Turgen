// Строит assets/map/base.svg (2D) и assets/map/base.geojson (3D) из выгрузки OpenStreetMap (data/raw/turgen.osm) и контуров зданий
// Overture Maps (data/raw/overture-buildings.geojson: Microsoft ML Buildings + OSM, лицензия ODbL).
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

const layers = { farmland: [], residential: [], river: [], roads: [], buildings: [] };
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

// Здания: если есть выгрузка Overture — берём её (в ней уже есть и здания из OSM), иначе — здания OSM.
const OVERTURE = new URL('../data/raw/overture-buildings.geojson', import.meta.url);
if (existsSync(OVERTURE)) {
  const fc = JSON.parse(readFileSync(OVERTURE, 'utf8'));
  layers.buildings = [];
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
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
<g class="base-river">${layers.river.join('')}</g>
<g class="base-roads">${layers.roads.join('')}</g>
<g class="base-buildings">${layers.buildings.join('')}</g>
</svg>
`;
writeFileSync(new URL('../assets/map/base.svg', import.meta.url), svg);
writeFileSync(new URL('../assets/map/base.geojson', import.meta.url), JSON.stringify({
  type: 'FeatureCollection',
  bounds: [view.minLon, view.minLat, view.maxLon, view.maxLat],
  attribution: '© OpenStreetMap contributors; Microsoft ML Buildings; Overture Maps Foundation (ODbL)',
  features,
}));
console.log(`base.svg: ${Object.entries(layers).map(([k, v]) => `${k}=${v.length}`).join(' ')}; ширина ${widthM} м, масштаб ${(widthM / W).toFixed(2)} м/px`);
