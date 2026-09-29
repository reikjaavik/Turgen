// Stylised SVG map. Base geometry comes from assets/map/base.svg (built from OpenStreetMap,
// see scripts/build-base-map.mjs). Until it exists, a labelled placeholder is shown.
const SVG_NS = 'http://www.w3.org/2000/svg';

let projection = null; // set once base map metadata is known: { minLat, maxLat, minLon, maxLon, width, height }

export async function loadBase(baseEl, t) {
  try {
    const res = await fetch('assets/map/base.svg');
    if (!res.ok) throw new Error(res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const root = doc.documentElement;
    const meta = root.dataset;
    if (meta.minLat) {
      projection = {
        minLat: +meta.minLat, maxLat: +meta.maxLat,
        minLon: +meta.minLon, maxLon: +meta.maxLon,
        width: 800, height: 560,
      };
    }
    baseEl.replaceChildren(...[...root.childNodes].map((n) => document.importNode(n, true)));
    return true;
  } catch {
    baseEl.innerHTML = `
      <g class="map-placeholder">
        <rect x="20" y="20" width="760" height="520" rx="12"></rect>
        <foreignObject x="60" y="200" width="680" height="160">
          <p xmlns="http://www.w3.org/1999/xhtml" class="map-placeholder-text">${t('map.pending')}</p>
        </foreignObject>
      </g>`;
    return false;
  }
}

// Objects are placed by real coordinates only. No lat/lon or no projection → not drawn.
export function renderObjects(objectsEl, objects, year, onSelect) {
  objectsEl.replaceChildren();
  if (!projection) return 0;
  let drawn = 0;
  for (const o of objects) {
    if (o.lat == null || o.lon == null) continue;
    const { x, y } = project(o.lat, o.lon);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'map-object');
    g.setAttribute('transform', `translate(${x} ${y})`);
    g.dataset.visible = String(isVisible(o, year));
    g.setAttribute('tabindex', '0');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', '8');
    g.append(c);
    g.addEventListener('click', () => onSelect(o));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSelect(o); });
    objectsEl.append(g);
    drawn++;
  }
  return drawn;
}

// An object exists in a decade if its [from, to] overlaps [year, year+9]. Unknown bounds are open.
export function isVisible(o, year) {
  const from = o.from ?? -Infinity;
  const to = o.to ?? Infinity;
  return from <= year + 9 && to >= year;
}

// Обратная проекция: точка SVG → широта/долгота (для режима разметки).
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
