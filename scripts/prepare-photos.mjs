// Готовит фото для сайта из презентации-источника: применяет поворот и обрезку, заданные на слайде,
// уменьшает и сохраняет в assets/photos/<id>.jpg (полный размер) и assets/photos/thumb/<id>.jpg (превью).
// Запуск: node scripts/prepare-photos.mjs <папка_распакованного_pptx> [manifest.json]
//   (pptx — это zip: unzip deck.pptx -d deck)
// Манифест: data/photo-manifest.json — [{ id, slide, media }], откуда взято каждое фото.
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const deck = process.argv[2];
if (!deck) { console.error('Укажите папку распакованного pptx'); process.exit(1); }
const manifest = JSON.parse(readFileSync(new URL(process.argv[3] ?? '../data/photo-manifest.json', import.meta.url), 'utf8'));
const MAX = 1100;
mkdirSync(new URL('../assets/photos/thumb/', import.meta.url), { recursive: true });
const THUMB = 360;

function picInfo(slide, media) {
  const rels = readFileSync(`${deck}/ppt/slides/_rels/slide${slide}.xml.rels`, 'utf8');
  const rid = [...rels.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0])
    .find((r) => r.includes(`/media/${media}"`))?.match(/Id="([^"]+)"/)?.[1];
  if (!rid) throw new Error(`слайд ${slide}: нет ${media}`);
  const xml = readFileSync(`${deck}/ppt/slides/slide${slide}.xml`, 'utf8');
  const pic = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0]).find((p) => p.includes(`r:embed="${rid}"`));
  if (!pic) throw new Error(`слайд ${slide}: нет блока для ${media}`);
  const rot = +(pic.match(/<a:xfrm[^>]*\brot="(-?\d+)"/)?.[1] ?? 0) / 60000;
  const rect = pic.match(/<a:srcRect([^>]*)\/>/)?.[1] ?? '';
  const g = (k) => +(rect.match(new RegExp(`\\b${k}="(-?\\d+)"`))?.[1] ?? 0) / 100000;
  return { rot, crop: { l: g('l'), t: g('t'), r: g('r'), b: g('b') } };
}

for (const { id, slide, media } of manifest) {
  const src = `${deck}/ppt/media/${media}`;
  if (!existsSync(src)) { console.error(`нет файла ${src}`); process.exitCode = 1; continue; }
  const { rot, crop } = picInfo(slide, media);
  const meta = await sharp(src).rotate().metadata(); // .rotate() без аргумента — учёт EXIF
  const W = meta.width, H = meta.height;
  const left = Math.round(crop.l * W), top = Math.round(crop.t * H);
  const width = Math.max(1, Math.round(W * (1 - crop.l - crop.r))), height = Math.max(1, Math.round(H * (1 - crop.t - crop.b)));
  // Сначала обрезка (координаты заданы для неповёрнутого оригинала), затем поворот — отдельными шагами.
  const cropped = await sharp(src).rotate().extract({ left, top, width, height }).toBuffer();
  let img = sharp(cropped);
  if (rot) img = sharp(await img.rotate(rot, { background: '#ffffff' }).toBuffer());
  const full = await img.resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  await sharp(full).toFile(new URL(`../assets/photos/${id}.jpg`, import.meta.url).pathname);
  await sharp(full).resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true }).toFile(new URL(`../assets/photos/thumb/${id}.jpg`, import.meta.url).pathname);
  console.log(`${id}: слайд ${slide}, ${media}, поворот ${rot}°, обрезка ${JSON.stringify(crop)}`);
}
