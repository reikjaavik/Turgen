// Раскладка реконструкции по периодам: какие постройки где стоят.
// Места под дома — контуры современных зданий (Overture): с каждым периодом «заселяются»
// всё более далёкие от центра участки. Общественные здания — в местах, отмеченных автором сайта.
// Всё, кроме фактов (10–12 дворов в 1903, памятник с 1970-х, отмеченные места), — условно.

export const ORIGIN = { lat: 50.7612, lon: 72.3230 };
const M_LAT = 111320;
const M_LON = M_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
export const toXZ = (lat, lon) => ({ x: (lon - ORIGIN.lon) * M_LON, z: -(lat - ORIGIN.lat) * M_LAT });
export const toLL = (x, z) => ({ lat: ORIGIN.lat - z / M_LAT, lon: ORIGIN.lon + x / M_LON });

// Детерминированный «случай» по строке — чтобы дом не менял вид от периода к периоду.
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }

// Контур здания → центр, угол длинной стороны, размеры вдоль/поперёк, площадь.
function footprint(f, i) {
  const pts = f.geometry.coordinates[0].map(([lon, lat]) => toXZ(lat, lon));
  let a = 0, cx = 0, cz = 0, best = 0, ang = 0;
  for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
    const cr = pts[j].x * pts[k].z - pts[k].x * pts[j].z;
    a += cr; cx += (pts[j].x + pts[k].x) * cr; cz += (pts[j].z + pts[k].z) * cr;
    const len = Math.hypot(pts[k].x - pts[j].x, pts[k].z - pts[j].z);
    if (len > best) { best = len; ang = Math.atan2(pts[k].z - pts[j].z, pts[k].x - pts[j].x); }
  }
  a /= 2; cx /= 6 * a; cz /= 6 * a;
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
  for (const p of pts) {
    const d1 = (p.x - cx) * ux + (p.z - cz) * uz, d2 = -(p.x - cx) * uz + (p.z - cz) * ux;
    min1 = Math.min(min1, d1); max1 = Math.max(max1, d1); min2 = Math.min(min2, d2); max2 = Math.max(max2, d2);
  }
  return { id: `b${i}`, x: cx, z: cz, rot: -ang, w: max1 - min1, d: max2 - min2, area: Math.abs(a), h: f.properties.h ?? 4 };
}

export function prepare(base, places) {
  const feats = base.features;
  const buildings = feats.filter((f) => f.properties.kind === 'building' && f.geometry.type === 'Polygon').map(footprint);
  const roads = feats.filter((f) => f.properties.kind === 'road').map((f) => ({ road: f.properties.road, asphalt: !!f.properties.asphalt, since: f.properties.since ?? 1900, until: f.properties.until, gen: !!f.properties.gen, id: f.properties.id, name: f.properties.name, oldName: f.properties.oldName, pts: f.geometry.coordinates.map(([lon, lat]) => toXZ(lat, lon)) }));
  const river = feats.filter((f) => f.properties.kind === 'river').map((f) => f.geometry.coordinates.map(([lon, lat]) => toXZ(lat, lon)));
  const pl = Object.fromEntries(places.filter((p) => p.lat != null).map((p) => [p.id, { ...toXZ(p.lat, p.lon), place: p }]));

  // Центр старого села — середина отмеченных автором общественных мест (условно).
  const social = ['dom-kultury', 'pochta', 'shkola', 'kontora', 'magaziny', 'monument-vov'].map((id) => pl[id]).filter(Boolean);
  const core = { x: social.reduce((s, p) => s + p.x, 0) / social.length, z: social.reduce((s, p) => s + p.z, 0) / social.length };

  // Под жильё — небольшие контуры, не занятые отмеченными местами.
  const nearPlace = (b) => Object.values(pl).some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 14);
  const plots = buildings.filter((b) => b.area < 260 && !nearPlace(b))
    .map((b) => ({ ...b, dist: Math.hypot(b.x - core.x, b.z - core.z) }))
    .sort((a, b) => a.dist - b.dist);
  return { buildings, plots, roads, river, pl, core };
}

// Каким типом стал дом, построенный в данном периоде: по «смеси» типов этого периода.
function pickType(mix, key) {
  let r = hash(key), acc = 0;
  for (const [t, share] of Object.entries(mix)) { acc += share; if (r <= acc) return t; }
  return Object.keys(mix).at(-1);
}

// Участки под дома. С 1960-х — современные контуры зданий (Overture/генплан), ближайшие к центру. До 1960-х планировка не известна:
// «свои логичные улицы» (gen в base.geojson) — дома встают вдоль них по обе стороны, от центра наружу. Дальние участки (на ещё не
// построенных отрезках улиц) идут после — под юрты, зимовку и палатки на краю села.
// Расстояние от точки до ломаной (x, z).
function polyDist(p, pts) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    m = Math.min(m, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return m;
}

function slotsFor(prep, decade) {
  if (decade >= 1960) {
    // Дома — на реальных участках, но сначала на тех, что стоят вдоль улиц, существующих в этом десятилетии; остальные — после.
    prep.along ??= new Map();
    if (!prep.along.has(decade)) {
      const vis = prep.roads.filter((r) => !r.gen && r.road !== 'major' && r.since <= decade);
      const near = (b) => vis.some((r) => polyDist(b, r.pts) < 32);
      const [yes, no] = [[], []];
      for (const b of prep.plots) (near(b) ? yes : no).push(b);
      prep.along.set(decade, [...yes, ...no]);
    }
    return prep.along.get(decade);
  }
  if (!prep.genSlots) {
    prep.genSlots = [];
    for (const r of prep.roads.filter((q) => q.gen)) {
      const pts = r.pts;
      let acc = 15, side = 1, k = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        for (; acc < len; acc += 15) {
          // шаг 15 м, стороны чередуются: каждый второй отсчёт — участок, т. е. по дому каждые 30 м на сторону
          const t = acc / len, h = hash(`${r.id}${k}`);
          prep.genSlots.push({ id: `${r.id}-${k++}`, x: a.x + (b.x - a.x) * t + nx * 14 * side + (h - 0.5) * 6, z: a.z + (b.z - a.z) * t + nz * 14 * side, rot: -Math.atan2(b.z - a.z, b.x - a.x),
            w: 9, d: 7, area: 70, h: 4, since: r.since, dist: Math.hypot(a.x - (prep.pl.aul ?? prep.core).x, a.z - (prep.pl.aul ?? prep.core).z) });
          side = -side;
        }
        acc -= len;
      }
    }
    prep.genSlots.sort((p, q) => p.dist - q.dist);
  }
  const seen = prep.genSlots.filter((s) => s.since <= decade), rest = prep.genSlots.filter((s) => s.since > decade);
  return [...seen, ...rest];
}

export function layout(prep, eras, decade) {
  const era = eras.find((e) => e.decade === decade) ?? eras[0];
  const sc = era.scene;
  const out = [];
  const add = (type, x, z, rot = 0, sx = 1, sy = 1, sz = 1, key = `${type}${x.toFixed(0)}${z.toFixed(0)}`) => out.push({ type, x, z, rot, sx, sy, sz, key });

  if (sc.today) {
    for (const b of prep.buildings) {
      if (b.area < 260) {
        const v = ['modern-a', 'modern-b', 'modern-c', 'modern-d'][Math.floor(hash(b.id) * 4)];
        add(v, b.x, b.z, b.rot, Math.max(b.w, 4), 1, Math.max(b.d, 4), b.id);
      } else add('modern-big', b.x, b.z, b.rot, b.w, b.h * 0.9, b.d, b.id);
    }
  } else {
    // Жилые дома: участок получает «год постройки» — первый период, когда до него дошла застройка;
    // вид дома — по смеси типов того периода (землянки к 1950-м заменены саманом).
    const past = eras.filter((e) => e.decade <= decade && !e.scene.today);
    const plots = slotsFor(prep, decade);
    plots.slice(0, sc.houses).forEach((b, i) => {
      const built = past.find((e) => i < e.scene.houses) ?? era;
      let type = pickType(built.scene.mix, b.id);
      // Со временем старые дома перестраивают: землянки — в саман, соломенные крыши — под шифер (с 1960-х),
      // часть саманных домов с 1970-х заменена кирпичными (доля условная).
      if (type === 'zemlyanka' && decade >= 1950) type = 'saman';
      if (type === 'saman' && decade >= 1970 && hash(b.id + 'r') < 0.35) type = 'brick';
      else if (type === 'saman' && decade >= 1960) type = 'saman60';
      add(type, b.x, b.z, b.rot, 1, 1, 1, b.id);
      if (['saman', 'saman60', 'zemlyanka', 'shchit'].includes(type) && decade < 1970) fence(add, b);
    });
    // Юрты и зимовка — на следующих за застройкой участках (на краю села).
    const edge = plots.slice(sc.houses, sc.houses + 12);
    for (let i = 0; i < (sc.yurts ?? 0); i++) { const b = edge[i * 2]; if (b) add('yurt', b.x + 6, b.z + 4, hash(b.id) * 6); }
    if (decade <= 1910 && edge[7]) add('kystau', edge[7].x, edge[7].z, edge[7].rot);
    // Целина: палатки и вагончики.
    const camp = plots.slice(sc.houses + ((sc.yurts ?? 0) ? 12 : 0), sc.houses + 40);
    for (let i = 0; i < (sc.tents ?? 0); i++) { const b = camp[i]; if (b) add('tent', b.x, b.z, b.rot); }
    for (let i = 0; i < (sc.wagons ?? 0); i++) { const b = camp[(sc.tents ?? 0) + i]; if (b) add('wagon', b.x, b.z, b.rot); }
  }

  const P = prep.pl;
  const at = (id, type, rot = 0, s = [1, 1, 1], dx = 0, dz = 0) => { if (P[id]) add(type, P[id].x + dx, P[id].z + dz, rot, ...s, `${type}@${id}`); };
  if (sc.kolkhoz) {
    at('kontora', 'kontora30');
    at('krs', 'cowshed30', 0.4); at('krs', 'barn', 0.4, [1, 1, 1], 0, 30);
  }
  if (sc.sovkhoz) {
    at('kontora', 'kontora', 0.1); at('shkola', 'school', 0.1); at('dom-kultury', 'club', 0.1);
    at('masterskie', 'workshop', 0.1); at('mtm', 'workshop', 0.1, [0.8, 1, 0.8]); at('elevator', 'elevator');
    at('krs', 'cowshed60', 0.4); at('krs', 'cowshed60', 0.4, [1, 1, 1], 0, 30);
    at('svinoferma', 'cowshed60', 0.4); at('svinoferma', 'barn', 0.4, [1, 1, 1], 0, 30);
    at('krs', 'watertower', 0, [1, 1, 1], 45, -10);
    at('detsad', 'kontora', 0.1, [0.6, 0.55, 0.7]); at('poliklinika', 'brick', 0.1, [1.4, 1, 1.2]);
    at('pochta', 'brick', 0.1); at('magaziny', 'brick', 0.1); at('pekarnya', 'brick', 0.1);
  }
  if (sc.memorial) at('monument-vov', 'memorial', 0.1);

  // Деревья — вдоль улиц, детерминированно.
  const trees = [];
  for (const r of prep.roads) {
    if (r.since > decade || (r.until != null && r.until < decade)) continue; // улиц, которых в этом десятилетии ещё нет или уже нет
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (let t = 0; t < len; t += 14) {
        const side = hash(`${i}${t}`) > 0.5 ? 1 : -1;
        const x = a.x + ((b.x - a.x) * t) / len + nx * 9 * side, z = a.z + ((b.z - a.z) * t) / len + nz * 9 * side;
        if (Math.hypot(x - prep.core.x, z - prep.core.z) < 700) trees.push({ x, z, k: `${i}-${t}` });
      }
    }
  }
  trees.sort((a, b) => Math.hypot(a.x - prep.core.x, a.z - prep.core.z) - Math.hypot(b.x - prep.core.x, b.z - prep.core.z));
  for (const tr of trees.slice(0, sc.trees ?? 0)) {
    const s = 0.8 + hash(tr.k) * 0.5;
    add(hash(tr.k + 'p') > 0.55 ? 'poplar' : 'tree', tr.x, tr.z, hash(tr.k) * 6, s, s, s, `t${tr.k}`);
  }
  return out;
}

// Плетень вокруг двора: 4 пролёта вокруг дома.
function fence(add, b) {
  const W = 14, D = 18, c = Math.cos(b.rot), s = Math.sin(b.rot);
  const seg = (lx, lz, len, r) => add('fence', b.x + lx * c + lz * s, b.z - lx * s + lz * c, b.rot + r, len, 1, 1, `f${b.id}${lx}${lz}`);
  seg(0, D / 2, W, 0); seg(0, -D / 2, W, 0); seg(W / 2, 0, D, Math.PI / 2); seg(-W / 2, 0, D, Math.PI / 2);
}
