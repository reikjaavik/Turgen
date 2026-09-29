import { loadDicts, t, pick, setLang, getLang } from './i18n.js';
import { loadBase, renderObjects, isVisible } from './map.js';

const $ = (sel) => document.querySelector(sel);
const state = { decade: 1900, decades: [], objects: [], sources: new Map(), baseLoaded: false };

const el = {
  timeline: $('#timeline'),
  title: $('#decade-title'),
  body: $('#panel-body'),
  notice: $('#lang-notice'),
  mapBase: $('#map-base'),
  mapObjects: $('#map-objects'),
  mapStatus: $('#map-status'),
};

async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function sourcesHtml(ids = []) {
  const names = ids.map((id) => state.sources.get(id)?.title ?? id);
  return names.length ? `<span class="src">[${esc(names.join('; '))}]</span>` : '';
}

function textHtml(field) {
  const { text, fallback } = pick(field);
  return esc(text) + (fallback ? ` <span class="fallback-mark">(${esc(t('i18n.missing'))})</span>` : '');
}

function section(titleKey, items, renderItem) {
  const inner = items.length
    ? `<ul>${items.map((i) => `<li>${renderItem(i)}</li>`).join('')}</ul>`
    : `<p class="empty">${esc(t('panel.empty'))}</p>`;
  return `<section class="section"><h3>${esc(t(titleKey))}</h3>${inner}</section>`;
}

function renderPanel() {
  const d = state.decades.find((x) => x.decade === state.decade);
  el.title.textContent = `${state.decade}${t('decade.suffix')}`;
  const objs = state.objects.filter((o) => isVisible(o, state.decade));
  el.body.innerHTML = [
    section('panel.population', d?.population ?? [], (p) =>
      `<strong>${p.year}:</strong> ${esc(p.value)} ${p.note ? textHtml(p.note) : ''} ${sourcesHtml(p.sources)}`),
    section('panel.events', d?.events ?? [], (e) =>
      `${e.year ? `<strong>${e.year}:</strong> ` : ''}${textHtml(e.text)} ${sourcesHtml(e.sources)}`),
    section('panel.objects', objs, (o) =>
      `<strong>${textHtml(o.name)}</strong> ${o.text ? textHtml(o.text) : ''} ${sourcesHtml(o.sources)}`),
    section('panel.people', d?.people ?? [], (p) =>
      `<strong>${textHtml(p.name)}</strong> ${p.text ? textHtml(p.text) : ''} ${sourcesHtml(p.sources)}`),
  ].join('');
}

function renderMap() {
  const drawn = renderObjects(el.mapObjects, state.objects, state.decade, () => {});
  el.mapStatus.textContent = state.baseLoaded && drawn === 0 ? t('map.no_objects') : '';
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

async function init() {
  await loadDicts();
  const [dec, obj, src] = await Promise.all([
    json('data/decades.json'), json('data/objects.json'), json('data/sources.json'),
  ]);
  state.decades = dec.decades;
  state.objects = obj.objects;
  state.sources = new Map(src.sources.map((s) => [s.id, s]));
  state.decade = decadeFromHash();

  state.baseLoaded = await loadBase(el.mapBase, t);
  render();

  el.timeline.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-decade]');
    if (b) selectDecade(+b.dataset.decade);
  });
  document.querySelector('.lang').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) { setLang(b.dataset.lang); render(); }
  });
  document.addEventListener('keydown', (e) => {
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
