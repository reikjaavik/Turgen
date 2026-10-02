// Читает DWG генерального плана и сохраняет его содержимое в JSON (слои, полилинии, штриховки, надписи).
// Это разовый инструмент: сам DWG и дамп (≈50 МБ) в репозиторий не входят.
//   Нужен LibreDWG (WASM), он под GPL и в зависимости сайта не добавляется:
//     mkdir %TEMP%\dwg && cd %TEMP%\dwg && npm init -y && npm i @mlightcad/libredwg-web
//     node <путь к репозиторию>/scripts/genplan/dump-dwg.mjs "<файл>.dwg" gp3.json
// Дальше: python scripts/genplan/extract.py gp3.json
import { readFileSync, writeFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const [, , src, out] = process.argv;
if (!src || !out) { console.error('Использование: node dump-dwg.mjs файл.dwg выход.json'); process.exit(1); }
const lib = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const buf = readFileSync(src);
const dwg = lib.dwg_read_data(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), Dwg_File_Type.DWG);
const db = lib.convert(dwg);
writeFileSync(out, JSON.stringify(db, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
console.log(`объектов: ${db.entities.length}`);
