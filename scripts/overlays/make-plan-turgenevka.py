#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Старый план с. Тургеневка (фото печатного листа) → прозрачный слой для карты и фото для архива.

Запуск: python scripts/overlays/make-plan-turgenevka.py "<фото листа>.jpeg"
Результат: assets/overlays/plan-turgenevka.png (чернила листа на прозрачном фоне, север вверху, 0,8 м/пиксель),
           assets/photos/plan-turgenevka.jpg (+ thumb) — фото листа, повёрнутое так, чтобы текст читался;
           печатает углы изображения (lon/lat) для data/overlays.json.

Привязка. На листе север справа (роза ветров), поэтому фото поворачивается на 90°. Аффинное преобразование листа
в метры (восток, север от 50.7625°с.ш., 72.32°в.д.) подогнано по пяти объектам, которые на плане и на современном
генплане 2020 года стоят на тех же местах: школа, стадион, Дом культуры, детский сад, торговый центр.
Невязка 2–10 м; положение центральной конторы совхоза, в подгонку не входившее, сошлось в 17 м с современной конторой.
Координаты точек на листе — в пикселях повёрнутого фото (1600×1200); читаются по надписям листа.
"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

SRC = sys.argv[1]
LAT0, LON0 = 50.7625, 72.32
MLAT = 111320.0
MLON = MLAT * math.cos(math.radians(LAT0))
RES = 0.8  # м/пиксель выходного слоя

# (пиксели повёрнутого фото) → (восток, север) в метрах: контрольные объекты
CTRL = {
    'школа': ((1105, 652), (313, 128)),
    'стадион': ((1215, 665), (359, 234)),
    'дом культуры': ((1050, 505), (158, 105)),
    'детский сад': ((997.5, 645), (305, 18)),
    'торговый центр': ((897.5, 580), (206, -72)),
}
CHECK = {'центральная контора': ((845, 590), (196, -136))}  # не входит в подгонку

A, b = [], []
for (x, y), (E, N) in CTRL.values():
    A += [[x, y, 1, 0, 0, 0], [0, 0, 0, x, y, 1]]
    b += [E, N]
p = np.linalg.lstsq(np.array(A, float), np.array(b, float), rcond=None)[0].reshape(2, 3)
for n, ((x, y), (E, N)) in CTRL.items():
    e = p @ np.array([x, y, 1])
    print(f'{n}: невязка {np.hypot(*(e - [E, N])):.1f} м')
for n, ((x, y), (E, N)) in CHECK.items():
    e = p @ np.array([x, y, 1])
    print(f'{n} (проверка): {np.hypot(*(e - [E, N])):.1f} м')

# --- фото: повернуть так, чтобы текст читался (заголовок идёт сверху вниз по правому краю → 90° против часовой)
src = Image.open(SRC)
src = ImageOps.exif_transpose(src).convert('RGB').rotate(90, expand=True)  # 1600×1200
assert src.size == (1600, 1200), src.size

# --- архивное фото: лист без деревянного фона
arch = src.crop((110, 0, 1580, 1030))
arch.thumbnail((1100, 1100), Image.LANCZOS)
arch.save('assets/photos/plan-turgenevka.jpg', quality=80, optimize=True)
th = arch.copy(); th.thumbnail((360, 360), Image.LANCZOS)
th.save('assets/photos/thumb/plan-turgenevka.jpg', quality=72, optimize=True)

# --- чернила: выравниваем освещение (фон бумаги — максимум в окне, сглаженный), тёмное → непрозрачное
g = np.asarray(src.convert('L'), float)
bgm = Image.fromarray(g.astype(np.uint8)).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(18))
bg = np.maximum(np.asarray(bgm, float), 1)
ink = np.clip(1 - g / bg, 0, 1)
alpha = np.clip((ink - 0.17) / 0.38, 0, 1)
# убрать мелкие крапинки (дефекты бумаги): оставляем связные куски чернил от 14 пикселей
from scipy import ndimage
lab, n = ndimage.label(alpha > 0.35, structure=np.ones((3, 3)))
sizes = ndimage.sum(np.ones_like(alpha), lab, range(1, n + 1))
keep = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz >= 14])
keep = ndimage.binary_dilation(keep, iterations=3)  # вернуть тонкие края оставленных штрихов
alpha = alpha * keep

# маска: центральная часть плана (x ≥ 690 на повёрнутом фото; левее — Молодёжная, ул. Строителей — перспектива фото сильно растягивает
# схему и привязка там ненадёжна) без заголовка, легенды и фона (координаты — пиксели повёрнутого фото)
mask = Image.new('L', src.size, 0)
d = ImageDraw.Draw(mask)
d.polygon([(690, 276), (740, 276), (1125, 276), (1125, 372), (1405, 372), (1405, 396), (1535, 396), (1535, 762),
           (1500, 884), (1440, 896), (1000, 948), (690, 948)], fill=255)
d.rectangle((235, 770, 470, 970), fill=0)  # роза ветров
alpha = alpha * (np.asarray(mask, float) / 255)
INK = np.array([62, 42, 24])

# --- перенос в метры: выходной пиксель (u,v) ↔ (E,N); исходные координаты — обратным преобразованием
pts = np.array([[690, 276], [1535, 396], [1535, 884], [690, 948], [1000, 948]], float)
EN = (p[:, :2] @ pts.T).T + p[:, 2]
E0, E1 = EN[:, 0].min() - 20, EN[:, 0].max() + 20
N0, N1 = EN[:, 1].min() - 20, EN[:, 1].max() + 20
W, H = int((E1 - E0) / RES), int((N1 - N0) / RES)
Ainv = np.linalg.inv(p[:, :2])
# x = Ainv @ ([E,N] - t),  E = E0 + RES*u,  N = N1 - RES*v
a_ = Ainv @ np.array([RES, 0])
b_ = Ainv @ np.array([0, -RES])
c_ = Ainv @ (np.array([E0, N1]) - p[:, 2])
coeffs = (a_[0], b_[0], c_[0], a_[1], b_[1], c_[1])
al = Image.fromarray((alpha * 255).astype(np.uint8)).transform((W, H), Image.AFFINE, coeffs, Image.BICUBIC)
out = Image.new('RGBA', (W, H), tuple(INK) + (0,))
out.putalpha(al)
out.save('assets/overlays/plan-turgenevka.png', optimize=True)
corners = lambda E, N: [round(LON0 + E / MLON, 6), round(LAT0 + N / MLAT, 6)]
print('размер', W, H, 'углы [tl, tr, br, bl]:', [corners(E0, N1), corners(E1, N1), corners(E1, N0), corners(E0, N0)])
