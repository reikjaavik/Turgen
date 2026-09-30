// «Вид села» — 3D-реконструкция облика аула по периодам (three.js).
// Интерфейс как у схем (map.js, map3d.js): initStage, setFocus, setDrafts, setMapClick, zoomBy, resetZoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { model } from './models.js';
import { prepare, layout, toXZ, toLL } from './layout.js';
import * as T from './textures.js';

let renderer, scene, camera, controls, sun, container, labelsEl;
let prep, eras = [], opts = {};
let decade = null, groups = new Map(); // тип → [InstancedMesh]
let current = [];                     // экземпляры текущего периода
let anim = null, fly = null;
let focus = { places: [], isVisible: () => true, highlight: new Set(), pulse: null };
let drafts = {};
const labels = new Map();
const HOME = { offset: new THREE.Vector3(70, 38, 105) };

export const supported = () => {
  const c = document.createElement('canvas');
  return !!(c.getContext('webgl2') || c.getContext('webgl'));
};

export async function initStage(el, options) {
  container = el;
  opts = { onSelect: () => {}, label: (o) => o.id, onMapClick: null, ...options };
  const [base, er] = await Promise.all([
    (await fetch('assets/map/base.geojson')).json(),
    (await fetch('data/eras.json')).json(),
  ]);
  eras = er.eras;
  prep = prepare(base, opts.places ?? []);

  const phone = matchMedia('(max-width: 800px)').matches;
  renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
  renderer.shadowMap.enabled = !phone;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.append(renderer.domElement);
  labelsEl = document.createElement('div');
  labelsEl.className = 'recon-labels';
  el.append(labelsEl);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd3e2');
  scene.fog = new THREE.Fog('#c9d8e0', 600, 2600);
  camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  scene.add(new THREE.HemisphereLight('#dfeaf2', '#8a7a55', 0.9));
  sun = new THREE.DirectionalLight('#fff3dc', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 10, far: 900 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  buildGround();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.48;
  controls.minDistance = 12;
  controls.maxDistance = 2600;
  controls.target.set(prep.core.x, 0, prep.core.z);
  camera.position.copy(controls.target).add(HOME.offset);
  controls.update();

  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  renderer.domElement.addEventListener('click', onClick);
  renderer.setAnimationLoop(tick);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------- местность ----------
let roadMeshes = [];
function buildGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: T.steppe(), roughness: 1 }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  for (const line of prep.river) scene.add(ribbon(line, 18, new THREE.MeshStandardMaterial({ map: T.water(), roughness: 0.25, metalness: 0.1 }), 0.05));
  const W = { major: 10, mid: 7, street: 6, minor: 4 };
  roadMeshes = prep.roads.map((r) => {
    const m = ribbon(r.pts, W[r.road] ?? 5, new THREE.MeshStandardMaterial({ map: T.dirt(), roughness: 1 }), 0.08 + (r.road === 'major' ? 0.02 : 0));
    m.userData.road = r.road;
    scene.add(m);
    return m;
  });
}

// Лента вдоль ломаной (река, дорога) с UV вдоль длины.
function ribbon(pts, width, material, y) {
  const pos = [], uv = [], idx = [];
  let acc = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    if (i) acc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2, p.x - nx * width / 2, y, p.z - nz * width / 2);
    uv.push(0, acc / 25, 1, acc / 25);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  material.polygonOffset = true; material.polygonOffsetFactor = -1;
  if (material.map) { material.map = material.map.clone(); material.map.repeat.set(1, 1); material.map.needsUpdate = true; }
  return m;
}

function setRoads(kind) {
  for (const m of roadMeshes) {
    const k = m.userData.road === 'major' ? kind : kind === 'asphalt' ? 'gravel' : kind;
    const map = { dirt: T.dirt, gravel: T.gravel, asphalt: T.asphalt }[k]().clone();
    map.repeat.set(1, 1); map.needsUpdate = true;
    m.material.map = map; m.material.needsUpdate = true;
  }
}

// ---------- постройки ----------
function setPeriod(d) {
  if (d === decade) return;
  const prev = new Set(current.map((c) => c.key));
  decade = d;
  const era = eras.find((e) => e.decade === d);
  setRoads(era?.scene.road ?? 'dirt');
  current = layout(prep, eras, d);
  for (const list of groups.values()) list.forEach((m) => { scene.remove(m); m.dispose(); });
  groups.clear();
  const byType = new Map();
  for (const it of current) { if (!byType.has(it.type)) byType.set(it.type, []); byType.get(it.type).push(it); }
  for (const [type, items] of byType) {
    const meshes = model(type).map(({ geometry, material }) => {
      const m = new THREE.InstancedMesh(geometry, material, items.length);
      m.castShadow = type !== 'fence';
      m.receiveShadow = true;
      m.userData.items = items;
      scene.add(m);
      return m;
    });
    groups.set(type, meshes);
  }
  // Новые постройки «вырастают», прежние стоят на месте.
  for (const it of current) it.grow = prev.size && !prev.has(it.key) ? 0 : 1;
  anim = { t0: performance.now(), dur: 900 };
  writeMatrices(1);
  updateLabels(true);
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
function writeMatrices(k) {
  for (const meshes of groups.values()) {
    const items = meshes[0].userData.items;
    items.forEach((it, i) => {
      const g = it.grow === 0 ? k : 1;
      q.setFromAxisAngle(up, it.rot);
      m4.compose(v.set(it.x, 0, it.z), q, s.set(it.sx, it.sy * Math.max(g, 0.001), it.sz));
      for (const m of meshes) m.setMatrixAt(i, m4);
    });
    for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }
}

// ---------- подписи мест ----------
function updateLabels(rebuild) {
  if (rebuild) {
    for (const o of focus.places) {
      if (o.lat == null) continue;
      if (!labels.has(o.id)) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'recon-label';
        el.addEventListener('click', (e) => { e.stopPropagation(); if (!opts.onMapClick) opts.onSelect(o); });
        labelsEl.append(el);
        labels.set(o.id, { el, o, p: new THREE.Vector3(toXZ(o.lat, o.lon).x, 0, toXZ(o.lat, o.lon).z) });
      }
      const L = labels.get(o.id);
      L.el.textContent = (o.approx ? '≈ ' : '') + opts.label(o);
      L.el.classList.toggle('hl', focus.highlight.has(o.id));
      L.el.classList.toggle('pulse', focus.pulse === o.id);
      L.show = focus.isVisible(o) && !drafts[o.id];
      L.p.y = o.type === 'elevator' ? 34 : o.type === 'memorial' ? 7 : 11;
    }
    for (const [id, d] of Object.entries(drafts)) {
      const key = `draft:${id}`;
      if (!labels.has(key)) {
        const el = document.createElement('div');
        el.className = 'recon-label draft';
        labelsEl.append(el);
        labels.set(key, { el, p: new THREE.Vector3() });
      }
      const L = labels.get(key);
      const { x, z } = toXZ(d.lat, d.lon);
      L.p.set(x, 3, z); L.show = true;
      L.el.textContent = `📍 ${opts.label({ id, ...(opts.placeById?.(id) ?? {}) })}`;
    }
    for (const [k, L] of labels) if (k.startsWith('draft:') && !drafts[k.slice(6)]) { L.el.remove(); labels.delete(k); }
  }
  const w = container.clientWidth, h = container.clientHeight;
  const dist = camera.position.distanceTo(controls.target);
  for (const L of labels.values()) {
    v.copy(L.p).project(camera);
    const on = L.show && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    // Издалека подписываем только выбранные места и центр аула, вблизи — все.
    const important = L.el.classList.contains('hl') || L.el.classList.contains('draft') || L.o?.type === 'village' || dist < 400;
    L.el.style.display = on && important ? '' : 'none';
    if (on) L.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
  }
}

// ---------- кадр ----------
function tick(now) {
  if (anim) {
    const k = Math.min(1, (now - anim.t0) / anim.dur);
    writeMatrices(1 - Math.pow(1 - k, 3));
    if (k >= 1) anim = null;
  }
  if (fly) {
    const k = Math.min(1, (now - fly.t0) / fly.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    camera.position.lerpVectors(fly.fromP, fly.toP, e);
    if (k >= 1) fly = null;
  }
  controls.update();
  // Солнце и тени следуют за точкой, на которую смотрим.
  sun.position.copy(controls.target).add(new THREE.Vector3(-220, 320, 160));
  sun.target.position.copy(controls.target);
  renderer.render(scene, camera);
  updateLabels(false);
}

function flyTo(x, z, dist = 150) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const toT = new THREE.Vector3(x, 0, z);
  fly = { t0: performance.now(), dur: 1100, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(dir.multiplyScalar(dist)).setY(Math.max(30, dist * 0.45)) };
}

// ---------- интерфейс сцены ----------
export function setFocus({ places, isVisible, highlight = [], pulse = null, decade: d }) {
  focus = { places, isVisible, highlight: new Set(highlight), pulse };
  if (d != null) setPeriod(d);
  updateLabels(true);
  const target = pulse ?? highlight[0];
  const o = target && places.find((p) => p.id === target && p.lat != null);
  if (o && isVisible(o)) { const { x, z } = toXZ(o.lat, o.lon); flyTo(x, z, o.type === 'village' ? 220 : 110); }
}

export function setDrafts(d) { drafts = d; updateLabels(true); }
export function setMapClick(fn) { opts.onMapClick = fn; renderer.domElement.classList.toggle('marking', !!fn); }

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function onClick(e) {
  if (!opts.onMapClick) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (hit) opts.onMapClick(toLL(hit.x, hit.z));
}

export function zoomBy(f) {
  const off = camera.position.clone().sub(controls.target).multiplyScalar(1 / f);
  const len = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
  fly = { t0: performance.now(), dur: 500, fromT: controls.target.clone(), toT: controls.target.clone(), fromP: camera.position.clone(), toP: controls.target.clone().add(off.setLength(len)) };
}
export function resetZoom() {
  const toT = new THREE.Vector3(prep.core.x, 0, prep.core.z);
  fly = { t0: performance.now(), dur: 900, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(HOME.offset) };
}
export function overview() {
  const toT = new THREE.Vector3(prep.core.x, 0, prep.core.z + 60);
  fly = { t0: performance.now(), dur: 1200, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(new THREE.Vector3(250, 520, 720)) };
}
export const eraOf = (d) => eras.find((e) => e.decade === d);
