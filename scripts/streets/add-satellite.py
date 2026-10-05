# Дорога от села к фермам через реку — со спутникового снимка, который дал автор сайта (скриншот Google Earth, октябрь 2026).
# Снимок привязан подобием по контурам зданий основы (масштаб 1,504 м/px, поворот 0,08°); точки дороги сняты вручную
# по пикселям снимка. Пишет data/raw/satellite-2026.geojson; scripts/build-base-map.mjs добавляет его к основе.
import json, math
LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * math.cos(math.radians(LAT0))
S, TH, TX, TY = 0.664711654, 0.00138070694, 494.105799, 494.809166  # пиксель = S·R(TH)·метры + (TX, TY), ось y вниз


def ll(px, py):
    u, v = (px - TX) / S, -(py - TY) / S
    c, s = math.cos(TH), math.sin(TH)
    x, y = c * u + s * v, -s * u + c * v
    return [round(LON0 + x / MLON, 6), round(LAT0 + y / MLAT, 6)]


TRACK = [(578, 453), (548, 442), (500, 425), (440, 405), (385, 383), (330, 358), (300, 345), (280, 330), (268, 305), (262, 275), (263, 228)]
fc = {"type": "FeatureCollection",
      "note": "Грунтовая дорога от западного края села к переезду через Ишим и к фермам на левом берегу: видна на спутниковом снимке, переданном автором сайта в октябре 2026 г.; точность около 5–10 м.",
      "labels": [],
      "features": [{"type": "Feature", "properties": {"kind": "road", "road": "minor", "src": "satellite-2026"},
                    "geometry": {"type": "LineString", "coordinates": [ll(*p) for p in TRACK]}}]}
json.dump(fc, open('data/raw/satellite-2026.geojson', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(fc['features'][0]['geometry']['coordinates'])
