import { loadDicts, t, pick, setLang, getLang } from './i18n.js';
import { db, loadAll } from './store.js';
import { esc, text, sources } from './ui.js';
import * as V from './views.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const lightbox = $('#lightbox');
let current = null; // результат последнего рендера (нужен для стрелок на карте)

// Маршруты: #/, #/map/1940, #/people, #/people/<id>, #/history/1940, #/events, #/events/<id>,
// #/places/<id>, #/photos, #/sources, #/tour, #/tour/<тема>/<шаг>. Старые ссылки #1940 → #/map/1940.
function parse() {
  let h = location.hash.slice(1);
  if (/^\d{4}$/.test(h)) { history.replaceState(null, '', `#/map/${h}`); h = `/map/${h}`; }
  const [path, qs = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

function resolve({ parts: [section, a, b], query }) {
  switch (section) {
    case undefined: return V.home();
    case 'map': return V.mapView(a);
    case 'places': return a ? V.placeView(a) : V.mapView();
    case 'people': return a ? V.personView(a) : V.peopleView(query);
    case 'history': return V.historyView(a);
    case 'events': return a ? V.eventView(a) : V.eventsView(query);
    case 'photos': return V.photosView(query);
    case 'sources': return V.sourcesView();
    case 'tour': return V.tourView(a, b);
    default: return V.notFound();
  }
}

async function render() {
  const route = parse();
  current = resolve(route);
  document.body.dataset.layout = current.layout ?? 'page';
  view.innerHTML = current.html;
  document.title = current.title ? `${current.title} — ${t('site.title')}` : `${t('site.title')} — ${t('site.tagline')}`;
  const section = route.parts[0] === 'places' ? 'map' : route.parts[0] ?? '';
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (!current.keepScroll) window.scrollTo(0, 0);
  await current.mount?.(view);
}

function renderStatic() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  const notice = $('#lang-notice');
  notice.hidden = getLang() !== 'kz';
  notice.textContent = getLang() === 'kz' ? t('i18n.notice') : '';
}

function openPhoto(id) {
  const rec = db.photoById.get(id);
  if (!rec) return;
  const { photo, owner } = rec;
  lightbox.querySelector('img').src = `assets/photos/${id}.jpg`;
  lightbox.querySelector('img').alt = pick(photo.caption).text;
  lightbox.querySelector('figcaption').innerHTML =
    `${text(photo.caption)} ${sources(photo.sources)}<br>${esc(t('photo.related'))} ${V.ownerLink(owner)}`;
  lightbox.showModal();
}

// Карта: стрелки ←/→ и свайп листают десятилетия.
function stepDecade(delta) {
  if (current?.layout !== 'map') return;
  const i = db.decades.findIndex((d) => d.decade === current.decade) + delta;
  if (i >= 0 && i < db.decades.length) location.hash = `#/map/${db.decades[i].decade}`;
}

async function init() {
  await loadDicts();
  await loadAll();
  renderStatic();
  await render();

  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-photo]');
    if (b) openPhoto(b.dataset.photo);
  });
  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-search]');
    if (!form) return;
    e.preventDefault();
    const q = new URLSearchParams(new FormData(form));
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    location.hash = `#/people${q.toString() ? `?${q}` : ''}`;
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target.closest('.close') || e.target.closest('figcaption a')) lightbox.close();
  });
  document.querySelector('.lang').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) { setLang(b.dataset.lang); renderStatic(); render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (lightbox.open || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') stepDecade(-1);
    if (e.key === 'ArrowRight') stepDecade(1);
  });
  let x0 = null;
  view.addEventListener('touchstart', (e) => { x0 = e.target.closest('.map-wrap') ? e.touches[0].clientX : null; }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) stepDecade(dx < 0 ? 1 : -1);
    x0 = null;
  });
}

init().catch((err) => {
  console.error(err);
  view.innerHTML = '<p class="empty page">Не удалось загрузить данные. Откройте сайт через веб-сервер (не file://).</p>';
});
