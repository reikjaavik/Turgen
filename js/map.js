// Стилизованная SVG-схема. Основа — assets/map/base.svg (построена из OpenStreetMap,
// см. scripts/build-base-map.mjs). Объекты ставятся только по реальным координатам.
const SVG_NS = 'http://www.w3.org/2000/svg';

let baseMarkup = null; // кэш содержимого base.svg
let projection = null; // { minLat, maxLat, minLon, maxLon, width, height }

export async function loadBase() {
  if (baseMarkup !== null) return baseMarkup;
  try {
    const res = await fetch('assets/map/base.svg');
    if (!res.ok) throw new Error(res.status);
    const root = new DOMParser().parseFromString(await res.text(), 'image/svg+xml').documentElement;
    const m = root.dataset;
    if (m.minLat) {
      projection = { minLat: +m.minLat, maxLat: +m.maxLat, minLon: +m.minLon, maxLon: +m.maxLon, width: 800, height: 560, mPerPx: +m.scaleM || null };
    }
    baseMarkup = root.innerHTML;
  } catch {
    baseMarkup = '';
  }
  return baseMarkup;
}

export function renderObjects(objectsEl, places, isVisible, onSelect, label) {
  objectsEl.replaceChildren();
  if (!projection) return 0;
  let drawn = 0;
  // Примерные зоны — первыми, чтобы точки лежали поверх и оставались кликабельными.
  const ordered = [...places].sort((a, b) => Boolean(b.approx) - Boolean(a.approx));
  for (const o of ordered) {
    if (o.lat == null || o.lon == null) continue;
    const { x, y } = project(o.lat, o.lon);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `map-object type-${o.type ?? 'other'}`);
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'link');
    g.dataset.visible = String(isVisible(o));
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = label(o);
    // approx: { radius } — место известно только примерно: рисуем зону радиусом radius метров, а не точку.
    const r = o.approx && projection.mPerPx ? o.approx.radius / projection.mPerPx : 9;
    if (o.approx) g.classList.add('approx');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', r.toFixed(1));
    const t = document.createElementNS(SVG_NS, 'text');
    if (o.approx) {
      t.setAttribute('x', '0');
      t.setAttribute('y', (r + 18).toFixed(1));
      t.setAttribute('text-anchor', 'middle');
      t.textContent = `≈ ${label(o)}`;
    } else {
      t.setAttribute('x', '14');
      t.setAttribute('y', '5');
      t.textContent = label(o);
    }
    g.append(title, c, t);
    g.addEventListener('click', () => onSelect(o));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSelect(o); });
    objectsEl.append(g);
    drawn++;
  }
  return drawn;
}

// Обратная проекция: точка SVG → широта/долгота (для режима разметки ?edit).
export function unproject(x, y) {
  const p = projection;
  if (!p) return null;
  return {
    lon: p.minLon + (x / p.width) * (p.maxLon - p.minLon),
    lat: p.maxLat - (y / p.height) * (p.maxLat - p.minLat),
  };
}

function project(lat, lon) {
  const p = projection;
  return {
    x: ((lon - p.minLon) / (p.maxLon - p.minLon)) * p.width,
    y: ((p.maxLat - lat) / (p.maxLat - p.minLat)) * p.height,
  };
}
