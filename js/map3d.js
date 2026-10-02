// 3D-сцена на MapLibre GL (vendor/maplibre-gl, подключается как глобальный maplibregl).
// Тот же интерфейс, что у 2D-схемы (map.js): initStage, setFocus, setDrafts, setMapClick, zoomBy, resetZoom.
// Основа — assets/map/base.geojson (река, поля — OSM; улицы, здания, кварталы, участки — генеральный план 2020; здания вне плана — Overture Maps).
// Высоты зданий условные (по площади): реальных высот в данных нет.

const VILLAGE = [[72.3118, 50.7550], [72.3300, 50.7695]]; // начальный вид: село крупно
const WHOLE = [[72.3105, 50.7545], [72.3320, 50.7790]]; // весь охват: село и площадки МТМ и стоянки к северу от него
const PITCH_3D = 55, BEARING_3D = -15;
const EMPTY = { type: 'FeatureCollection', features: [] };

let map, opts, is3d = true, today = false;
let focus = { places: [], isVisible: () => true, highlight: new Set(), pulse: null, overlay: null };
const markers = new Map(); // id места → { marker, el }
let draftMarkers = [];
let labelZoom = 99;

export const supported = () => {
  if (!window.maplibregl) return false;
  const c = document.createElement('canvas');
  return !!(c.getContext('webgl2') || c.getContext('webgl'));
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export async function initStage(container, options) {
  opts = { onSelect: () => {}, label: (o) => o.id, onMapClick: null, ...options };
  const base = await (await fetch('assets/map/base.geojson')).json();
  map = new window.maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { base: { type: 'geojson', data: base }, zones: { type: 'geojson', data: EMPTY } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': css('--land') } },
        { id: 'farmland', type: 'fill', source: 'base', filter: ['==', ['get', 'kind'], 'farmland'], paint: { 'fill-color': css('--farm') } },
        { id: 'residential', type: 'fill', source: 'base', filter: ['==', ['get', 'kind'], 'residential'], paint: { 'fill-color': css('--street-surface') } },
        { id: 'zones', type: 'fill', source: 'base', filter: ['==', ['get', 'kind'], 'zone'],
          paint: { 'fill-color': ['match', ['get', 'zone'], 'cemetery', css('--zone-cemetery'), css('--zone-industrial')] } },
        { id: 'quarters', type: 'fill', source: 'base', filter: ['==', ['get', 'kind'], 'quarter'], paint: { 'fill-color': css('--quarter'), 'fill-outline-color': css('--parcel') } },
        { id: 'parcels', type: 'line', source: 'base', filter: ['==', ['get', 'kind'], 'parcel'], minzoom: 15,
          paint: { 'line-color': css('--parcel'), 'line-width': 0.7 } },
        { id: 'river', type: 'line', source: 'base', filter: ['==', ['get', 'kind'], 'river'], paint: { 'line-color': css('--river'), 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 9] }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
        { id: 'roads', type: 'line', source: 'base', filter: ['==', ['get', 'kind'], 'road'],
          paint: { 'line-color': ['match', ['get', 'road'], 'major', css('--road-major'), css('--road')],
            'line-width': ['interpolate', ['linear'], ['zoom'], 13, ['match', ['get', 'road'], 'major', 3, 'mid', 2, 1], 17, ['match', ['get', 'road'], 'major', 12, 'mid', 9, 'street', 7, 4]] },
          layout: { 'line-cap': 'round', 'line-join': 'round' } },
        // Современная застройка: в прошлых десятилетиях — плоская бледная «тень» для ориентира, в «Сегодня» — объёмная.
        { id: 'buildings-flat', type: 'fill', source: 'base', filter: ['==', ['get', 'kind'], 'building'],
          paint: { 'fill-color': css('--building'), 'fill-opacity': 0.3, 'fill-opacity-transition': { duration: 600 } } },
        { id: 'buildings-3d', type: 'fill-extrusion', source: 'base', filter: ['==', ['get', 'kind'], 'building'],
          paint: { 'fill-extrusion-color': css('--building'), 'fill-extrusion-height': 0, 'fill-extrusion-opacity': 0.92,
            'fill-extrusion-height-transition': { duration: 700 } } },
        { id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } },
        { id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } },
      ],
    },
    bounds: VILLAGE,
    fitBoundsOptions: { padding: 30 },
    pitch: PITCH_3D,
    bearing: BEARING_3D,
    maxPitch: 70,
    attributionControl: false,
    keyboard: false,
  });
  await new Promise((r) => map.on('load', r));
  labelZoom = map.getZoom() + 1;
  addStreetNames(base);
  // Панель сворачивается без изменения окна — карту нужно подогнать под новый размер вручную.
  new ResizeObserver(() => map.resize()).observe(container);
  map.on('zoomend', applyFocus);
  map.on('click', (e) => { if (opts.onMapClick) opts.onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }); });
}

export function setFocus({ places, isVisible, highlight = [], pulse = null, today: isToday = false, overlay = null }) {
  focus = { places, isVisible, highlight: new Set(highlight), pulse, overlay };
  today = isToday;
  applyFocus();
}

// Названия улиц (по генеральному плану) — подписью у середины улицы, видны при приближении.
let streetEls = [];
function addStreetNames(base) {
  for (const f of base.features) {
    if (f.properties.kind !== 'road' || !f.properties.name) continue;
    const c = f.geometry.coordinates, mid = c[Math.floor((c.length - 1) / 2)];
    const el = document.createElement('div');
    el.className = 'm3d-street';
    el.textContent = f.properties.name;
    new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(mid).addTo(map);
    streetEls.push(el);
  }
}

// Исторический слой (старый план): растровая картинка по четырём углам; слой меняется вместе с десятилетием.
let overlayShown = null;
function applyOverlay(ov) {
  const id = ov?.id ?? null;
  if (id === overlayShown) return;
  if (overlayShown) { map.removeLayer(`ov-${overlayShown}`); map.removeSource(`ov-${overlayShown}`); }
  if (ov) {
    map.addSource(`ov-${id}`, { type: 'image', url: ov.image, coordinates: ov.corners });
    map.addLayer({ id: `ov-${id}`, type: 'raster', source: `ov-${id}`, paint: { 'raster-opacity': ov.opacity ?? 0.85, 'raster-fade-duration': 300 } }, 'zones-fill');
  }
  overlayShown = id;
}

function applyFocus() {
  if (!map) return;
  applyOverlay(focus.overlay);
  const showStreets = map.getZoom() >= labelZoom;
  for (const el of streetEls) el.classList.toggle('on', showStreets);
  map.setPaintProperty('buildings-3d', 'fill-extrusion-height', today ? ['get', 'h'] : 0);
  map.setPaintProperty('buildings-flat', 'fill-opacity', today ? 0 : 0.3);
  map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', today ? 0.92 : 0);

  const anyHl = focus.highlight.size > 0;
  const zoomedIn = map.getZoom() >= labelZoom;
  const zones = [];
  for (const o of focus.places) {
    if (o.lat == null || o.lon == null) continue;
    let m = markers.get(o.id);
    if (!m) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'm3d';
      el.innerHTML = '<span class="dot"></span><span class="lbl"></span>';
      el.addEventListener('click', (e) => { e.stopPropagation(); if (!opts.onMapClick) opts.onSelect(o); });
      // Точка (16 px) — в координате места, подпись справа; у примерной зоны — только подпись по центру.
      const marker = new window.maplibregl.Marker(o.approx ? { element: el, anchor: 'center' } : { element: el, anchor: 'left', offset: [-8, 0] })
        .setLngLat([o.lon, o.lat]).addTo(map);
      m = { marker, el };
      markers.set(o.id, m);
    }
    const visible = focus.isVisible(o) && !drafts[o.id];
    const hl = focus.highlight.has(o.id);
    // classList, а не className: у элемента есть служебные классы MapLibre (позиционирование маркера).
    const cls = {
      approx: !!o.approx, hl, dim: !hl && anyHl, pulse: focus.pulse === o.id,
      labeled: zoomedIn || hl || o.type === 'village' || !!o.approx, off: !visible,
    };
    m.el.classList.add('m3d', `type-${o.type ?? 'other'}`);
    for (const [k, v] of Object.entries(cls)) m.el.classList.toggle(k, v);
    m.el.setAttribute('aria-label', opts.label(o));
    m.el.tabIndex = visible ? 0 : -1;
    m.el.querySelector('.lbl').textContent = o.approx ? `≈ ${opts.label(o)}` : opts.label(o);
    if (o.approx && visible) zones.push(circle(o, groupColor(o.type)));
  }
  map.getSource('zones').setData({ type: 'FeatureCollection', features: zones });
}

let drafts = {};
export function setDrafts(d) {
  drafts = d;
  draftMarkers.forEach((m) => m.remove());
  draftMarkers = Object.entries(d).map(([id, ll]) => {
    const el = document.createElement('div');
    el.className = 'm3d draft labeled';
    el.innerHTML = `<span class="dot"></span><span class="lbl"></span>`;
    el.querySelector('.lbl').textContent = opts.label({ id, ...(opts.placeById?.(id) ?? {}) });
    return new window.maplibregl.Marker({ element: el, anchor: 'left', offset: [-8, 0] }).setLngLat([ll.lon, ll.lat]).addTo(map);
  });
  applyFocus();
}

export function setMapClick(fn) {
  opts.onMapClick = fn;
  map?.getCanvas().classList.toggle('marking', !!fn);
}

export const zoomBy = (f) => map.easeTo({ zoom: map.getZoom() + Math.log2(f) });
export const overview = () => map.fitBounds(WHOLE, { padding: 30, pitch: is3d ? PITCH_3D : 0, bearing: is3d ? BEARING_3D : 0 });
export const resetZoom = () => map.fitBounds(VILLAGE, { padding: 30, pitch: is3d ? PITCH_3D : 0, bearing: is3d ? BEARING_3D : 0 });
export function toggle3d() {
  is3d = !is3d;
  map.easeTo({ pitch: is3d ? PITCH_3D : 0, bearing: is3d ? BEARING_3D : 0, duration: 700 });
  return is3d;
}

function groupColor(type) {
  if (['farm', 'industry', 'building'].includes(type)) return css('--t-agro');
  if (type === 'memorial') return css('--t-war');
  if (type === 'village') return css('--accent');
  return css('--t-postwar');
}

// Круг радиусом approx.radius метров вокруг точки — примерная зона места.
function circle(o, color) {
  const r = o.approx.radius, n = 48, pts = [];
  const dLat = r / 111320, dLon = r / (111320 * Math.cos((o.lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([o.lon + dLon * Math.cos(a), o.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: { color }, geometry: { type: 'Polygon', coordinates: [pts] } };
}
