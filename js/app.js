import { loadDicts, t, pick, setLang, getLang } from './i18n.js';
import { loadBase, renderObjects, isVisible, unproject } from './map.js';

const $ = (sel) => document.querySelector(sel);
const state = { decade: 1900, decades: [], about: [], objects: [], sources: new Map(), baseLoaded: false };

const el = {
  timeline: $('#timeline'),
  title: $('#decade-title'),
  body: $('#panel-body'),
  notice: $('#lang-notice'),
  mapBase: $('#map-base'),
  mapObjects: $('#map-objects'),
  mapStatus: $('#map-status'),
  lightbox: $('#lightbox'),
};

async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Источники: [{ id, ref }] → «[презентация проекта, слайд 9]»
function sourcesHtml(list = []) {
  const parts = list.map(({ id, ref }) => {
    const s = state.sources.get(id);
    const name = s?.short ?? id;
    return esc(ref ? `${name}, ${ref}` : name);
  });
  return parts.length ? `<span class="src">[${parts.join('; ')}]</span>` : '';
}

function textHtml(field) {
  const { text, fallback } = pick(field);
  return esc(text) + (fallback ? ` <span class="fallback-mark">(${esc(t('i18n.missing'))})</span>` : '');
}

function photosHtml(photos = []) {
  if (!photos.length) return '';
  return `<div class="photos">${photos.map((p) => {
    const cap = pick(p.caption).text;
    return `<figure><button type="button" class="thumb" data-photo="${esc(p.id)}" aria-label="${esc(cap)}"><img loading="lazy" src="assets/photos/${esc(p.id)}.jpg" alt="${esc(cap)}"></button></figure>`;
  }).join('')}</div>`;
}

function section(titleKey, items, renderItem, cls = '') {
  const inner = items.length
    ? `<ul class="${cls}">${items.map((i) => `<li>${renderItem(i)}</li>`).join('')}</ul>`
    : `<p class="empty">${esc(t('panel.empty'))}</p>`;
  return `<section class="section"><h3>${esc(t(titleKey))}</h3>${inner}</section>`;
}

// Событие показывается в десятилетии, если его год или период [from, to] попадает в [decade, decade+9].
function inDecade(e, decade) {
  const from = e.from ?? e.year;
  const to = e.to ?? e.year;
  return from == null || (from <= decade + 9 && to >= decade);
}

const itemText = (e) =>
  `${e.year ? `<strong>${e.year}:</strong> ` : ''}${textHtml(e.text)} ${sourcesHtml(e.sources)}${photosHtml(e.photos)}`;

const personHtml = (p) =>
  `<strong>${textHtml(p.name)}</strong>${p.life ? ` <span class="life">${esc(p.life)}</span>` : ''}` +
  (p.text ? `<br>${textHtml(p.text)}` : '') + ` ${sourcesHtml(p.sources)}${photosHtml(p.photos)}`;

function renderPanel() {
  const d = state.decades.find((x) => x.decade === state.decade);
  el.title.textContent = `${state.decade}${t('decade.suffix')}`;
  const objs = state.objects.filter((o) => isVisible(o, state.decade));
  const about = state.about.length
    ? `<details class="about"><summary>${esc(t('panel.about'))}</summary><ul>${state.about.map((a) => `<li>${itemText(a)}</li>`).join('')}</ul></details>`
    : '';
  el.body.innerHTML = [
    section('panel.population', (d?.population ?? []), itemText),
    section('panel.events', (d?.events ?? []).filter((e) => inDecade(e, state.decade)), itemText),
    section('panel.objects', objs, (o) => `<strong>${textHtml(o.name)}</strong> ${o.text ? textHtml(o.text) : ''} ${sourcesHtml(o.sources)}${photosHtml(o.photos)}`),
    section('panel.people', d?.people ?? [], personHtml, 'people'),
    about,
  ].join('');
}

function renderMap() {
  const drawn = renderObjects(el.mapObjects, state.objects, state.decade, () => {});
  if (!editMode) el.mapStatus.textContent = state.baseLoaded && drawn === 0 ? t('map.no_objects') : '';
}

function renderTimeline() {
  el.timeline.innerHTML = state.decades.map((d) =>
    `<li><button type="button" data-decade="${d.decade}"${d.decade === state.decade ? ' aria-current="true"' : ''}>${d.decade}${esc(t('decade.suffix'))}</button></li>`
  ).join('');
}

function renderStatic() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('.lang button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  document.title = `${t('site.title')} — ${t('site.tagline')}`;
  el.notice.hidden = getLang() !== 'kz';
  el.notice.textContent = getLang() === 'kz' ? t('i18n.notice') : '';
}

function render() {
  renderStatic();
  renderTimeline();
  renderPanel();
  renderMap();
}

function selectDecade(decade, { push = true } = {}) {
  if (!state.decades.some((d) => d.decade === decade)) return;
  state.decade = decade;
  if (push) history.replaceState(null, '', `#${decade}`);
  render();
}

function decadeFromHash() {
  const n = parseInt(location.hash.slice(1), 10);
  return state.decades.some((d) => d.decade === n) ? n : state.decades[0].decade;
}

function step(delta) {
  const i = state.decades.findIndex((d) => d.decade === state.decade) + delta;
  if (i >= 0 && i < state.decades.length) selectDecade(state.decades[i].decade);
}

// Фото → увеличенный просмотр с подписью и источником.
function findPhoto(id) {
  const scan = (list) => list.flatMap((x) => x.photos ?? []).find((p) => p.id === id);
  return scan(state.about) ?? scan(state.objects)
    ?? state.decades.map((d) => scan([...d.events, ...d.people])).find(Boolean);
}
function openPhoto(id) {
  const p = findPhoto(id);
  if (!p || !el.lightbox) return;
  el.lightbox.querySelector('img').src = `assets/photos/${id}.jpg`;
  el.lightbox.querySelector('img').alt = pick(p.caption).text;
  el.lightbox.querySelector('figcaption').innerHTML = `${textHtml(p.caption)} ${sourcesHtml(p.sources)}`;
  el.lightbox.showModal();
}

// Режим разметки (?edit): клик по карте показывает lat/lon для добавления объекта в data/objects.json.
const editMode = new URLSearchParams(location.search).has('edit');
function setupEditMode() {
  if (!editMode) return;
  const svg = $('#map');
  svg.style.cursor = 'crosshair';
  svg.addEventListener('click', (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const { x, y } = pt.matrixTransform(svg.getScreenCTM().inverse());
    const ll = unproject(x, y);
    if (!ll) return;
    const txt = `"lat": ${ll.lat.toFixed(6)}, "lon": ${ll.lon.toFixed(6)}`;
    el.mapStatus.innerHTML = `${esc(t('map.pick'))} <code>${txt}</code> <button type="button" id="copy-ll">${esc(t('map.copy'))}</button>`;
    $('#copy-ll').onclick = () => navigator.clipboard?.writeText(txt);
  });
}

async function init() {
  await loadDicts();
  const [dec, obj, src] = await Promise.all([
    json('data/decades.json'), json('data/objects.json'), json('data/sources.json'),
  ]);
  state.decades = dec.decades;
  state.about = dec.about ?? [];
  state.objects = obj.objects;
  state.sources = new Map(src.sources.map((s) => [s.id, s]));
  state.decade = decadeFromHash();

  state.baseLoaded = await loadBase(el.mapBase, t);
  render();
  setupEditMode();

  el.timeline.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-decade]');
    if (b) selectDecade(+b.dataset.decade);
  });
  el.body.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-photo]');
    if (b) openPhoto(b.dataset.photo);
  });
  el.lightbox?.addEventListener('click', (e) => { if (e.target === el.lightbox || e.target.closest('.close')) el.lightbox.close(); });
  document.querySelector('.lang').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) { setLang(b.dataset.lang); render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (el.lightbox?.open) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  window.addEventListener('hashchange', () => selectDecade(decadeFromHash(), { push: false }));

  let x0 = null;
  const mapWrap = document.querySelector('.map-wrap');
  mapWrap.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  mapWrap.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
}

init().catch((err) => {
  console.error(err);
  el.body.innerHTML = `<p class="empty">Не удалось загрузить данные. Откройте сайт через веб-сервер (не file://).</p>`;
});
