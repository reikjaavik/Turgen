// Содержимое панели поверх карты. Каждая функция возвращает { title, html, mount?, focus? },
// где focus — что показать на схеме: { decade, highlight: [id мест], pulse: id }.
import { t } from './i18n.js';
import {
  db, decadesOf, eventsInDecade, peopleInDecade, personDecades, placeInDecade, chronological, decadeOf, decadeEnd,
} from './store.js';
import {
  esc, text, plain, sources, thumbs, relations, personCard, eventCard, empty, link, decadeLabel, decadeName,
} from './ui.js';

const themeOf = (id) => db.project.themes.find((x) => x.id === id);
const peopleOf = (e) => db.eventPeople.get(e.id) ?? [];
const placesOf = (e) => db.eventPlaces.get(e.id) ?? [];
const eventsOf = (ids = []) => ids.map((id) => db.byId.event.get(id)).filter(Boolean);
const topEvents = () => chronological(db.events.filter((e) => !e.parent));
const page = (inner, cls = '') => `<div class="page ${cls}">${inner}</div>`;
const notFound = () => ({ title: t('nf.title'), html: page(`<h1>${esc(t('nf.title'))}</h1><p><a href="#/">${esc(t('nav.home'))}</a></p>`) });

// ---------- Главная ----------
export function home() {
  const p = db.project;
  const line = chronological(db.events.filter((e) => e.line));
  const html = page(`
    <section class="hero">
      <h1>${esc(t('home.about'))}</h1>
      <p class="lead">${text(p.about)}</p>
      <p class="idea">${p.idea.map((x) => `<strong>${text(x)}</strong>`).join('<br>')}</p>
    </section>

    <section>
      <h2>${esc(t('home.how'))}</h2>
      <ul class="section-cards">${p.sections.map((s) =>
        `<li><a href="${s.route}"><span class="icon" aria-hidden="true">${s.icon}</span><strong>${text(s.title)}</strong><span>${text(s.text)}</span></a></li>`).join('')}
      </ul>
    </section>

    <section>
      <h2>${esc(t('home.line'))}</h2>
      <ol class="hline">${line.map((e) =>
        `<li><a href="${link.event(e.id)}"><span class="when">${esc(e.line.when)}</span><span class="what">${text(e.line.title)}</span></a></li>`).join('')}
      </ol>
      <p><a href="#/history">${esc(t('home.fullHistory'))} →</a></p>
    </section>

    <section class="two-col">
      <div>
        <h2>${esc(t('home.status'))}</h2>
        <p><strong>${esc(t('home.stage'))}</strong> ${text(p.status.stage)}</p>
        <p><strong>${esc(t('home.nextStage'))}</strong> ${text(p.status.next)}</p>
        <p class="stats">${esc(t('home.counts'))} ${db.people.length} · ${esc(t('home.countEvents'))} ${db.events.length} · ${esc(t('home.countPlaces'))} ${db.places.length} · ${esc(t('home.countPhotos'))} ${db.photos.length}</p>
      </div>
      <div>
        <h2>${esc(t('home.principle'))}</h2>
        <p>${text(p.principle.intro)}</p>
        <ul class="principle">${p.principle.items.map((x) => `<li>${text(x)}</li>`).join('')}</ul>
      </div>
    </section>`, 'home');
  return { title: '', html };
}

// ---------- Места: сводка десятилетия ----------
export function decadeView(decadeParam) {
  const decade = decadeOf(+decadeParam) ? +decadeParam : db.decades[0].decade;
  const d = decadeOf(decade);
  const evs = eventsInDecade(decade).filter((e) => !e.parent);
  const ppl = peopleInDecade(decade);
  const pls = db.places.filter((pl) => placeInDecade(pl, decade));
  const stats = d.population ?? [];
  const era = db.eras.find((e) => e.decade === decade);
  const html = page(`
    <p class="crumbs">🗺 ${esc(t('nav.map'))}</p>
    <h1 class="decade-title">${esc(decadeLabel(d))}</h1>
    ${era ? `<section class="section era"><h3>🏘 ${esc(t('recon.section'))}: ${text(era.title)}</h3><p>${text(era.text)} ${sources(era.sources)}</p><p class="muted small">${text(db.erasNote)}</p></section>` : ''}
    <section class="section"><h3>${esc(t('panel.population'))}</h3>${stats.length
      ? `<ul>${stats.map((s) => `<li>${s.year ? `<strong>${s.year}:</strong> ` : ''}${text(s.text)} ${sources(s.sources)}</li>`).join('')}</ul>` : empty()}</section>
    <section class="section"><h3>${esc(t('panel.events'))}</h3>${evs.length
      ? `<ul class="plain">${evs.map((e) => `<li>${eventCard(e)}</li>`).join('')}</ul>` : empty()}</section>
    <section class="section"><h3>${esc(t('panel.places'))}</h3>${pls.length
      ? `<ul>${pls.map((pl) => `<li><a href="${link.place(pl.id)}">${text(pl.name)}</a>${pl.lat == null ? ` <span class="muted">(${esc(t('map.noCoords'))})</span>` : pl.approx ? ` <span class="muted">(${esc(t('map.approx'))})</span>` : ''}</li>`).join('')}</ul>` : empty()}</section>
    <section class="section"><h3>${esc(t('panel.people'))}</h3>${ppl.length
      ? `<p>${esc(t('panel.peopleCount'))} ${ppl.length}. <a href="#/history/${decade}">${esc(t('panel.peopleLink'))} →</a></p>` : empty()}</section>`);
  return { title: `${t('nav.map')} · ${decadeLabel(d)}`, html, focus: { decade } };
}

// Первое десятилетие, в котором место есть на схеме (начиная с предпочтительного).
function decadeForPlace(pl, preferred) {
  if (preferred != null && placeInDecade(pl, preferred)) return preferred;
  return db.decades.find((d) => placeInDecade(pl, d.decade))?.decade ?? preferred;
}
// Десятилетие для набора мест: первое из кандидатов, где видно хоть одно отмеченное место.
function decadeFor(candidates, places) {
  const placed = places.filter((p) => p.lat != null);
  return candidates.find((d) => placed.some((p) => placeInDecade(p, d))) ?? candidates[0];
}

// ---------- Места: карточка ----------
export function placeView(id) {
  const pl = db.byId.place.get(id);
  if (!pl) return notFound();
  const evs = eventsOf(pl.events);
  const ppl = [...new Set([...evs.flatMap(peopleOf), ...db.people.filter((p) => (p.places ?? []).includes(id))])];
  // У места с известными годами (from/to) время — десятилетия, когда оно существует; иначе — по событиям.
  const decs = pl.from != null || pl.to != null
    ? db.decades.map((d) => d.decade).filter((n) => placeInDecade(pl, n))
    : [...new Set(evs.flatMap(decadesOf))].sort((a, b) => a - b);
  const html = page(`
    <p class="crumbs"><a href="#/map">🗺 ${esc(t('nav.map'))}</a></p>
    <h1>${text(pl.name)}</h1>
    ${pl.text ? `<p class="lead-sm">${text(pl.text)}</p>` : ''}
    ${pl.lat == null ? `<p class="muted">${esc(t('place.noCoords'))} <a href="#/mark">${esc(t('place.markIt'))}</a></p>` : pl.approx ? `<p class="muted">${esc(t('place.approx'))} <a href="#/mark">${esc(t('place.markIt'))}</a></p>` : ''}
    ${thumbs(pl.photos, 'large')}
    ${relations({ decades: decs, events: evs, src: pl.sources })}
    ${ppl.length ? `<h2>${esc(t('place.people'))} <span class="n">${ppl.length}</span></h2><p class="muted">${esc(t('place.peopleNote'))}</p><div class="people-grid">${ppl.map(personCard).join('')}</div>` : ''}`);
  return { title: plain(pl.name), html, focus: (cur) => ({ decade: decadeForPlace(pl, cur), highlight: [id], pulse: id }) };
}

// ---------- Люди ----------
export function peopleView(query) {
  const g = query.get('g') ?? '';
  const q = (query.get('q') ?? '').trim().toLowerCase();
  let list = db.people;
  if (g) list = list.filter((p) => p.groups.includes(g));
  if (q) list = list.filter((p) => plain(p.name).toLowerCase().includes(q));
  list = [...list].sort((a, b) => plain(a.name).localeCompare(plain(b.name), 'ru'));
  const tabs = [['', t('people.all'), db.people.length], ...db.groups.map((x) => [x.id, plain(x.title), db.people.filter((p) => p.groups.includes(x.id)).length])];
  const html = page(`
    <h1>${esc(t('nav.people'))}</h1>
    <form class="search" role="search" data-search>
      <input type="search" name="q" value="${esc(query.get('q') ?? '')}" placeholder="${esc(t('people.search'))}" aria-label="${esc(t('people.search'))}">
      ${g ? `<input type="hidden" name="g" value="${esc(g)}">` : ''}
    </form>
    <ul class="filter">${tabs.map(([id, label, n]) =>
      `<li><a href="#/people${id ? `?g=${id}` : ''}"${id === g ? ' aria-current="true"' : ''}>${esc(label)} <span class="n">${n}</span></a></li>`).join('')}</ul>
    ${list.length ? `<div class="people-grid">${list.map(personCard).join('')}</div>` : empty('people.none')}`);
  return { title: t('nav.people'), html };
}

export function personView(id) {
  const p = db.byId.person.get(id);
  if (!p) return notFound();
  const evs = chronological(eventsOf(p.events));
  const places = (p.places ?? []).map((x) => db.byId.place.get(x)).filter(Boolean);
  const groups = p.groups.map((x) => db.byId.group.get(x)).filter(Boolean);
  const memory = db.project.memories.find((m) => m.person === id);
  const html = page(`
    <p class="crumbs"><a href="#/people">${esc(t('nav.people'))}</a>${groups[0] ? ` / <a href="${link.group(groups[0].id)}">${text(groups[0].title)}</a>` : ''}</p>
    <article class="person">
      ${p.photos?.length ? `<div class="person-photos">${thumbs(p.photos, 'large')}</div>` : ''}
      <div>
        <h1>${text(p.name)}</h1>
        ${p.life ? `<p class="life">${esc(p.life)}</p>` : ''}
        <p class="lead-sm">${text(p.text)}</p>
        ${memory ? `<p><a href="#/sources">🎧 ${text(memory.title)}</a></p>` : ''}
        ${relations({ decades: personDecades(p), events: evs, places, groups, src: p.sources })}
      </div>
    </article>`);
  const mapPlaces = [...new Set([...places, ...evs.flatMap(placesOf)])];
  return { title: plain(p.name), html, focus: { decade: decadeFor(personDecades(p), mapPlaces), highlight: mapPlaces.map((x) => x.id) } };
}

// ---------- События ----------
export function eventsView(query) {
  const th = query.get('t') ?? '';
  const list = topEvents().filter((e) => !th || e.theme === th);
  const children = (e) => chronological(db.events.filter((x) => x.parent === e.id));
  const html = page(`
    <h1>${esc(t('nav.events'))}</h1>
    <ul class="filter">${[['', t('events.all')], ...db.project.themes.map((x) => [x.id, `${x.icon} ${plain(x.title)}`])].map(([id, label]) =>
      `<li><a href="#/events${id ? `?t=${id}` : ''}"${id === th ? ' aria-current="true"' : ''}>${esc(label)}</a></li>`).join('')}</ul>
    <ol class="event-list">${list.map((e) => `
      <li class="theme-${esc(e.theme)}">
        <a href="${link.event(e.id)}"><span class="when">${esc(e.when)}</span><strong>${text(e.title)}</strong></a>
        ${e.meaning ? `<p class="muted">${text(e.meaning)}</p>` : ''}
        <p class="meta">${peopleOf(e).length ? `👤 ${peopleOf(e).length}` : ''} ${(e.photos?.length ?? 0) ? `📷 ${e.photos.length}` : ''}</p>
        ${children(e).length ? `<ul class="sub">${children(e).map((c) => `<li><a href="${link.event(c.id)}">${text(c.title)}</a></li>`).join('')}</ul>` : ''}
      </li>`).join('')}</ol>`);
  return { title: t('nav.events'), html };
}

export function eventView(id) {
  const e = db.byId.event.get(id);
  if (!e) return notFound();
  const theme = themeOf(e.theme);
  const parent = e.parent ? db.byId.event.get(e.parent) : null;
  const kids = chronological(db.events.filter((x) => x.parent === id));
  const all = topEvents();
  const i = all.indexOf(parent ?? e);
  const ppl = [...peopleOf(e)].sort((a, b) => plain(a.name).localeCompare(plain(b.name), 'ru'));
  const html = page(`
    <p class="crumbs"><a href="#/events">${esc(t('nav.events'))}</a>${theme ? ` / <a href="#/events?t=${theme.id}">${theme.icon} ${text(theme.title)}</a>` : ''}${parent ? ` / <a href="${link.event(parent.id)}">${text(parent.title)}</a>` : ''}</p>
    <p class="when big">${esc(e.when)}</p>
    <h1>${text(e.title)}</h1>
    ${e.memory ? `<p class="badge">🎧 ${esc(t('event.memory'))}</p>` : ''}
    <p class="lead-sm">${text(e.text)} ${sources(e.sources)}</p>
    ${e.meaning ? `<p class="meaning"><strong>${esc(t('event.meaning'))}</strong> ${text(e.meaning)} ${sources([{ id: 'chronology' }])}</p>` : ''}
    ${thumbs(e.photos, 'large')}
    ${kids.length ? `<h2>${esc(t('event.parts'))}</h2><ul class="plain">${kids.map((k) => `<li>${eventCard(k)}</li>`).join('')}</ul>` : ''}
    ${ppl.length ? `<h2>${esc(t('rel.people'))} <span class="n">${ppl.length}</span></h2><div class="people-grid">${ppl.map(personCard).join('')}</div>` : ''}
    ${relations({ decades: decadesOf(e), places: placesOf(e) })}
    <nav class="pager">${i > 0 ? `<a href="${link.event(all[i - 1].id)}">← ${text(all[i - 1].title)}</a>` : '<span></span>'}${i >= 0 && i < all.length - 1 ? `<a href="${link.event(all[i + 1].id)}">${text(all[i + 1].title)} →</a>` : ''}</nav>`);
  return { title: plain(e.title), html, focus: { decade: decadeFor(decadesOf(e), placesOf(e)), highlight: placesOf(e).map((x) => x.id) } };
}

// ---------- История ----------
export function historyView(decadeParam) {
  const list = topEvents();
  const html = page(`
    <h1>${esc(t('nav.history'))}</h1>
    <section class="intro">${db.intro.map((x) => `<p>${text(x.text)} ${sources(x.sources)}</p>`).join('')}</section>

    <h2>${esc(t('history.line'))}</h2>
    <div class="table-wrap"><table class="chrono">
      <thead><tr><th>${esc(t('history.when'))}</th><th>${esc(t('history.what'))}</th><th>${esc(t('history.meaning'))}</th></tr></thead>
      <tbody>${list.map((e) => `<tr><td class="when">${esc(e.when)}</td><td><a href="${link.event(e.id)}">${text(e.title)}</a></td><td>${e.meaning ? text(e.meaning) : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="src">${sources([{ id: 'chronology', ref: t('history.lineRef') }])}</p>

    <h2>${esc(t('history.byDecade'))}</h2>
    ${db.decades.map((d) => {
      const evs = chronological(eventsInDecade(d.decade));
      const ppl = peopleInDecade(d.decade);
      return `<section class="decade" id="d${d.decade}">
        <h3><a href="#/map/${d.decade}">${esc(decadeLabel(d))}</a></h3>
        ${(d.population ?? []).map((s) => `<p class="stat">${s.year ? `<strong>${s.year}:</strong> ` : ''}${text(s.text)} ${sources(s.sources)}</p>`).join('')}
        ${evs.length ? `<ul class="plain">${evs.map((e) => `<li>${eventCard(e)}</li>`).join('')}</ul>` : empty()}
        ${ppl.length ? `<details><summary>${esc(t('rel.people'))}: ${ppl.length}</summary><div class="people-grid">${ppl.map(personCard).join('')}</div></details>` : ''}
      </section>`;
    }).join('')}`);
  const mount = () => {
    if (decadeParam) document.getElementById(`d${decadeParam}`)?.scrollIntoView({ block: 'start' });
  };
  return { title: t('nav.history'), html, mount, keepScroll: !!decadeParam, focus: decadeParam ? { decade: +decadeParam } : null };
}

// ---------- Фотоархив ----------
const PHOTO_FILTERS = ['person', 'event', 'place', 'document'];
export function photosView(query) {
  const f = query.get('f') ?? '';
  const match = (r) => !f || (f === 'document' ? r.photo.kind === 'document' : r.owner.type === f && r.photo.kind !== 'document');
  const list = db.photos.filter(match);
  const html = page(`
    <h1>${esc(t('nav.photos'))}</h1>
    <ul class="filter">${[['', t('photos.all'), db.photos.length], ...PHOTO_FILTERS.map((id) => [id, t(`photos.${id}`), db.photos.filter((r) => (id === 'document' ? r.photo.kind === 'document' : r.owner.type === id && r.photo.kind !== 'document')).length])].map(([id, label, n]) =>
      `<li><a href="#/photos${id ? `?f=${id}` : ''}"${id === f ? ' aria-current="true"' : ''}>${esc(label)} <span class="n">${n}</span></a></li>`).join('')}</ul>
    <div class="photo-grid">${list.map((r) => `<figure>
      <button type="button" class="thumb" data-photo="${esc(r.photo.id)}"><img loading="lazy" decoding="async" src="assets/photos/thumb/${esc(r.photo.id)}.jpg" alt="${esc(plain(r.photo.caption))}"></button>
      <figcaption>${ownerLink(r.owner)}</figcaption></figure>`).join('')}</div>`);
  return { title: t('nav.photos'), html };
}

export function ownerLink({ type, id }) {
  const rec = db.byId[type]?.get(id);
  if (!rec) return '';
  const name = rec.name ?? rec.title;
  return `<a href="${link[type](id)}">${text(name)}</a>`;
}

// ---------- Интервью и источники ----------
export function sourcesView() {
  const mem = db.project.memories;
  const html = page(`
    <h1>🎧 ${esc(t('nav.sources'))}</h1>
    <section>
      <h2>${esc(t('sources.interviews'))}</h2>
      ${empty('sources.noInterviews')}
    </section>
    <section>
      <h2>${esc(t('sources.memories'))}</h2>
      ${mem.map((m) => `<blockquote class="memory"><h3>${text(m.title)}</h3><p>${text(m.text)}</p>
        <footer>${m.person ? `<a href="${link.person(m.person)}">${text(db.byId.person.get(m.person)?.name)}</a> ` : ''}${sources(m.sources)}</footer></blockquote>`).join('')}
    </section>
    <section>
      <h2>${esc(t('sources.list'))}</h2>
      <ul class="sources-list">${[...db.sources.values()].map((s) =>
        `<li><strong>${esc(s.title)}</strong>${s.note ? `<br><span class="muted">${esc(s.note)}</span>` : ''}</li>`).join('')}</ul>
    </section>`);
  return { title: t('nav.sources'), html };
}

// ---------- Виртуальная экскурсия ----------
// Маршрут = тематическая линия из хронологии проекта; остановки — события линии по порядку.
const stopsOf = (themeId) => chronological(db.events.filter((e) => e.theme === themeId));

export function tourView(themeId, stepParam) {
  const idea = db.project.tourIdea;
  if (!themeId) {
    const html = page(`
      <h1>🚶 ${esc(t('nav.tour'))}</h1>
      <p class="lead-sm">${text(idea.text)} ${sources(idea.sources)}</p>
      <p>${esc(t('tour.how'))}</p>
      <ul class="theme-cards">${db.project.themes.map((th) => {
        const n = stopsOf(th.id).length;
        return `<li><a href="${link.theme(th.id)}"><span class="icon" aria-hidden="true">${th.icon}</span><strong>${text(th.title)}</strong><span>${text(th.text)}</span><span class="n">${esc(t('tour.stops'))} ${n}</span></a></li>`;
      }).join('')}</ul>
      <p class="src">${sources(db.project.themes[0].sources)}</p>`);
    return { title: t('nav.tour'), html };
  }
  const th = themeOf(themeId);
  if (!th) return notFound();
  const stops = stopsOf(themeId);
  const i = Math.min(Math.max(+(stepParam ?? 0) || 0, 0), stops.length - 1);
  const e = stops[i];
  if (!e) return notFound();
  const ppl = peopleOf(e);
  const pls = placesOf(e);
  const photos = [...(e.photos ?? []), ...pls.flatMap((p) => p.photos ?? [])].slice(0, 8);
  const html = page(`
    <p class="crumbs"><a href="#/tour">${esc(t('nav.tour'))}</a> / ${th.icon} ${text(th.title)}</p>
    <ol class="tour-steps">${stops.map((s, k) => `<li><a href="${link.theme(themeId)}/${k}"${k === i ? ' aria-current="step"' : ''} title="${esc(plain(s.title))}">${k + 1}</a></li>`).join('')}</ol>
    <article class="tour-stop">
      <p class="when big">${esc(e.when)}</p>
      <h1>${text(e.title)}</h1>
      ${thumbs(photos, 'large')}
      <p class="lead-sm">${text(e.text)} ${sources(e.sources)}</p>
      ${pls.length ? `<p>📍 ${pls.map((p) => `<a href="${link.place(p.id)}">${text(p.name)}</a>`).join(', ')}</p>` : ''}
      ${ppl.length ? `<h2>${esc(t('rel.people'))} <span class="n">${ppl.length}</span></h2><div class="people-grid">${ppl.map(personCard).join('')}</div>` : ''}
      <p><a href="${link.event(e.id)}">${esc(t('tour.more'))} →</a></p>
    </article>
    <nav class="pager">${i > 0 ? `<a href="${link.theme(themeId)}/${i - 1}">← ${esc(t('tour.prev'))}</a>` : '<span></span>'}${i < stops.length - 1 ? `<a href="${link.theme(themeId)}/${i + 1}">${esc(t('tour.next'))} →</a>` : `<a href="#/tour">${esc(t('tour.end'))}</a>`}</nav>`);
  return {
    title: plain(th.title) === plain(e.title) ? plain(e.title) : `${plain(th.title)} · ${plain(e.title)}`,
    html,
    focus: { decade: decadeFor(decadesOf(e), pls), highlight: pls.map((x) => x.id) },
  };
}

export { notFound, decadeName, decadeEnd, decadeForPlace };
