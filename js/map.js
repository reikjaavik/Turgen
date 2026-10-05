// Схема села — постоянная «сцена» сайта. Основа — assets/map/base.svg (построена из OpenStreetMap,
// см. scripts/build-base-map.mjs). Объекты ставятся только по реальным координатам.
const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 800, H = 560;

let projection = null; // { minLat, maxLat, minLon, maxLon, mPerPx }
let svg, baseEl, objectsEl, draftsEl;
const FULL = { x: 0, y: 0, w: W, h: H };
const HOME_ZOOM = 2.2; // начальный вид — село крупно; весь охват (с МТМ и стоянкой на севере) — кнопкой «всё село»
const HOME_CENTER = { lat: 50.7628, lon: 72.3232 };
let view = { ...FULL };
let focus = { places: [], isVisible: () => true, highlight: new Set(), pulse: null, overlay: null, decade: 2000 };
let drafts = {};
let opts = { onSelect: () => {}, label: (o) => o.id, onMapClick: null };

export async function initStage(svgEl, options) {
  svg = svgEl;
  opts = { ...opts, ...options };
  baseEl = svg.querySelector('#map-base');
  objectsEl = svg.querySelector('#map-objects');
  draftsEl = svg.querySelector('#map-drafts');
  try {
    const res = await fetch('assets/map/base.svg');
    if (!res.ok) throw new Error(res.status);
    const root = new DOMParser().parseFromString(await res.text(), 'image/svg+xml').documentElement;
    const m = root.dataset;
    if (m.minLat) projection = { minLat: +m.minLat, maxLat: +m.maxLat, minLon: +m.minLon, maxLon: +m.maxLon, mPerPx: +m.scaleM || null };
    baseEl.innerHTML = root.innerHTML;
    view = homeView();
  } catch {
    baseEl.innerHTML = '';
  }
  setupPanZoom();
  applyView();
}

// Экранный масштаб: насколько схема приближена (1 — вся схема).
const zoomK = () => W / view.w;

export function setFocus({ places, isVisible, highlight = [], pulse = null, today = false, overlay = null, decade = 2000 }) {
  focus = { places, isVisible, highlight: new Set(highlight), pulse, overlay, decade };
  drawOverlay();
  drawStreets();
  // Современная застройка в прошлых десятилетиях — бледной тенью для ориентира.
  svg.classList.toggle('past', !today);
  drawObjects();
}

export function setDrafts(d) {
  drafts = d;
  drawDrafts();
}

export function setMapClick(fn) {
  opts.onMapClick = fn;
  svg.classList.toggle('marking', !!fn);
}

export function zoomBy(f, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
  const w = Math.min(W, Math.max(W / 8, view.w / f));
  const h = (w * H) / W;
  view = { x: cx - ((cx - view.x) * w) / view.w, y: cy - ((cy - view.y) * h) / view.h, w, h };
  applyView();
}
// Начальный вид: село крупно, по центру HOME_CENTER.
function homeView() {
  if (!projection) return { ...FULL };
  const w = W / HOME_ZOOM, h = H / HOME_ZOOM, c = project(HOME_CENTER.lat, HOME_CENTER.lon);
  return { x: Math.min(Math.max(c.x - w / 2, 0), W - w), y: Math.min(Math.max(c.y - h / 2, 0), H - h), w, h };
}
export function resetZoom() { view = homeView(); applyView(); }
// Весь охват схемы: село и площадки МТМ и стоянки к северу от него.
export function overview() { view = { ...FULL }; applyView(); }

function applyView() {
  // Не даём увести схему за край.
  view.x = Math.min(Math.max(view.x, 0), W - view.w);
  view.y = Math.min(Math.max(view.y, 0), H - view.h);
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  svg.style.setProperty('--k', zoomK());
  drawStreets();
  drawObjects();
  drawDrafts();
}

function toSvg(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function setupPanZoom() {
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) svg.setPointerCapture?.(e.pointerId);
    drag.moved = true;
    const r = svg.getBoundingClientRect();
    const s = Math.max(view.w / r.width, view.h / r.height);
    view.x = drag.vx - dx * s; view.y = drag.vy - dy * s;
    applyView();
  });
  const end = (e) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) { e.preventDefault(); svg.dataset.dragged = '1'; setTimeout(() => delete svg.dataset.dragged, 0); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => { drag = null; });
  svg.addEventListener('click', (e) => {
    if (svg.dataset.dragged) { e.stopPropagation(); return; }
    if (opts.onMapClick && !e.target.closest('.map-object')) {
      const ll = unproject(toSvg(e));
      if (ll) opts.onMapClick(ll);
    }
  }, true);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toSvg(e);
    zoomBy(e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y);
  }, { passive: false });
}

// Улицы по десятилетию («свои логичные улицы»: сеть растёт вместе с селом) и названия там, где они известны из источников:
// старый план (1960–1980-е) и генплан 2020 («Сегодня»). Подписи — при приближении.
function drawStreets() {
  if (!baseEl) return;
  const dec = focus.decade;
  baseEl.querySelectorAll('.base-roads path').forEach((p) => { p.style.display = +p.dataset.since <= dec && (!p.dataset.until || dec <= +p.dataset.until) ? '' : 'none'; });
  baseEl.querySelector('.map-street-names')?.remove();
  const g = el('g', { class: 'map-street-names' });
  const k = zoomK();
  // Подписи участков («Микрорайон № 1») — только в «Сегодня», при любом масштабе.
  if (dec >= 2000) baseEl.querySelectorAll('.base-boundaries path[data-name]').forEach((p) => {
    const t = el('text', { x: p.dataset.lx, y: p.dataset.ly, 'text-anchor': 'middle', 'font-size': (11 / k).toFixed(2) });
    t.textContent = p.dataset.name;
    g.append(t);
  });
  if (k < 2) { baseEl.append(g); return; }
  baseEl.querySelectorAll('.base-roads path[data-lx]').forEach((p) => {
    const nm = dec >= 2000 ? p.dataset.name : dec >= 1960 && dec <= 1980 ? p.dataset.old : '';
    if (!nm || +p.dataset.since > dec) return;
    const t = el('text', { x: p.dataset.lx, y: p.dataset.ly, 'text-anchor': 'middle', 'font-size': (11 / k).toFixed(2) });
    t.textContent = nm;
    g.append(t);
  });
  baseEl.append(g);
}

// Исторический слой (старый план) — картинка поверх основы, в границах по четырём углам.
function drawOverlay() {
  baseEl?.querySelector('.map-overlay')?.remove();
  const ov = focus.overlay;
  if (!ov || !projection || !baseEl) return;
  const [tl, , br] = ov.corners.map(([lon, lat]) => project(lat, lon));
  const img = el('image', { class: 'map-overlay', href: ov.image, x: tl.x.toFixed(1), y: tl.y.toFixed(1),
    width: (br.x - tl.x).toFixed(1), height: (br.y - tl.y).toFixed(1), opacity: ov.opacity ?? 0.85, preserveAspectRatio: 'none' });
  baseEl.append(img);
}

function drawObjects() {
  if (!objectsEl) return;
  objectsEl.replaceChildren();
  if (!projection) return;
  const k = zoomK();
  const anyHl = focus.highlight.size > 0;
  // Примерные зоны — первыми, чтобы точки лежали поверх и оставались кликабельными.
  const ordered = [...focus.places].sort((a, b) => Boolean(b.approx) - Boolean(a.approx));
  for (const o of ordered) {
    if (o.lat == null || o.lon == null || drafts[o.id]) continue;
    const { x, y } = project(o.lat, o.lon);
    const g = el('g', { class: `map-object type-${o.type ?? 'other'}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, tabindex: '0', role: 'link' });
    g.dataset.visible = String(focus.isVisible(o));
    if (o.approx) g.classList.add('approx');
    if (focus.highlight.has(o.id)) g.classList.add('hl');
    else if (anyHl) g.classList.add('dim');
    if (focus.pulse === o.id) g.classList.add('pulse');
    // Подписи: при обычном масштабе — только у центра аула и выбранных мест (иначе налезают); при приближении — у всех.
    if (k >= 3.2 || o.type === 'village' || o.approx || focus.highlight.has(o.id)) g.classList.add('labeled');
    const label = opts.label(o);
    const title = el('title');
    title.textContent = label;
    // approx: { radius } — место известно только примерно: зона радиусом radius метров, а не точка.
    const r = o.approx && projection.mPerPx ? o.approx.radius / projection.mPerPx : 9 / k;
    const c = el('circle', { r: r.toFixed(2) });
    const t = el('text', o.approx
      ? { x: 0, y: (r + 18 / k).toFixed(2), 'text-anchor': 'middle' }
      : { x: (14 / k).toFixed(2), y: (5 / k).toFixed(2) });
    t.textContent = o.approx ? `≈ ${label}` : label;
    g.append(title, c, t);
    g.addEventListener('click', (e) => { if (!svg.dataset.dragged) { e.stopPropagation(); opts.onSelect(o); } });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onSelect(o); });
    objectsEl.append(g);
  }
}

function drawDrafts() {
  if (!draftsEl) return;
  draftsEl.replaceChildren();
  if (!projection) return;
  const k = zoomK();
  for (const [id, ll] of Object.entries(drafts)) {
    const { x, y } = project(ll.lat, ll.lon);
    const g = el('g', { class: 'map-draft', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    const c = el('circle', { r: (9 / k).toFixed(2) });
    const t = el('text', { x: (14 / k).toFixed(2), y: (5 / k).toFixed(2) });
    t.textContent = opts.label({ id, ...(opts.placeById?.(id) ?? {}) });
    g.append(c, t);
    draftsEl.append(g);
  }
}

function el(name, attrs = {}) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// Обратная проекция: точка SVG → широта/долгота.
export function unproject({ x, y }) {
  const p = projection;
  if (!p) return null;
  return {
    lon: p.minLon + (x / W) * (p.maxLon - p.minLon),
    lat: p.maxLat - (y / H) * (p.maxLat - p.minLat),
  };
}

function project(lat, lon) {
  const p = projection;
  return {
    x: ((lon - p.minLon) / (p.maxLon - p.minLon)) * W,
    y: ((p.maxLat - lat) / (p.maxLat - p.minLat)) * H,
  };
}
