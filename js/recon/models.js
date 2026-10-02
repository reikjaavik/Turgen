// Модели построек для реконструкции. Каждая модель — список частей { geometry, material },
// в метрах, начало координат — центр основания, фасад смотрит на +z. Рисуются через InstancedMesh.
import * as THREE from 'three';
import * as T from './textures.js';

const mat = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, ...o });
const color = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });

function box(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}
function cyl(rt, rb, h, x = 0, y = 0, z = 0, seg = 24, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y + h / 2, z);
}

// Двускатная крыша: конёк вдоль x. Группы: 0 — скаты, 1 — фронтоны.
function gable(w, d, rise, y0, uScale = 4) {
  const hw = w / 2, hd = d / 2;
  const p = [
    // скаты
    -hw, y0, hd, hw, y0, hd, hw, y0 + rise, 0, -hw, y0, hd, hw, y0 + rise, 0, -hw, y0 + rise, 0,
    hw, y0, -hd, -hw, y0, -hd, -hw, y0 + rise, 0, hw, y0, -hd, -hw, y0 + rise, 0, hw, y0 + rise, 0,
    // фронтоны
    hw, y0, hd, hw, y0, -hd, hw, y0 + rise, 0, -hw, y0, -hd, -hw, y0, hd, -hw, y0 + rise, 0,
  ];
  const s = Math.hypot(hd, rise) / uScale, u = w / uScale;
  const uv = [0, 0, u, 0, u, s, 0, 0, u, s, 0, s, 0, 0, u, 0, u, s, 0, 0, u, s, 0, s, 0, 0, 1, 0, 0.5, 0.5, 0, 0, 1, 0, 0.5, 0.5];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, 12, 0); g.addGroup(12, 6, 1);
  g.computeVertexNormals();
  return g;
}

// Стены-коробка: фасады с окнами на ±z, торцы и верх — фактурой стены.
function walls(w, h, d, wallTex, front, back = front, endRepeat = [1, 1]) {
  const t = wallTex.clone();
  t.repeat.set(...endRepeat);
  t.needsUpdate = true;
  const end = mat(t);
  return { geometry: box(w, h, d), material: [end, end, end, end, mat(front), mat(back)] };
}

const cache = new Map();
export function model(type) {
  if (!cache.has(type)) cache.set(type, build(type));
  return cache.get(type);
}

function build(type) {
  switch (type) {
    case 'yurt': {
      const band = T.ornament().clone(); band.wrapS = THREE.RepeatWrapping; band.repeat.set(6, 1); band.needsUpdate = true;
      return [
        { geometry: cyl(3.2, 3.2, 1.7, 0, 0, 0, 32), material: mat(T.felt()) },
        { geometry: cyl(3.23, 3.23, 0.35, 0, 1.0, 0, 32, true), material: mat(band, { side: THREE.DoubleSide }) },
        { geometry: cyl(0.55, 3.35, 1.45, 0, 1.7, 0, 32), material: mat(T.feltDark()) },
        { geometry: new THREE.TorusGeometry(0.55, 0.09, 8, 24).rotateX(Math.PI / 2).translate(0, 3.17, 0), material: mat(T.planks('#6b4a2c')) },
        { geometry: box(0.95, 1.5, 0.2, 0, 0, 3.15), material: color('#8a3b22') },
      ];
    }
    case 'zemlyanka': {
      const f = T.facade('zem', { wall: T.sod(), n: 1, frame: '#5a4631', doorColor: '#5a4631' });
      return [
        walls(6, 1.1, 4.5, T.sod(), f, T.facade('zem-b', { wall: T.sod(), n: 1, frame: '#5a4631' })),
        { geometry: gable(6.6, 5.4, 1.0, 1.1), material: [mat(T.earthRoof()), mat(T.sod())] },
      ];
    }
    case 'kystau': {
      const f = T.facade('kys', { wall: T.clay(), n: 1, frame: '#6b4a2c', doorColor: '#6b4a2c' });
      return [
        walls(7, 2.3, 5, T.clay(), f),
        { geometry: box(7.6, 0.45, 5.6, 0, 2.3), material: mat(T.earthRoof()) },
      ];
    }
    case 'saman': {
      const f = T.facade('saman', { wall: T.whitewash(), n: 3, frame: '#e9eef0', shutters: '#3d6f9a', doorColor: '#6b4a2c', glass: '#2f3d49' });
      const b = T.facade('saman-b', { wall: T.whitewash(), n: 2, frame: '#e9eef0', shutters: '#3d6f9a' });
      return [
        walls(7, 2.6, 5, T.whitewash(), f, b),
        { geometry: gable(7.9, 6.3, 2.0, 2.6), material: [mat(T.thatch()), mat(T.whitewash())] },
        { geometry: box(0.5, 1.1, 0.5, 1.8, 3.6, -0.6), material: mat(T.clay()) },
      ];
    }
    case 'saman60': {
      const f = T.facade('saman60', { wall: T.whitewash(), n: 3, frame: '#e9eef0', shutters: '#3f7a4c', doorColor: '#5a6a4a', glass: '#2f3d49' });
      const b = T.facade('saman60-b', { wall: T.whitewash(), n: 2, frame: '#e9eef0', shutters: '#3f7a4c' });
      return [
        walls(7, 2.6, 5, T.whitewash(), f, b),
        { geometry: gable(7.8, 6.1, 1.6, 2.6), material: [mat(T.slate()), mat(T.whitewash())] },
        { geometry: box(0.5, 1.1, 0.5, 1.8, 3.4, -0.6), material: mat(T.brick('#b0513a', '#8d7b6a')) },
      ];
    }
    case 'barn':
      return [
        walls(14, 4, 7, T.planks(), T.facade('barn', { wall: T.planks(), n: 1, doorColor: '#4e3a26', frame: '#4e3a26' })),
        { geometry: gable(14.8, 8.2, 2.4, 4), material: [mat(T.woodRoof()), mat(T.planks())] },
      ];
    case 'cowshed30':
    case 'cowshed60': {
      const f = T.facade('cow', { wall: T.whitewash(), n: 12, frame: '#bfb8a8' });
      return [
        walls(36, 3.2, 10, T.whitewash(), f, f, [2, 1]),
        { geometry: gable(37, 11.4, 2.6, 3.2, 3), material: [mat(type === 'cowshed30' ? T.thatch() : T.slate()), mat(T.whitewash())] },
      ];
    }
    case 'kontora30':
      return [
        walls(9, 3, 6, T.planks('#8a6a45'), T.facade('k30', { wall: T.planks('#8a6a45'), n: 3, frame: '#efe9dc', doorColor: '#5a4631' })),
        { geometry: gable(9.8, 7.2, 2.0, 3), material: [mat(T.woodRoof()), mat(T.planks('#8a6a45'))] },
      ];
    case 'tent':
      return [{ geometry: gable(5.5, 4.2, 2.5, 0, 2), material: [mat(T.canvasCloth(), { side: THREE.DoubleSide }), mat(T.canvasCloth(), { side: THREE.DoubleSide })] }];
    case 'wagon': {
      const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.25, 16).rotateX(Math.PI / 2);
      const parts = [
        walls(6, 2.3, 2.5, T.planks('#56704a'), T.facade('wag', { wall: T.planks('#56704a'), n: 2, frame: '#e8e8e0', doorColor: '#3f5236' })),
        { geometry: box(6.3, 0.2, 2.8, 0, 2.3), material: color('#3b3f3a') },
      ];
      parts[0].geometry.translate(0, 0.75, 0);
      parts[1].geometry.translate(0, 0.75, 0);
      for (const [x, z] of [[-2, 1.3], [2, 1.3], [-2, -1.3], [2, -1.3]]) parts.push({ geometry: wheel.clone().translate(x, 0.42, z), material: color('#2b2b2b') });
      return parts;
    }
    case 'shchit':
      return [
        walls(8, 2.8, 6, T.planks('#c7b27c'), T.facade('shchit', { wall: T.planks('#c7b27c'), n: 3, frame: '#f4f1e8', doorColor: '#7b5b3a' })),
        { geometry: gable(8.8, 7, 1.8, 2.8), material: [mat(T.slate()), mat(T.planks('#c7b27c'))] },
        { geometry: box(1.8, 0.35, 1.4, 0, 0, 3.7), material: mat(T.planks('#7b5b3a')) },
      ];
    case 'brick': {
      const f = T.facade('brick', { wall: T.brick(), n: 5, frame: '#f4f4f0', doorColor: '#7b3b2a' });
      return [
        walls(12, 3, 9, T.brick(), f),
        { geometry: gable(12.8, 10.2, 2.2, 3), material: [mat(T.slate()), mat(T.brick())] },
        { geometry: box(0.6, 1.2, 0.6, 3, 4.4, 0), material: mat(T.brick('#b0513a', '#8d7b6a')) },
      ];
    }
    case 'kontora': {
      const f = T.facade('kontora', { wall: T.plaster('#e2b7b1'), floors: 2, n: 7, doorColor: '#6d4a2e' });
      return [
        walls(22, 7, 12, T.plaster('#e2b7b1'), f, T.facade('kontora-b', { wall: T.plaster('#e2b7b1'), floors: 2, n: 7 })),
        { geometry: gable(23, 13, 2.2, 7), material: [mat(T.slate()), mat(T.plaster('#e2b7b1'))] },
      ];
    }
    case 'school': {
      const f = T.facade('school', { wall: T.plaster('#d9e3de'), floors: 2, n: 11, doorColor: '#6d4a2e' });
      return [
        walls(36, 7.2, 13, T.plaster('#d9e3de'), f, T.facade('school-b', { wall: T.plaster('#d9e3de'), floors: 2, n: 11 }), [2, 1]),
        { geometry: gable(37, 14, 2.3, 7.2, 3), material: [mat(T.slate()), mat(T.plaster('#d9e3de'))] },
      ];
    }
    case 'club': {
      const f = T.facade('club', { wall: T.plaster('#ece5d4'), n: 5, doorColor: '#6d4a2e', frame: '#ffffff' });
      const parts = [
        walls(24, 8, 16, T.plaster('#ece5d4'), f),
        { geometry: box(25, 0.8, 17, 0, 8), material: mat(T.plaster('#d5ccb8')) },
        { geometry: box(12, 1.4, 3.2, 0, 6.8, 9.4), material: mat(T.plaster('#f1ece0')) },
        { geometry: box(13, 0.4, 4, 0, 0, 9.4), material: mat(T.concrete()) },
      ];
      for (const x of [-4.5, -1.5, 1.5, 4.5]) parts.push({ geometry: cyl(0.4, 0.45, 6.8, x, 0.4, 10.4, 16), material: mat(T.plaster('#f6f2e8')) });
      return parts;
    }
    case 'workshop': {
      const f = T.facade('work', { wall: T.brick('#cfc8b8', '#a9a293'), n: 5, doorColor: '#56606a', frame: '#e0e0da' });
      return [
        walls(40, 7, 18, T.brick('#cfc8b8', '#a9a293'), f, f, [2, 1]),
        { geometry: gable(41, 19, 1.6, 7, 3), material: [mat(T.slate()), mat(T.brick('#cfc8b8', '#a9a293'))] },
      ];
    }
    case 'elevator': {
      const c = mat(T.concrete());
      return [
        ...[[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]].map(([x, z]) => ({ geometry: cyl(3, 3, 22, x, 0, z, 24), material: c })),
        { geometry: box(13, 1.2, 13, 0, 22), material: c },
        { geometry: box(7, 30, 7, -10, 0, 0), material: c },
        { geometry: gable(8, 8, 2, 30), material: [mat(T.slate()), c] },
      ];
    }
    case 'watertower':
      return [
        { geometry: cyl(0.8, 0.9, 14, 0, 0, 0, 16), material: mat(T.steel(), { metalness: 0.5, roughness: 0.6 }) },
        { geometry: cyl(2.3, 2.3, 4, 0, 14, 0, 24), material: mat(T.steel(), { metalness: 0.5, roughness: 0.6 }) },
        { geometry: new THREE.ConeGeometry(2.45, 1.4, 24).translate(0, 18.7, 0), material: color('#5b6064', { metalness: 0.4 }) },
      ];
    case 'memorial': {
      const g = mat(T.granite(), { roughness: 0.5 });
      const silver = color('#c3c7ca', { metalness: 0.7, roughness: 0.35 });
      return [
        { geometry: box(16, 0.25, 12), material: mat(T.concrete()) },
        { geometry: box(11, 2.6, 0.6, 0, 0.25, -3.5), material: g },
        { geometry: box(2.8, 1.8, 2.8, 0, 0.25, 0.5), material: g },
        { geometry: cyl(0.42, 0.55, 2.4, 0, 2.05, 0.5, 16), material: silver },
        { geometry: new THREE.SphereGeometry(0.3, 16, 12).translate(0, 4.75, 0.5), material: silver },
        { geometry: cyl(0.14, 0.14, 1.3, 0.55, 3.3, 0.5, 8), material: silver },
      ];
    }
    case 'modern-a': case 'modern-b': case 'modern-c': case 'modern-d': {
      const v = { 'modern-a': ['#ece6d8', '#3d6fa6'], 'modern-b': ['#e8d9b8', '#3f7a4c'], 'modern-c': ['#dcd6cc', '#a33a2e'], 'modern-d': ['#f0ebe0', '#6b4a36'] }[type];
      const wall = type === 'modern-c' ? T.brick('#c6a07c', '#9c8166') : T.plaster(v[0]);
      const f = T.facade(type, { wall, n: 2, frame: '#ffffff', doorColor: '#6b4a36' });
      return [
        walls(1, 3, 1, wall, f),
        { geometry: gable(1.12, 1.14, 1.5, 3, 0.25), material: [mat(T.metalRoof(v[1]), { metalness: 0.3, roughness: 0.55 }), mat(wall)] },
      ];
    }
    case 'modern-big':
      return [
        walls(1, 1, 1, T.brick('#d2cdc2', '#aaa497'), T.facade('mbig', { wall: T.brick('#d2cdc2', '#aaa497'), n: 4, frame: '#e8e8e2' })),
        { geometry: gable(1.04, 1.06, 0.12, 1, 0.1), material: [mat(T.slate()), mat(T.brick('#d2cdc2', '#aaa497'))] },
      ];
    // Объекты по экспликации генплана 2020: форма условная, место — по плану.
    case 'public': // кафе, интернат: по контуру здания, размеры задаёт раскладка
      return [
        walls(1, 3, 1, T.plaster('#ead9a8'), T.facade('pub', { wall: T.plaster('#ead9a8'), n: 4, frame: '#ffffff', doorColor: '#6b4a36' })),
        { geometry: gable(1.08, 1.1, 0.4, 3, 0.25), material: [mat(T.metalRoof('#7a3a2e'), { metalness: 0.3, roughness: 0.55 }), mat(T.plaster('#ead9a8'))] },
      ];
    case 'warehouse': // склады
      return [
        walls(1, 3, 1, T.brick('#c9c2b2', '#a39c8d'), T.facade('wh', { wall: T.brick('#c9c2b2', '#a39c8d'), n: 3, frame: '#d8d8d2', doorColor: '#56606a' })),
        { geometry: gable(1.04, 1.06, 0.2, 3, 0.2), material: [mat(T.metalRoof('#7d858c'), { metalness: 0.4, roughness: 0.5 }), mat(T.brick('#c9c2b2', '#a39c8d'))] },
      ];
    case 'azs': {
      const red = color('#c4372b'), white = color('#f1f1ec');
      const parts = [
        { geometry: box(24, 0.15, 18), material: mat(T.concrete()) },
        { geometry: box(14, 0.6, 8, 0, 4.9, 2), material: white },
        { geometry: box(14.2, 0.25, 8.2, 0, 4.7, 2), material: red },
        { geometry: box(6, 3, 4, 0, 0.15, -6), material: mat(T.plaster('#e8e4d6')) },
        { geometry: box(6.6, 0.3, 4.6, 0, 3.15, -6), material: red },
      ];
      for (const x of [-5, 5]) for (const z of [-0.5, 4.5]) parts.push({ geometry: cyl(0.22, 0.22, 4.7, x, 0.15, z, 10), material: white });
      for (const x of [-2.5, 2.5]) parts.push({ geometry: box(0.7, 1.5, 0.5, x, 0.15, 2), material: red });
      return parts;
    }
    case 'tanks': {
      const steel = mat(T.steel(), { metalness: 0.5, roughness: 0.6 });
      const parts = [{ geometry: box(40, 0.15, 26), material: mat(T.concrete()) }];
      for (const x of [-12, -4, 4, 12]) for (const z of [-6, 6]) {
        parts.push({ geometry: cyl(3.3, 3.3, 8, x, 0.15, z, 24), material: steel });
        parts.push({ geometry: new THREE.ConeGeometry(3.4, 1, 24).translate(x, 8.65, z), material: color('#5b6064', { metalness: 0.4 }) });
      }
      return parts;
    }
    case 'pitch': {
      const line = color('#f4f4ee'), post = color('#e8e8e4');
      const parts = [
        { geometry: box(60, 0.1, 40), material: color('#6e9a4a') },
        { geometry: box(60, 0.12, 0.25, 0, 0, 19.8), material: line }, { geometry: box(60, 0.12, 0.25, 0, 0, -19.8), material: line },
        { geometry: box(0.25, 0.12, 40, 29.8), material: line }, { geometry: box(0.25, 0.12, 40, -29.8), material: line },
        { geometry: box(0.25, 0.12, 40), material: line },
      ];
      for (const s of [-1, 1]) {
        for (const z of [-3.6, 3.6]) parts.push({ geometry: cyl(0.08, 0.08, 2.4, s * 30, 0, z, 8), material: post });
        parts.push({ geometry: box(0.1, 0.1, 7.4, s * 30, 2.4), material: post });
      }
      return parts;
    }
    case 'scales': {
      const c = mat(T.concrete());
      return [
        { geometry: box(3.4, 0.35, 18), material: c },
        { geometry: box(3.4, 0.1, 18, 0, 0.35), material: color('#6a6f73', { metalness: 0.4 }) },
        { geometry: box(3, 2.6, 3, 4.2, 0, 0), material: mat(T.plaster('#dcd6c4')) },
        { geometry: box(3.5, 0.25, 3.5, 4.2, 2.6), material: color('#6a6f73') },
      ];
    }
    case 'haystacks': {
      const hay = color('#c8a548', { roughness: 1 });
      const parts = [];
      for (const [x, z] of [[-7, 0], [0, 3], [7, -1]]) {
        parts.push({ geometry: cyl(3.4, 3.4, 3, x, 0, z, 16), material: hay });
        parts.push({ geometry: new THREE.ConeGeometry(3.4, 3.2, 16).translate(x, 4.6, z), material: hay });
      }
      return parts;
    }
    case 'substation': {
      const steel = mat(T.steel(), { metalness: 0.5, roughness: 0.6 }), fence = color('#8f969b', { transparent: true, opacity: 0.55 });
      const parts = [{ geometry: box(24, 0.15, 18), material: mat(T.concrete()) }];
      for (const x of [-7, 0, 7]) parts.push({ geometry: box(3.2, 3.5, 3, x, 0.15, -3), material: color('#8b9298', { metalness: 0.3 }) });
      for (const x of [-9, 9]) parts.push({ geometry: box(0.45, 10, 0.45, x, 0.15, 5), material: steel });
      parts.push({ geometry: box(18.5, 0.3, 0.3, 0, 9.5, 5), material: steel });
      parts.push({ geometry: box(24, 1.8, 0.05, 0, 0, 9), material: fence }, { geometry: box(24, 1.8, 0.05, 0, 0, -9), material: fence });
      parts.push({ geometry: box(0.05, 1.8, 18, 12), material: fence }, { geometry: box(0.05, 1.8, 18, -12), material: fence });
      return parts;
    }
    case 'cemetery': {
      const fence = color('#6a5a48', { transparent: true, opacity: 0.8 }), earth = color('#7b6a52', { roughness: 1 });
      const parts = [
        { geometry: box(50, 0.9, 0.12, 0, 0, 20), material: fence }, { geometry: box(50, 0.9, 0.12, 0, 0, -20), material: fence },
        { geometry: box(0.12, 0.9, 40, 25), material: fence }, { geometry: box(0.12, 0.9, 40, -25), material: fence },
      ];
      for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) parts.push({ geometry: box(1.1, 0.4, 2.6, -18 + i * 6, 0, -14 + j * 7), material: earth });
      return parts;
    }
    case 'kiln': {
      const br = T.brick('#b0513a', '#8d7b6a');
      return [
        walls(30, 6, 14, br, T.facade('kiln', { wall: br, n: 4, frame: '#d8d0c0', doorColor: '#4e3a26' })),
        { geometry: gable(31, 15, 2.2, 6, 3), material: [mat(T.slate()), mat(br)] },
        { geometry: cyl(1.1, 1.7, 32, -16, 0, 0, 20), material: mat(br) },
      ];
    }
    case 'tree':
      return [
        { geometry: cyl(0.14, 0.2, 3.2, 0, 0, 0, 8), material: mat(T.bark()) },
        { geometry: new THREE.IcosahedronGeometry(2.2, 1).scale(1, 1.5, 1).translate(0, 5.6, 0), material: mat(T.foliage(), { flatShading: true }) },
      ];
    case 'poplar':
      return [
        { geometry: cyl(0.16, 0.24, 3, 0, 0, 0, 8), material: mat(T.bark()) },
        { geometry: new THREE.IcosahedronGeometry(1.6, 1).scale(1, 3.4, 1).translate(0, 7.5, 0), material: mat(T.foliage(), { flatShading: true }) },
      ];
    case 'fence':
      return [{ geometry: box(1, 0.9, 0.05), material: mat(T.planks('#a58c68'), { transparent: true, opacity: 0.85 }) }];
    default:
      throw new Error(`нет модели ${type}`);
  }
}
