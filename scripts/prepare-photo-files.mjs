// Готовит фото для сайта из отдельных файлов (не из презентации): node scripts/prepare-photo-files.mjs <id>=<путь> ...
// Параметры те же, что в prepare-photos.mjs: полный размер до 1000 px (q74), превью 360 px (q70).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const MAX = +(process.env.PHOTO_MAX ?? 1000), THUMB = 360;
for (const arg of process.argv.slice(2)) {
  const [id, src] = arg.split(/=(.+)/);
  const full = await sharp(src).rotate().resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 74, mozjpeg: true }).toBuffer();
  await sharp(full).toFile(fileURLToPath(new URL(`../assets/photos/${id}.jpg`, import.meta.url)));
  await sharp(full).resize({ width: THUMB, height: THUMB, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true }).toFile(fileURLToPath(new URL(`../assets/photos/thumb/${id}.jpg`, import.meta.url)));
  console.log(`${id}: ${src}`);
}
