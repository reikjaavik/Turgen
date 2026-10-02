#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Старый план с. Тургеневка (скан листа в PDF) → прозрачный слой для карты и фото для архива.

Запуск: python scripts/overlays/make-plan-turgenevka.py "<скан>.pdf"
Результат: assets/overlays/plan-turgenevka.png (чернила листа на прозрачном фоне, север вверху, 0,8 м/пиксель),
           assets/photos/plan-turgenevka.jpg (+ thumb) — скан листа, повёрнутый так, чтобы текст читался;
           печатает углы изображения (lon/lat) для data/overlays.json.

Привязка. На листе север справа (роза ветров), поэтому скан поворачивается на 90°. Аффинное преобразование листа
в метры (восток, север от 50.7625°с.ш., 72.32°в.д.) подогнано по пяти объектам, которые на плане и на современном
генплане 2020 года стоят на тех же местах: школа, стадион, Дом культуры, детский сад, торговый центр.
Положение центральной конторы совхоза, в подгонку не входившее, служит проверкой.
Координаты точек на листе — пиксели повёрнутого скана (2505×1603), прочитаны по подписям листа.
"""
import re, sys, io, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = sys.argv[1]
LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * math.cos(math.radians(LAT0))
RES = 0.8  # м/пиксель выходного слоя

CTRL = {  # пиксели повёрнутого скана → (восток, север), м
    'школа': ((1550, 970), (313, 128)),
    'стадион': ((1767, 996), (359, 234)),
    'дом культуры': ((1452, 710), (158, 105)),
    'детский сад': ((1362, 957), (305, 18)),
    'торговый центр': ((1182, 847), (206, -72)),
}
CHECK = {'центральная контора': ((1092, 872), (196, -136))}

A, b = [], []
for (x, y), (E, N) in CTRL.values():
    A += [[x, y, 1, 0, 0, 0], [0, 0, 0, x, y, 1]]
    b += [E, N]
p = np.linalg.lstsq(np.array(A, float), np.array(b, float), rcond=None)[0].reshape(2, 3)
for n, ((x, y), (E, N)) in CTRL.items():
    print(f'{n}: невязка {np.hypot(*(p @ [x, y, 1] - [E, N])):.1f} м')
for n, ((x, y), (E, N)) in CHECK.items():
    print(f'{n} (проверка): {np.hypot(*(p @ [x, y, 1] - [E, N])):.1f} м')
print('масштаб, м/пикс:', np.hypot(*p[:, 0]).round(3), np.hypot(*p[:, 1]).round(3), ' поворот, °:', round(math.degrees(math.atan2(p[1, 0], p[0, 0])), 1))

# --- скан: в PDF одна страница-картинка (JPEG) — достаём её без внешних библиотек
raw = open(SRC, 'rb').read()
i, j = raw.find(b'\xff\xd8\xff'), raw.rfind(b'\xff\xd9')
src = Image.open(io.BytesIO(raw[i:j + 2])).convert('RGB').rotate(90, expand=True)
assert src.size == (2505, 1603), src.size

# --- архивное фото: весь лист
arch = src.copy()
arch.thumbnail((1100, 1100), Image.LANCZOS)
arch.save('assets/photos/plan-turgenevka.jpg', quality=80, optimize=True)
th = arch.copy(); th.thumbnail((360, 360), Image.LANCZOS)
th.save('assets/photos/thumb/plan-turgenevka.jpg', quality=72, optimize=True)

# --- чернила: выравниваем освещение (фон бумаги — максимум в окне), тёмное → непрозрачное
g = np.asarray(src.convert('L'), float)
bgm = Image.fromarray(g.astype(np.uint8)).filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.GaussianBlur(24))
bg = np.maximum(np.asarray(bgm, float), 1)
ink = np.clip(1 - g / bg, 0, 1)
alpha = np.clip((ink - 0.16) / 0.36, 0, 1)
lab, n = ndimage.label(alpha > 0.35, structure=np.ones((3, 3)))
sizes = ndimage.sum(np.ones_like(alpha), lab, range(1, n + 1))
keep = ndimage.binary_dilation(np.isin(lab, [k + 1 for k, sz in enumerate(sizes) if sz >= 25]), iterations=3)
alpha = alpha * keep

# маска: поле плана без заголовка, легенды, розы ветров и фона (пиксели повёрнутого скана)
mask = Image.new('L', src.size, 0)
d = ImageDraw.Draw(mask)
d.polygon([(300, 318), (1660, 318), (1660, 372), (2160, 372), (2160, 432), (2340, 432), (2340, 1420), (2265, 1440), (1500, 1500),
           (300, 1510), (160, 1510), (160, 640), (300, 640)], fill=255)
d.rectangle((160, 1240, 470, 1425), fill=0)  # роза ветров
alpha = alpha * (np.asarray(mask, float) / 255)
INK = np.array([62, 42, 24])

# --- перенос в метры: выходной пиксель (u,v) ↔ (E,N)
pts = np.array([[300, 318], [2340, 432], [2340, 1420], [300, 1510], [160, 1510], [160, 640]], float)
EN = (p[:, :2] @ pts.T).T + p[:, 2]
E0, E1 = EN[:, 0].min() - 20, EN[:, 0].max() + 20
N0, N1 = EN[:, 1].min() - 20, EN[:, 1].max() + 20
W, H = int((E1 - E0) / RES), int((N1 - N0) / RES)
Ainv = np.linalg.inv(p[:, :2])
a_ = Ainv @ np.array([RES, 0]); b_ = Ainv @ np.array([0, -RES]); c_ = Ainv @ (np.array([E0, N1]) - p[:, 2])
al = Image.fromarray((alpha * 255).astype(np.uint8)).transform((W, H), Image.AFFINE, (a_[0], b_[0], c_[0], a_[1], b_[1], c_[1]), Image.BICUBIC)
out = Image.new('RGBA', (W, H), tuple(INK) + (0,))
out.putalpha(al)
out.save('assets/overlays/plan-turgenevka.png', optimize=True)
# --- названия улиц на листе: подпись → точка на карте (для data/raw/oldplan-street-labels.json)
import json
STREETS = {  # пиксели повёрнутого скана, где на листе стоит подпись улицы
    'ул. Первомайская': (1135, 791), 'ул. Школьная': (1488, 1131), 'ул. Целинная': (1036, 1304), 'пер. Центральный': (879, 964),
    'пер. Спортивный': (1890, 950), 'ул. Зелёная': (1988, 965), 'ул. Набережная': (1029, 570), 'ул. Молодёжная': (471, 968),
    'ул. Строителей': (443, 614),
}
lab = []
for nm, (x, y) in STREETS.items():
    E, N = p @ np.array([x, y, 1])
    lab.append({'name': nm, 'lat': round(float(LAT0 + N / MLAT), 6), 'lon': round(float(LON0 + E / MLON), 6)})
json.dump({'note': 'Подписи улиц на старом плане Тургеневки (скан), перенесённые на карту по той же привязке; положение приблизительное.',
           'labels': lab}, open('data/raw/oldplan-street-labels.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
corner = lambda E, N: [round(float(LON0 + E / MLON), 6), round(float(LAT0 + N / MLAT), 6)]
print('размер', W, H, 'углы [tl, tr, br, bl]:', [corner(E0, N1), corner(E1, N1), corner(E1, N0), corner(E0, N0)])
