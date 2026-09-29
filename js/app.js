import { loadDicts, t, pick, setLang, getLang } from './i18n.js';
import { db, loadAll, placeInDecade, decadeOf } from './store.js';
import { esc, text, plain, sources, decadeLabel, link } from './ui.js';
import * as V from './views.js';
import * as Mark from './mark.js';
import * as Map2d from './map.js';
import * as Map3d from './map3d.js';

// Сцена: 3D (MapLibre, нужен WebGL) или запасная 2D-схема (SVG).
const Stage = Map3d.supported() ? Map3d : Map2d;

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const lightbox = $('#lightbox');
const state = { decade: 1900, current: null, drawer: 'open', keepClosed: false };

// Маршруты: #/, #/map/1940, #/people, #/people/<id>, #/history/1940, #/events, #/events/<id>,
// #/places/<id>, #/photos, #/sources, #/tour, #/tour/<тема>/<шаг>, #/mark. Старые ссылки #1940 → #/map/1940.
function parse() {
  let h = location.hash.slice(1);
  if (/^\d{4}$/.test(h)) { history.replaceState(null, '', `#/map/${h}`); h = `/map/${h}`; }
  const [path, qs = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

function resolve({ parts: [section, a, b], query }) {
  switch (section) {
    case undefined: return V.home();
    case 'map': return V.decadeView(a ?? state.decade);
    case 'places': return a ? V.placeView(a) : V.decadeView(state.decade);
    case 'people': return a ? V.personView(a) : V.peopleView(query);
    case 'history': return V.historyView(a);
    case 'events': return a ? V.eventView(a) : V.eventsView(query);
    case 'photos': return V.photosView(query);
    case 'sources': return V.sourcesView();
    case 'tour': return V.tourView(a, b);
    case 'mark': return Mark.markView();
    default: return V.notFound();
  }
}

// ---------- карта ----------
function applyFocus() {
  const f = typeof state.current?.focus === 'function' ? state.current.focus(state.decade) : state.current?.focus;
  if (f?.decade != null && decadeOf(f.decade)) state.decade = f.decade;
  const decade = state.decade;
  Stage.setFocus({
    places: db.places,
    isVisible: (pl) => placeInDecade(pl, decade),
    today: decade >= 2000,
    highlight: f?.highlight ?? [],
    pulse: f?.pulse ?? null,
  });
  $('#stage-decade').textContent = decadeLabel(decadeOf(decade));
  document.querySelectorAll('#timeline a').forEach((a) => {
    if (+a.dataset.decade === decade) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  // Честно показываем, что в этом десятилетии ещё не отмечено на схеме.
  const unmarked = db.places.filter((pl) => pl.lat == null && placeInDecade(pl, decade));
  const box = $('#unmarked');
  box.hidden = unmarked.length === 0;
  box.querySelector('summary').textContent = `${t('map.unmarked')} ${unmarked.length}`;
  box.querySelector('ul').innerHTML = unmarked.map((pl) => `<li><a href="${link.place(pl.id)}">${text(pl.name)}</a></li>`).join('')
    + `<li class="mark-link"><a href="#/mark">📍 ${esc(t('mark.title'))}</a></li>`;

  // Легенда — только когда на схеме есть отмеченные объекты кроме центра аула.
  $('#legend').hidden = !db.places.some((pl) => pl.lat != null && pl.type !== 'village' && placeInDecade(pl, decade));

  const marking = !!state.current?.marking;
  Stage.setDrafts(marking ? Mark.getMarks() : {});
  Stage.setMapClick(marking ? (ll) => { if (Mark.place(ll)) render(); } : null);
  const hint = $('#stage-hint');
  hint.hidden = !marking;
  if (marking) {
    const sel = Mark.getSelected();
    hint.textContent = sel ? `${t('mark.clickFor')} ${plain(db.byId.place.get(sel)?.name)}` : t('mark.done');
  }
}

function renderTimeline() {
  $('#timeline').innerHTML = db.decades.map((d) =>
    `<li><a class="decade-btn" data-decade="${d.decade}" href="#/map/${d.decade}">${esc(decadeLabel(d))}</a></li>`).join('');
}

// ---------- панель ----------
const isPhone = () => matchMedia('(max-width: 800px)').matches;
const defaultDrawer = () => (isPhone() ? 'half' : 'open');
function setDrawer(s) {
  state.drawer = s;
  document.body.dataset.drawer = s;
  $('#drawer-open').hidden = s !== 'closed';
}

async function render() {
  const route = parse();
  state.current = resolve(route);
  view.innerHTML = state.current.html;
  document.title = state.current.title ? `${state.current.title} — ${t('site.title')}` : `${t('site.title')} — ${t('site.tagline')}`;
  const section = route.parts[0] === 'places' ? 'map' : route.parts[0] ?? '';
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Переход по шкале при свёрнутой панели оставляет её свёрнутой — видна чистая карта.
  if (state.drawer === 'closed' && !state.keepClosed) setDrawer(defaultDrawer());
  state.keepClosed = false;
  if (!state.current.keepScroll) view.scrollTop = 0;
  applyFocus();
  await state.current.mount?.(view);
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

function stepDecade(delta) {
  const i = db.decades.findIndex((d) => d.decade === state.decade) + delta;
  if (i < 0 || i >= db.decades.length) return;
  state.keepClosed = true;
  location.hash = `#/map/${db.decades[i].decade}`;
}

async function init() {
  await loadDicts();
  await loadAll();
  renderStatic();
  renderTimeline();
  setDrawer(defaultDrawer());
  const use3d = Stage === Map3d;
  document.body.dataset.stage = use3d ? '3d' : '2d';
  await Stage.initStage(use3d ? $('#map3d') : $('#map'), {
    onSelect: (pl) => { location.hash = link.place(pl.id); },
    label: (pl) => plain(pl.short ?? pl.name),
    placeById: (id) => db.byId.place.get(id),
  });
  await render();

  window.addEventListener('hashchange', render);
  $('#timeline').addEventListener('click', () => { state.keepClosed = true; });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-photo]');
    if (b) openPhoto(b.dataset.photo);
    const z = e.target.closest('[data-zoom]');
    if (z) {
      if (z.dataset.zoom === 'view') z.textContent = Stage.toggle3d() ? '2D' : '3D';
      else ({ in: () => Stage.zoomBy(1.5), out: () => Stage.zoomBy(1 / 1.5), reset: () => Stage.resetZoom() })[z.dataset.zoom]();
    }
    const sel = e.target.closest('[data-mark-select]');
    if (sel) { Mark.select(sel.dataset.markSelect); render(); }
    const del = e.target.closest('[data-mark-remove]');
    if (del) { Mark.remove(del.dataset.markRemove); render(); }
    if (e.target.closest('[data-mark-clear]') && confirm(t('mark.clearConfirm'))) { Mark.clearAll(); render(); }
    if (e.target.closest('[data-mark-copy]')) {
      const json = Mark.exportJson();
      navigator.clipboard?.writeText(json).then(() => { e.target.textContent = t('mark.copied'); }, () => {});
      view.querySelector('.mark-json')?.select();
    }
  });
  $('#drawer-close').addEventListener('click', () => setDrawer('closed'));
  $('#drawer-open').addEventListener('click', () => setDrawer(defaultDrawer()));
  $('#drawer-size').addEventListener('click', () => {
    const order = { half: 'full', full: 'half', open: 'open', closed: 'half' };
    setDrawer(order[state.drawer]);
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
    if (b) { setLang(b.dataset.lang); renderStatic(); renderTimeline(); render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (lightbox.open || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') stepDecade(-1);
    if (e.key === 'ArrowRight') stepDecade(1);
  });
  let x0 = null;
  const stage = $('#stage');
  stage.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 == null || state.current?.marking || document.body.dataset.stage === '3d') return;
    const dx = e.changedTouches[0].clientX - x0;
    // Свайп листает десятилетия, только если схема не приближена (иначе это перетаскивание).
    if (Math.abs(dx) > 60 && $('#map').style.getPropertyValue('--k') <= 1) stepDecade(dx < 0 ? 1 : -1);
    x0 = null;
  });
}

init().catch((err) => {
  console.error(err);
  view.innerHTML = '<p class="empty page">Не удалось загрузить данные. Откройте сайт через веб-сервер (не file://).</p>';
});
