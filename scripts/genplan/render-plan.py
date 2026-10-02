#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Рисует перерисовку генерального плана (существующее положение) для фотоархива: assets/photos/genplan-2020.jpg и превью.

Запуск: python scripts/genplan/render-plan.py   (нужны Pillow и шрифт Arial; на других системах поправьте FONT)
Источник — data/raw/genplan-2020.geojson (см. extract.py): здания, кварталы, участки, улицы и подписи плана ГП-3.
Это перерисовка, а не копия листа: проектные кварталы плана не показаны, условные обозначения упрощены.
"""
import json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\arial.ttf'
FONTB = r'C:\Windows\Fonts\arialbd.ttf'
LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * math.cos(math.radians(LAT0))
# окно: существующее село (в локальных метрах от LAT0/LON0), север вверху
X0, X1, Y0, Y1 = -330, 600, -600, 600
H_OUT = 1100
S = 1.0  # пикселей на метр в выходной картинке
SS = 3   # сглаживание: рисуем втрое крупнее и уменьшаем

fc = json.load(open('data/raw/genplan-2020.geojson', encoding='utf-8'))
W = int((X1 - X0) * S)
H = int((Y1 - Y0) * S)
img = Image.new('RGB', (W * SS, H * SS), (250, 247, 240))
d = ImageDraw.Draw(img, 'RGBA')


def px(coords):
    a = np.array(coords, float)
    m = np.c_[(a[:, 0] - LON0) * MLON, (a[:, 1] - LAT0) * MLAT]
    return [((x - X0) * S * SS, (Y1 - y) * S * SS) for x, y in m]


def centroid(coords):
    p = np.array(px(coords))
    return p.mean(0)


by = {}
for f in fc['features']:
    by.setdefault(f['properties']['kind'], []).append(f)

for f in by.get('zone', []):
    col = (205, 214, 190, 255) if f['properties']['zone'] == 'cemetery' else (232, 226, 210, 255)
    d.polygon(px(f['geometry']['coordinates'][0]), fill=col)
for f in by.get('quarter', []):
    d.polygon(px(f['geometry']['coordinates'][0]), fill=(238, 232, 214, 255), outline=(170, 160, 130, 255))
for f in by.get('parcel', []):
    d.line(px(f['geometry']['coordinates']), fill=(200, 192, 170, 255), width=SS)
RW = {'major': 7, 'mid': 5, 'street': 4, 'minor': 2}
for f in by.get('road', []):
    p = f['properties']
    d.line(px(f['geometry']['coordinates']), fill=(214, 204, 178, 255), width=int(RW[p['road']] * 1.6 * S * SS))
for f in by.get('road', []):
    p = f['properties']
    d.line(px(f['geometry']['coordinates']), fill=(160, 150, 125, 255), width=max(1, SS // 2))
PUBLIC = (178, 74, 52, 255)
for f in by.get('building', []):
    pub = bool(f['properties'].get('num')) and f['properties']['num'] != 12
    d.polygon(px(f['geometry']['coordinates'][0]), fill=PUBLIC if pub else (122, 108, 90, 255))

img = img.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(img, 'RGBA')
F = ImageFont.truetype(FONT, 13)
FB = ImageFont.truetype(FONTB, 12)
FT = ImageFont.truetype(FONTB, 17)


def pxs(coords):
    return [(x / SS, y / SS) for x, y in px(coords)]


# номера объектов экспликации плана на зданиях
NAMES = {}
for f in by.get('building', []):
    p = f['properties']
    if p.get('num') and p['num'] != 12:
        NAMES.setdefault(p['num'], p['label'])
        c = np.array(pxs(f['geometry']['coordinates'][0])).mean(0)
        d.ellipse([c[0] - 8, c[1] - 8, c[0] + 8, c[1] + 8], fill=(255, 255, 255, 235), outline=PUBLIC)
        d.text((c[0], c[1]), str(p['num']), fill=PUBLIC, font=FB, anchor='mm')
for f in by.get('poi', []):
    p = f['properties']
    if p['num'] in (14,):
        c = np.array(pxs([f['geometry']['coordinates']]))[0]
        d.text(tuple(c), 'футбольное поле', fill=(90, 100, 70, 255), font=F, anchor='mm')
for f in by.get('road', []):
    p = f['properties']
    if p.get('name'):
        c = f['geometry']['coordinates']
        mid = np.array(pxs([c[len(c) // 2]]))[0]
        d.text((mid[0] + 14, mid[1]), p['name'], fill=(70, 62, 50, 255), font=F, anchor='lm')

# легенда
items = sorted(NAMES.items())
extra = [(12, 'Магазин (4 объекта)')]
lines = [f'{n}  {t[0].upper()}{t[1:]}' for n, t in sorted(items + extra)]
lh = 19
bx, by0 = 14, 46
d.rectangle([bx - 6, by0 - 6, bx + 232, by0 + lh * (len(lines) + 1) + 4], fill=(250, 247, 240, 235), outline=(190, 180, 155, 255))
d.text((bx, by0 + 2), 'Подписанные объекты плана', fill=(60, 50, 40, 255), font=FB)
for i, t in enumerate(lines):
    d.text((bx, by0 + lh * (i + 1) + 2), t, fill=PUBLIC if not t.startswith('12 ') else (70, 62, 50, 255), font=F)

# масштабная линейка и север
x, y = W - 150, H - 58
d.line([(x, y), (x + 100 * S, y)], fill=(60, 50, 40, 255), width=3)
d.text((x + 50 * S, y - 6), '100 м', fill=(60, 50, 40, 255), font=F, anchor='mb')
d.text((W - 36, 40), 'С', fill=(60, 50, 40, 255), font=FT, anchor='mm')
d.polygon([(W - 36, 54), (W - 42, 72), (W - 36, 67), (W - 30, 72)], fill=(60, 50, 40, 255))

# заголовок и примечание
d.rectangle([0, 0, W, 30], fill=(60, 50, 40, 255))
d.text((10, 15), 'Турген. Генеральный план 2020 г. (ГП-3), существующее положение — перерисовка', fill=(255, 255, 255, 255), font=FB, anchor='lm')
d.rectangle([0, H - 30, W, H], fill=(60, 50, 40, 255))
d.text((10, H - 15), 'По чертежу ТОО «Колдау», 2020. Проектные кварталы не показаны; условные обозначения упрощены.', fill=(255, 255, 255, 255), font=F, anchor='lm')

scale = H_OUT / max(W, H)
full = img.resize((round(W * scale), round(H * scale)), Image.LANCZOS) if scale < 1 else img
full.save('assets/photos/genplan-2020.jpg', quality=82, optimize=True)
th = full.copy()
th.thumbnail((360, 360), Image.LANCZOS)
th.save('assets/photos/thumb/genplan-2020.jpg', quality=72, optimize=True)
print('готово', full.size, th.size)
