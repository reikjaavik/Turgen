#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Извлекает из дампа генерального плана с. Турген (ГП-3, ТОО «Колдау», 2020) слои для основы карты.

Запуск:  python scripts/genplan/extract.py gp3.json [data/raw/genplan-2020.geojson]
Вход:    JSON-дамп DWG (scripts/genplan/dump-dwg.mjs); нужны numpy и scipy.
Выход:   data/raw/genplan-2020.geojson (WGS84) — здания, кварталы, осевые улиц, участки, подписи плана.

Привязка. Координаты плана условные (метры, оси повёрнуты примерно на 1°). Поворот, масштаб и сдвиг
подбираются автоматически: центры контуров зданий плана совмещаются с контурами Overture (голосование по
сдвигу при переборе углов, затем подгонка подобия по совпавшим парам). Метрики привязки — в свойствах файла.

Проектное. В плане есть и существующее, и проектное (новые кварталы на юго-востоке, 115 проектных домов).
Берутся только существующие здания (слой «здание») и существующие кварталы красных линий; проектные кварталы
и улицы между ними в основу не попадают.
"""
import json, re, sys, collections
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/raw/genplan-2020.geojson'
OVERTURE = 'data/raw/overture-buildings.geojson'
OSM = 'data/raw/turgen.osm'
LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * np.cos(np.radians(LAT0))
BS = chr(92)

db = json.load(open(SRC, encoding='utf-8'))
ents = db['entities']


# ───────────────────────── геометрия объектов DWG ─────────────────────────
def arc_pts(c, r, a0, a1, ccw=True, n=12):
    a0, a1 = np.radians(a0), np.radians(a1)
    if ccw and a1 < a0: a1 += 2 * np.pi
    if not ccw and a1 > a0: a1 -= 2 * np.pi
    t = np.linspace(a0, a1, n)
    return np.c_[c['x'] + r * np.cos(t), c['y'] + r * np.sin(t)]


def bulge_poly(vs, closed):
    out, n = [], len(vs)
    for i, v in enumerate(vs):
        out.append([v['x'], v['y']])
        b = v.get('bulge', 0)
        if b and (i < n - 1 or closed):
            w = vs[(i + 1) % n]
            x1, y1, x2, y2 = v['x'], v['y'], w['x'], w['y']
            d = np.hypot(x2 - x1, y2 - y1)
            if d < 1e-9: continue
            th4 = 4 * np.arctan(b)
            r = d / (2 * np.sin(th4 / 2))
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            h = r * np.cos(th4 / 2)
            nx, ny = -(y2 - y1) / d, (x2 - x1) / d
            cx, cy = mx - h * nx, my - h * ny
            a0 = np.arctan2(y1 - cy, x1 - cx)
            for k in range(1, 6):
                a = a0 + th4 * k / 6
                out.append([cx + abs(r) * np.cos(a), cy + abs(r) * np.sin(a)])
    return out


def geom(e):
    """[('line'|'poly', Nx2)] в координатах DWG."""
    t = e['type']
    if t == 'LWPOLYLINE':
        closed = bool(e.get('flag', 0) & 512) or bool(e.get('flag', 0) & 1)
        pts = bulge_poly(e['vertices'], closed)
        return [('poly' if closed else 'line', np.array(pts))] if len(pts) > 1 else []
    if t == 'LINE':
        s, f = e['startPoint'], e['endPoint']
        return [('line', np.array([[s['x'], s['y']], [f['x'], f['y']]]))]
    if t == 'SPLINE':
        p = e.get('fitPoints') or e.get('controlPoints') or []
        return [('line', np.array([[q['x'], q['y']] for q in p]))] if len(p) > 1 else []
    if t == 'HATCH':
        res = []
        for bp in e.get('boundaryPaths', []):
            pts = []
            if bp.get('vertices'):
                pts = bulge_poly(bp['vertices'], True)
            else:
                for ed in bp.get('edges', []):
                    if ed.get('type') == 1:
                        pts += [[ed['start']['x'], ed['start']['y']], [ed['end']['x'], ed['end']['y']]]
                    elif ed.get('type') == 2 and 'center' in ed:
                        pts += arc_pts(ed['center'], ed['radius'], ed['startAngle'], ed['endAngle'], ed.get('isCCW', True)).tolist()
            if len(pts) > 2: res.append(('poly', np.array(pts)))
        return res
    return []


def clean_text(t):
    t = re.sub(re.escape(BS) + '[pPxXiIqQcCfFhHlLtTwWaA][^;' + re.escape(BS) + ']*;', '', t or '')
    t = t.replace(BS + 'P', ' ').replace('{', '').replace('}', '').replace(BS + BS, '')
    return re.sub(r'\s+', ' ', t).strip()


# ───────────────────────── привязка к Overture ─────────────────────────
def local_of_lonlat(a):
    a = np.asarray(a, float)
    return np.c_[(a[:, 0] - LON0) * MLON, (a[:, 1] - LAT0) * MLAT]


ov_polys = []  # контуры Overture в локальных метрах
for f in json.load(open(OVERTURE, encoding='utf-8'))['features']:
    g = f['geometry']
    for p in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
        ov_polys.append(local_of_lonlat(p[0]))
ov_c = np.array([p.mean(0) for p in ov_polys])

plan_b = []  # здания плана (индексы сущностей)
for e in ents:
    if e['type'] == 'LWPOLYLINE' and e['layer'] == 'здание' and len(e['vertices']) >= 3:
        plan_b.append(e)
dw_c = np.array([np.array([[v['x'], v['y']] for v in e['vertices']]).mean(0) for e in plan_b])


def register():
    best = (0, 0, None)
    B = 4.0
    for th in np.arange(0, 360, 0.5):
        c, s = np.cos(np.radians(th)), np.sin(np.radians(th))
        d = dw_c @ np.array([[c, -s], [s, c]]).T
        diff = (ov_c[None, :, :] - d[:, None, :]).reshape(-1, 2)
        ix = np.floor(diff / B).astype(int)
        key = ix[:, 0] * 100000 + ix[:, 1]
        u, cnt = np.unique(key, return_counts=True)
        j = cnt.argmax()
        if cnt[j] > best[0]: best = (cnt[j], th, diff[key == u[j]].mean(0))
    _, th, t = best
    tree = cKDTree(ov_c)
    sc = 1.0
    for _ in range(4):  # подгонка подобия по совпавшим парам, пары пересчитываются
        c, s = np.cos(np.radians(th)), np.sin(np.radians(th))
        R = np.array([[c, -s], [s, c]])
        dist, idx = tree.query(sc * dw_c @ R.T + t, distance_upper_bound=10)
        m = np.isfinite(dist)
        X, Y = dw_c[m], ov_c[idx[m]]
        mx, my = X.mean(0), Y.mean(0)
        U, S, Vt = np.linalg.svd((Y - my).T @ (X - mx))
        Rm = U @ Vt
        sc = S.sum() / ((X - mx) ** 2).sum()
        th = float(np.degrees(np.arctan2(Rm[1, 0], Rm[0, 0])))
        t = my - sc * (Rm @ mx)
    c, s = np.cos(np.radians(th)), np.sin(np.radians(th))
    R = np.array([[c, -s], [s, c]])
    dist, idx = tree.query(sc * dw_c @ R.T + t, distance_upper_bound=10)
    m = np.isfinite(dist)
    return sc, th, t, dict(pairs=int(m.sum()), of=len(dw_c), rms_m=float(np.sqrt((dist[m] ** 2).mean())), median_m=float(np.median(dist[m])))


SC, TH, T, REG = register()
_R = np.array([[np.cos(np.radians(TH)), -np.sin(np.radians(TH))], [np.sin(np.radians(TH)), np.cos(np.radians(TH))]])
print(f'привязка: масштаб {SC:.5f}, поворот {TH:.3f}°, пар {REG["pairs"]}/{REG["of"]}, rms {REG["rms_m"]:.2f} м', file=sys.stderr)


def tf(pts):
    return SC * (np.asarray(pts, float).reshape(-1, 2) @ _R.T) + T


def ll(m):
    m = np.asarray(m, float).reshape(-1, 2)
    return [[round(LON0 + x / MLON, 6), round(LAT0 + y / MLAT, 6)] for x, y in m]


def area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def pip(poly, pts):
    """Точки внутри многоугольника (чёт-нечет), векторно."""
    x, y = pts[:, 0], pts[:, 1]
    inside = np.zeros(len(pts), bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > y) != (y2 > y)
        with np.errstate(divide='ignore', invalid='ignore'):
            xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
        inside ^= cond & (x < xin)
    return inside


features = []


def feat(kind, geometry, **props):
    features.append({'type': 'Feature', 'properties': {'kind': kind, **props}, 'geometry': geometry})


# ───────────────────────── подписи плана ─────────────────────────
labels = []  # (текст, точка в локальных метрах)
for e in ents:
    if e['type'] == 'MTEXT' and e['layer'] in ('надписи', 'здание'):
        t = clean_text(e['text'])
        if t:
            labels.append((t, tf([[e['insertionPoint']['x'], e['insertionPoint']['y']]])[0]))
NOISE = {'КН', 'КЖ', 'Н', 'н', 'А', 'М', 'м', 'К', 'бр', 'разв', 'ТР', 'ТП', 'погр', 'КПП', 'кпп', 'вытяжка', 'ог'}
RUIN = ('развалины', 'разв', 'разрушен')

# Нумерованная экспликация плана (рус. названия) — по ней подписанным зданиям присваивается номер.
EXPL = {'Акимат': 1, 'Почта': 2, 'Школа': 3, 'Интернат': 4, 'Детский сад': 5, 'Амбулатория': 7, 'Дом культуры': 8,
        'Торговый центр': 9, 'ТОО "Поиск"': 10, 'Кафе': 11, 'Магазин': 12, 'футбольное поле': 14, 'Нефтебаза': 17}


def short_label(text):
    """«Школа 2К» → «Школа»: буквенно-цифровые коды на плане (2К, К, КЖ…) в легенде не расшифрованы и не передаются."""
    return re.sub(r'\s+\d?К[ЖН]?$', '', text).strip()


def expl_key(text):
    for k in EXPL:
        if text.lower().startswith(k.lower()): return k
    return None


# ───────────────────────── здания ─────────────────────────
bpolys = [tf(np.array([[v['x'], v['y']] for v in e['vertices']])) for e in plan_b]
bpolys = [p for p in bpolys if abs(area(p)) > 3]
bcent = np.array([p.mean(0) for p in bpolys])
b_label = [None] * len(bpolys)
b_ruin = [False] * len(bpolys)
for text, m in labels:
    if text in NOISE or len(text) < 3 and text not in ('2К',): continue
    # к зданию: внутри контура, иначе ближайшее не дальше 18 м
    inside = [i for i, p in enumerate(bpolys) if pip(p, m.reshape(1, 2))[0]]
    if inside: j = min(inside, key=lambda i: abs(area(bpolys[i])))
    else:
        d = np.hypot(*(bcent - m).T)
        j = int(d.argmin()) if d.min() < 18 else None
    if j is None: continue
    if any(text.lower().startswith(r) for r in RUIN): b_ruin[j] = True
    elif expl_key(text) or text.lower() in ('кафе', 'магазин', 'ул.женис'): b_label[j] = text if b_label[j] is None else b_label[j]

n_ruin = sum(b_ruin)
plan_kept = []
for i, p in enumerate(bpolys):
    props = {'src': 'genplan'}
    if b_label[i]:
        k = expl_key(b_label[i])
        props['label'] = short_label(b_label[i])
        if k: props['num'] = EXPL[k]
    if b_ruin[i]:
        feat('ruin', {'type': 'Polygon', 'coordinates': [ll(p) + [ll(p[:1])[0]]]}, **props)
        continue
    plan_kept.append(i)

# Контуры Overture, которых нет на плане, остаются; совпавшие с планом заменяются контуром плана.
def covered_fraction(op, idxs):
    """Какая доля площади контура Overture закрыта зданиями плана (растр 0,5 м по габариту контура)."""
    if len(idxs) == 0: return 0.0
    mn, mx = op.min(0) - 1, op.max(0) + 1
    w, h = max(2, int((mx[0] - mn[0]) / 0.5)), max(2, int((mx[1] - mn[1]) / 0.5))
    def mask(poly):
        im = Image.new('L', (w, h), 0)
        ImageDraw.Draw(im).polygon([((x - mn[0]) / 0.5, (mx[1] - y) / 0.5) for x, y in poly], fill=255)
        return np.array(im) > 0
    mo = mask(op)
    if mo.sum() == 0: return 0.0
    mp = np.zeros_like(mo)
    for i in idxs: mp |= mask(bpolys[i])
    return float((mo & mp).sum() / mo.sum())


tree_b = cKDTree(bcent)
bl_idx = []  # (номер объекта в features, контур в локальных метрах) для всех зданий
n_ov_dropped = 0
for op in ov_polys:
    c = op.mean(0)
    near = tree_b.query_ball_point(c, r=60)
    if covered_fraction(op, near) >= 0.4:
        n_ov_dropped += 1
        continue
    feat('building', {'type': 'Polygon', 'coordinates': [ll(op) + [ll(op[:1])[0]]]}, src='overture', _a=abs(area(op)))
    bl_idx.append((len(features) - 1, op))
for i in plan_kept:
    p = bpolys[i]
    props = {'src': 'genplan', '_a': abs(area(p))}
    if b_label[i]:
        k = expl_key(b_label[i])
        props['label'] = short_label(b_label[i])
        if k: props['num'] = EXPL[k]
    feat('building', {'type': 'Polygon', 'coordinates': [ll(p) + [ll(p[:1])[0]]]}, **props)
    bl_idx.append((len(features) - 1, p))
print(f'здания: плана {len(plan_kept)} (+{n_ruin} развалин), Overture заменено планом {n_ov_dropped}, '
      f'оставлено Overture {sum(1 for f in features if f["properties"].get("src") == "overture")}', file=sys.stderr)

# Подписи общественных зданий на плане стоят на штриховках, а не на контурах «здание»: подпись достаётся тому зданию
# (плана или Overture), внутри которого она стоит, иначе ближайшему не дальше 35 м.
bl_c = np.array([p.mean(0) for _, p in bl_idx])
used = {features[i]['properties'].get('label') for i, _ in bl_idx if features[i]['properties'].get('label')}
for text, m in labels:
    k = expl_key(text)
    if not k or text in used and k not in ('магазин', 'Магазин'): continue
    inside = [n for n, (_, p) in enumerate(bl_idx) if pip(p, m.reshape(1, 2))[0]]
    if inside: j = min(inside, key=lambda n: abs(area(bl_idx[n][1])))
    else:
        dd = np.hypot(*(bl_c - m).T)
        j = int(dd.argmin()) if dd.min() < 35 else None
    if j is None: continue
    pr = features[bl_idx[j][0]]['properties']
    if 'label' not in pr:
        pr['label'], pr['num'] = short_label(text), EXPL[k]
        used.add(text)

# ───────────────────────── кварталы и красные линии ─────────────────────────
red = [e for e in ents if e['layer'] == '__RED_LINE']
red_pts = [tf(geom(e)[0][1]) for e in red]
# 0, 1, 4–10 — кварталы существующей застройки; 2, 3, 13–28 — проектные; 11, 12 — внешний контур
# улично-дорожной сети (11 — северная часть); 29 — граница населённого пункта.
EXISTING_Q = [0, 1, 4, 5, 6, 7, 8, 9, 10]
PROJECT_Q = [2, 3] + list(range(13, 29))
for i in EXISTING_Q:
    p = red_pts[i]
    feat('quarter', {'type': 'Polygon', 'coordinates': [ll(p) + [ll(p[:1])[0]]]}, qi=i)

# ───────────────────────── улицы: оси OSM, выровненные по свободному коридору плана ─────────────────────────
# Красные линии плана охватывают и кварталы, и полосы домов вдоль улиц, поэтому вычислить ось только по
# ним нельзя. Берём улицы OSM и сдвигаем каждую точку (в пределах 12 м) на середину свободного коридора
# между кварталами, ограждениями участков и зданиями плана; магистрали (дороги района) не трогаем.
CELL = 1.0
allp = np.vstack([red_pts[12], red_pts[11], red_pts[29]])
x0, y0 = allp.min(0) - 20
x1, y1 = allp.max(0) + 20
Wc, Hc = int((x1 - x0) / CELL) + 1, int((y1 - y0) / CELL) + 1


def raster(polys, lines=()):
    im = Image.new('L', (Wc, Hc), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        d.polygon([((x - x0) / CELL, (y1 - y) / CELL) for x, y in p], fill=255)
    for p in lines:
        d.line([((x - x0) / CELL, (y1 - y) / CELL) for x, y in p], fill=255, width=1)
    return np.array(im) > 0


par_geoms = []  # ограждения участков (локальные метры)
for e in ents:
    if e['layer'] in ('_ograj', '_Zabor', 'забор') and e['type'] == 'LWPOLYLINE':
        for k, p in geom(e):
            m = tf(p)
            if len(m) >= 3: par_geoms.append((k, m))
obstacle = raster([red_pts[i] for i in EXISTING_Q + PROJECT_Q] + [bpolys[i] for i in range(len(bpolys))],
                  [m for k, m in par_geoms])
free = ~obstacle
dist_map = ndimage.distance_transform_edt(free) * CELL

xml = open(OSM, encoding='utf-8').read()
nd = {m[0]: (float(m[1]), float(m[2])) for m in re.findall(r'<node id="(\d+)"[^>]*?lat="([\d.-]+)" lon="([\d.-]+)"', xml)}
OSMCLS = {'motorway': 'major', 'trunk': 'major', 'primary': 'major', 'secondary': 'major', 'tertiary': 'mid', 'unclassified': 'mid', 'residential': 'street', 'service': 'minor'}
village_hull = red_pts[29]


def resample(pts, step):
    seg = np.hypot(*np.diff(pts, axis=0).T)
    cum = np.r_[0, np.cumsum(seg)]
    n = max(2, int(cum[-1] / step) + 1)
    t = np.linspace(0, cum[-1], n)
    return np.c_[np.interp(t, cum, pts[:, 0]), np.interp(t, cum, pts[:, 1])]


def rdp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.hypot(*ab)
    q = pts - a
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / L if L > 0 else np.hypot(q[:, 0], q[:, 1])
    i = int(d.argmax())
    if d[i] > tol: return np.vstack([rdp(pts[:i + 1], tol)[:-1], rdp(pts[i:], tol)])
    return np.array([a, b])


def length(p): return float(np.hypot(*np.diff(p, axis=0).T).sum())


def dist_to_line(pt, line):
    """Расстояние от точки до ломаной (по отрезкам)."""
    a, b = line[:-1], line[1:]
    ab = b - a
    t = np.clip(((pt - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    return float(np.hypot(*(a + ab * t[:, None] - pt).T).min())


def dm(pt):
    r, c = int((y1 - pt[1]) / CELL), int((pt[0] - x0) / CELL)
    return dist_map[r, c] if 0 <= r < Hc and 0 <= c < Wc else 0.0


street_labels = [(re.sub(r'^ул\.\s*', 'ул. ', t), m) for t, m in labels if t.lower().startswith('ул.')]
osm_village = []
n_streets = 0
shift_stats = []
for m in re.finditer(r'<way id="(\d+)"[^>]*>([\s\S]*?)</way>', xml):
    tags = dict(re.findall(r'<tag k="([^"]*)" v="([^"]*)"', m[2]))
    hw = tags.get('highway')
    if not hw: continue
    pts = [nd[r] for r in re.findall(r'<nd ref="(\d+)"', m[2]) if r in nd]
    if len(pts) < 2: continue
    xy = np.array([[(lo - LON0) * MLON, (la - LAT0) * MLAT] for la, lo in pts])
    cls = OSMCLS.get(hw, 'minor')
    inside = pip(village_hull, xy).any()
    if cls in ('street', 'minor') and inside:
        r = resample(xy, 5.0)
        tg = np.gradient(r, axis=0)
        tg /= np.maximum(np.hypot(tg[:, 0], tg[:, 1]), 1e-9)[:, None]
        nrm = np.c_[-tg[:, 1], tg[:, 0]]
        offs = np.zeros(len(r))
        for i, (p_, n_) in enumerate(zip(r, nrm)):
            cand = np.arange(-12, 12.5, 1.0)
            score = np.array([dm(p_ + n_ * s) - 0.15 * abs(s) for s in cand])
            if dm(p_) > 0 or score.max() > 1.5: offs[i] = cand[score.argmax()]
        k = np.ones(5) / 5
        offs = np.convolve(np.pad(offs, 2, mode='edge'), k, mode='valid')
        shift_stats += list(np.abs(offs))
        r = r + nrm * offs[:, None]
        r = rdp(r, 1.0)
    else:
        r = rdp(xy, 1.0)
    props = dict(road=cls, src='genplan' if (cls in ('street', 'minor') and inside) else 'osm', hw=hw)
    # Название — только русское, с плана (подписи «ул.Женис»); казахские названия OSM не переносятся.
    if street_labels:
        dl = [(dist_to_line(lm, r), nm) for nm, lm in street_labels]
        dmin, nm = min(dl)
        if dmin < 25: props['name'] = nm
    if props['src'] == 'genplan':
        osm_village.append((r, props))  # улицы села — после сопоставления с сетью, выведенной из кварталов плана
        continue
    feat('road', {'type': 'LineString', 'coordinates': ll(r)}, **props)
    n_streets += 1
print(f'улицы: {n_streets} осей; сдвиг по плану: среднее {np.mean(shift_stats):.1f} м, максимум {np.max(shift_stats):.1f} м', file=sys.stderr)


# ───────────────────────── улицы: оси промежутков между кварталами плана ─────────────────────────
# Промежутки между существующими кварталами (ширина до ~34 м) — это улицы и переулки. Берём «замыкание» кварталов
# (заполняет только узкие промежутки, края кварталов не раздувает) за вычетом самих кварталов и утончаем до осей.
# Улицы OSM, не совпавшие с этой сетью (вдоль крайних кварталов), добавляются кусками дальше 14 м от неё.
def thin(img):
    """Утончение Zhang–Suen."""
    im = img.astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            q = np.pad(im, 1)
            P2, P3, P4, P5, P6, P7, P8, P9 = (q[:-2, 1:-1], q[:-2, 2:], q[1:-1, 2:], q[2:, 2:], q[2:, 1:-1], q[2:, :-2], q[1:-1, :-2], q[:-2, :-2])
            nb = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9
            seq = [P2, P3, P4, P5, P6, P7, P8, P9, P2]
            trans = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            c = ((P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)) if step == 0 else ((P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0))
            rm = (im == 1) & (nb >= 2) & (nb <= 6) & (trans == 1) & c
            if rm.any():
                im[rm] = 0
                changed = True
    return im.astype(bool)


Qm = raster([red_pts[i] for i in EXISTING_Q])
rr, cc = np.nonzero(Qm)
pad = 40
ra, rb, ca, cb = max(rr.min() - pad, 0), min(rr.max() + pad, Hc), max(cc.min() - pad, 0), min(cc.max() + pad, Wc)
Qc = Qm[ra:rb, ca:cb]
RG = 17.0
dil = ndimage.distance_transform_edt(~Qc) * CELL <= RG
closed = ndimage.distance_transform_edt(dil) * CELL > RG
gap = ndimage.binary_opening(closed & ~Qc, iterations=2)
skel = thin(gap)
ys_, xs_ = np.nonzero(skel)
pix = {(int(a), int(b)) for a, b in zip(ys_, xs_)}
NB8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def nbrs(q):
    return [(q[0] + a, q[1] + b) for a, b in NB8 if (q[0] + a, q[1] + b) in pix]


deg = {q: len(nbrs(q)) for q in pix}
nodes = {q for q, dg in deg.items() if dg != 2}
seen, edges = set(), []
for st in nodes:
    for nx_ in nbrs(st):
        if (st, nx_) in seen:
            continue
        path = [st, nx_]
        seen.add((st, nx_))
        prev, cur = st, nx_
        while cur not in nodes:
            nxt = [q for q in nbrs(cur) if q != prev]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            path.append(cur)
        seen.add((cur, path[-2]))
        edges.append(path)
for _ in range(3):  # отсечь короткие отростки (концевая ветка короче 20 м, выходящая из развилки)
    cnt = collections.Counter()
    for pth in edges:
        cnt[pth[0]] += 1
        cnt[pth[-1]] += 1
    edges = [pth for pth in edges if not ((cnt[pth[0]] == 1 or cnt[pth[-1]] == 1) and len(pth) * CELL < 20 and (cnt[pth[0]] > 2 or cnt[pth[-1]] > 2))]


def to_m(path):
    return np.array([[x0 + (cb_ + ca + 0.5) * CELL, y1 - (rb_ + ra + 0.5) * CELL] for rb_, cb_ in path])


net = []
for pth in edges:
    m = to_m(pth)
    if len(m) < 6:
        continue
    m = rdp(m, 2.0)
    if length(m) >= 20:
        net.append(m)
net_pts = np.vstack([resample(m, 3.0) for m in net]) if net else np.zeros((0, 2))
net_tree = cKDTree(net_pts)
n_net = 0
for m in net:
    props = dict(road='street', src='genplan', hw='gap')
    if street_labels:
        dmin, nm = min((dist_to_line(lm, m), nm_) for nm_, lm in street_labels)
        if dmin < 25: props['name'] = nm
    feat('road', {'type': 'LineString', 'coordinates': ll(m)}, **props)
    n_net += 1
# улицы OSM села — только куски, которых нет в сети
n_osm = 0
for r, props in osm_village:
    pts = resample(r, 4.0)
    far = net_tree.query(pts)[0] > 14.0 if len(net_pts) else np.ones(len(pts), bool)
    run = []
    for pt, f in list(zip(pts, far)) + [(None, False)]:
        if f:
            run.append(pt)
        else:
            if len(run) >= 5:
                feat('road', {'type': 'LineString', 'coordinates': ll(np.array(run))}, **props)
                n_osm += 1
            run = []
print(f'улицы села: {n_net} осей между кварталами + {n_osm} кусков по OSM вне этой сети', file=sys.stderr)

# Связность: концы улиц села, не дошедшие до перекрёстка, достраиваются до ближайшей другой улицы (до 35 м), чтобы линии не обрывались.
def local_of(f):
    return np.array([((lo - LON0) * MLON, (la - LAT0) * MLAT) for lo, la in f['geometry']['coordinates']])


def nearest_on_line(pt, line):
    a, b = line[:-1], line[1:]
    ab = b - a
    t = np.clip(((pt - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    proj = a + ab * t[:, None]
    dd = np.hypot(*(proj - pt).T)
    k = int(dd.argmin())
    return float(dd[k]), proj[k]


road_idx = [i for i, f in enumerate(features) if f['properties']['kind'] == 'road']
road_loc = {i: local_of(features[i]) for i in road_idx}
n_join = 0
for i in road_idx:
    if features[i]['properties'].get('src') != 'genplan':
        continue
    line = road_loc[i]
    for end in (0, -1):
        pt = line[end]
        best = None
        for j in road_idx:
            if j == i:
                continue
            dd, proj = nearest_on_line(pt, road_loc[j])
            if best is None or dd < best[0]:
                best = (dd, proj)
        if best and 0.5 < best[0] <= 35:
            line = np.vstack([best[1], line]) if end == 0 else np.vstack([line, best[1]])
            n_join += 1
    road_loc[i] = line
    features[i]['geometry']['coordinates'] = ll(line)
print(f'связность: достроено концов улиц до перекрёстков: {n_join}', file=sys.stderr)

# ───────────────────────── участки (ограждения) ─────────────────────────
n_par = 0
for e in ents:
    if e['layer'] in ('_ograj', '_Zabor', 'забор') and e['type'] == 'LWPOLYLINE':
        for k, p in geom(e):
            m = tf(p)
            if len(m) < 3 or length(m) < 8: continue
            if not (-900 < m[:, 0].mean() < 1400 and -1300 < m[:, 1].mean() < 900): continue
            feat('parcel', {'type': 'LineString', 'coordinates': ll(rdp(m, 0.4))}, closed=(k == 'poly'))
            n_par += 1
print(f'участков/ограждений: {n_par}', file=sys.stderr)

# ───────────────────────── зоны плана (существующие) ─────────────────────────
ZONE = {'_кладвище': 'cemetery', '_комун склад': 'industrial'}
for e in ents:
    z = ZONE.get(e['layer'])
    if z and e['type'] == 'HATCH':
        for k, p in geom(e):
            m = tf(p)
            if abs(area(m)) > 3000: feat('zone', {'type': 'Polygon', 'coordinates': [ll(m) + [ll(m[:1])[0]]]}, zone=z)

# ───────────────────────── подписанные объекты и улицы ─────────────────────────
for text, m in labels:
    k = expl_key(text)
    if k: feat('poi', {'type': 'Point', 'coordinates': ll(m)[0]}, name=short_label(text), num=EXPL[k])
    elif text.lower().startswith('ул.'): feat('streetlabel', {'type': 'Point', 'coordinates': ll(m)[0]}, name=text)
    elif text in ('ТОО "Поиск" 2К',) or text.startswith('ТОО'): feat('poi', {'type': 'Point', 'coordinates': ll(m)[0]}, name=short_label(text), num=10)

for f in features:
    f['properties'].pop('_a', None) if False else None

fc = {
    'type': 'FeatureCollection',
    'name': 'Генеральный план с. Турген (схема развития и застройки, ТОО «Колдау», 2020): ГП-3, существующее положение',
    'registration': {'scale': SC, 'rotation_deg': TH, 'shift_m': [float(T[0]), float(T[1])], 'origin': [LAT0, LON0], **REG,
                     'method': 'совмещение центров контуров зданий плана с контурами Overture (голосование по сдвигу + подгонка подобия)'},
    'features': features,
}
json.dump(fc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('записано', OUT, collections.Counter(f['properties']['kind'] for f in features), file=sys.stderr)
