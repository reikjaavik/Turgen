# Недостающие улицы — со скриншота карты села, который дал автор сайта (map.png, наклонный вид, Яндекс Карты).
# Скриншот привязан гомографией по рисунку уже известных улиц (H_map.npy, см. README); здесь из него берутся
# оси улиц, которых нет в основе (дальше 9 м от известных улиц; параллельные дубли ближе 30 м отбрасываются), и пишутся в data/raw/streets-2026.geojson.
# Запуск: python scripts/streets/extract-streets.py <map.png> <H_map.npy>
import json, math, sys, collections
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize

LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * math.cos(math.radians(LAT0))
to_m = lambda lat, lon: ((lon - LON0) * MLON, (lat - LAT0) * MLAT)
to_ll = lambda x, y: (round(LON0 + x / MLON, 6), round(LAT0 + y / MLAT, 6))

H = np.append(np.load(sys.argv[2]), 1).reshape(3, 3)
Hi = np.linalg.inv(H)


def to_ground(px):
    p = np.c_[px, np.ones(len(px))] @ Hi.T
    return p[:, :2] / p[:, 2:3]


plan = json.load(open('data/raw/genplan-2020.geojson', encoding='utf-8'))
known = [np.array([to_m(lat, lon) for lon, lat in f['geometry']['coordinates']]) for f in plan['features'] if f['properties'].get('kind') == 'road']


def dense(line, step=3.0):
    out = []
    for a, b in zip(line, line[1:]):
        n = max(1, int(np.hypot(*(b - a)) / step))
        out += [a + (b - a) * i / n for i in range(n)]
    return np.array(out + [line[-1]])


from scipy.spatial import cKDTree
tree = cKDTree(np.vstack([dense(l) for l in known]))

a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mask = (b - r > 8) & (b - g > 3) & (b > 185) & (r > 165) & (r < 228)
mask[:, :640] = False; mask[:185] = False
mask = ndimage.binary_closing(ndimage.binary_opening(mask), iterations=2)
sk = skeletonize(mask)
ys, xs = np.nonzero(sk)
gm = to_ground(np.c_[xs, ys])
# только село (в границах скриншота, без дальних дорог) и только то, чего нет в основе
far = tree.query(gm)[0] > 9
inside = (np.hypot(gm[:, 0] - 250, gm[:, 1] + 250) < 950)
keep = far & inside
new = np.zeros_like(sk); new[ys[keep], xs[keep]] = True
lab, n = ndimage.label(new, structure=np.ones((3, 3)))


def longest_path(pix):
    S = set(map(tuple, pix))
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in S]

    def bfs(s):
        prev = {s: None}; q = collections.deque([s]); last = s
        while q:
            last = q.popleft()
            for t in nb(last):
                if t not in prev: prev[t] = last; q.append(t)
        return last, prev
    e1, _ = bfs(next(iter(S)))
    e2, prev = bfs(e1)
    path = []
    while e2 is not None: path.append(e2); e2 = prev[e2]
    return path


def rdp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; L = np.hypot(*ab) or 1
    d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(d.argmax())
    if d[i] < tol: return np.array([a, b])
    return np.vstack([rdp(pts[:i + 1], tol)[:-1], rdp(pts[i:], tol)])


lines = []
stack = [np.argwhere(lab == i) for i in range(1, n + 1)]
while stack:
    pix = stack.pop()
    if len(pix) < 8: continue
    path = longest_path(pix)
    gp = to_ground(np.array([(x, y) for y, x in path], float))
    if np.hypot(*np.diff(gp, axis=0).T).sum() < 25: continue
    if tree.query(gp)[0].max() >= 30: lines.append(rdp(gp, 2.5))  # иначе это та же улица, что уже есть в основе, со сдвигом
    # остаток связной части без пути и его окружения — ответвления, каждое обрабатывается отдельно
    P = np.array(path)
    rest = np.array([q for q in pix if np.abs(P - q).max(axis=1).min() > 2])
    if len(rest) == 0: continue
    img = np.zeros_like(sk); img[rest[:, 0], rest[:, 1]] = True
    sub, m = ndimage.label(img, structure=np.ones((3, 3)))
    stack += [np.argwhere(sub == j) for j in range(1, m + 1)]

# концы довести до ближайшей улицы (известной или новой), если она ближе 30 м
allpts = [dense(l) for l in known] + [dense(l) for l in lines]
for k, l in enumerate(lines):
    others = np.vstack([p for j, p in enumerate(allpts) if j != len(known) + k])
    t = cKDTree(others)
    for end in (0, -1):
        d, j = t.query(l[end])
        if 0.5 < d < 30:
            lines[k] = np.vstack([others[j], lines[k]]) if end == 0 else np.vstack([lines[k], others[j]])
            l = lines[k]

# Отобрано вручную по контрольной картинке: обрывки (подпись, край скриншота) и дубль ул. Достык — начало линии (lon, lat).
DROP = [(72.317152, 50.755908), (72.325153, 50.759444), (72.32596, 50.762584), (72.314632, 50.765157)]
# Разрыв под подписью «ул. Есиль» на ответвлении к югу: две части — одна улица.
JOIN = [((72.323697, 50.755797), (72.324685, 50.755733))]
ll_lines = [[to_ll(x, y) for x, y in l] for l in lines]
ll_lines = [l for l in ll_lines if not any(abs(l[0][0] - d[0]) < 2e-5 and abs(l[0][1] - d[1]) < 2e-5 for d in DROP)]
near = lambda p, q: abs(p[0] - q[0]) < 2e-5 and abs(p[1] - q[1]) < 2e-5
for a_, b_ in JOIN:
    i = next((k for k, l in enumerate(ll_lines) if near(l[-1], a_)), None); j = next((k for k, l in enumerate(ll_lines) if near(l[0], b_)), None)
    if i is not None and j is not None and i != j:
        ll_lines[i] = ll_lines[i] + ll_lines[j]; ll_lines.pop(j)

# Названия улиц: точки вдоль подписанных на скриншоте улиц (пиксели map.png) → координаты.
NAMES = {
    'ул. Жастар': [(1155, 170), (1140, 430), (1090, 530), (1025, 665), (965, 765), (900, 860), (820, 1000), (740, 1130)],
    'ул. Достык': [(790, 570), (930, 598), (1150, 665)],
    'ул. Береке': [(805, 425), (730, 520)],
    'ул. Енбек': [(320, 750), (400, 775), (615, 833)],
    'ул. Есиль': [(1300, 210), (1320, 330), (1310, 500), (1270, 710), (1200, 820), (1105, 940), (950, 1150), (1125, 1095)],
    'ул. Женис': [(985, 160), (985, 300), (960, 420), (900, 530), (820, 655), (730, 790), (615, 950), (540, 1060)],
}
labels = []
for name, pxs in NAMES.items():
    for (x, y), gp in zip(pxs, to_ground(np.array(pxs, float) + [640, 185])):
        lon, lat = to_ll(*gp); labels.append({"name": name, "lat": lat, "lon": lon})


def length_m(l):
    m = np.array([to_m(lat, lon) for lon, lat in l]); return float(np.hypot(*np.diff(m, axis=0).T).sum())


# Границы со скриншота: красные контуры — граница села и «Микрорайон № 1» за рекой (подпись на скриншоте).
from skimage.measure import find_contours, approximate_polygon
red = (r > 200) & (g < 150) & (b < 140) & (r - g > 60)
red[:, :640] = False; red[:185] = False
filled = ndimage.binary_fill_holes(ndimage.binary_closing(red, iterations=3))
rl, rn = ndimage.label(filled)
bounds = []
for i in range(1, rn + 1):
    comp = rl == i
    if comp.sum() < 20000: continue
    c = max(find_contours(comp.astype(float), 0.5), key=len)
    poly = approximate_polygon(c, 6)[:, ::-1]  # (x, y)
    ring = [to_ll(x, y) for x, y in to_ground(poly)]
    big = comp.sum() > 400000
    bounds.append({"type": "Feature", "properties": {"kind": "boundary", "role": "village" if big else "micro", **({} if big else {"name": "Микрорайон № 1"}), "src": "streets-2026"},
                   "geometry": {"type": "Polygon", "coordinates": [ring]}})
print('границы:', [(f['properties']['role'], len(f['geometry']['coordinates'][0])) for f in bounds])
# Значки магазинов на скриншоте (пиксели map.png) → координаты; для отметок мест.
SHOPS = {'Алатау': (1567 * 1.28, 506 * 1.28), 'Самал': (1477 * 1.28, 648 * 1.28), 'Радуга': (1235 * 1.28, 441 * 1.28), 'Мастерок': (1265 * 1.28, 506 * 1.28)}
for nm, gp in zip(SHOPS, to_ground(np.array(list(SHOPS.values())))): print(nm.encode('unicode_escape').decode(), to_ll(*gp)[::-1])

feats = [{"type": "Feature", "properties": {"kind": "road", "road": "street" if length_m(l) > 220 else "minor", "src": "streets-2026"},
          "geometry": {"type": "LineString", "coordinates": l}} for l in ll_lines]
json.dump({"type": "FeatureCollection", "note": "Улицы, которых не было в основе, и названия улиц: сняты со скриншота карты села, предоставленного автором сайта в октябре 2026 г. (Яндекс Карты); точность около 5–10 м.", "labels": labels, "features": feats + bounds},
          open('data/raw/streets-2026.geojson', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(feats), len(labels), len(bounds))
