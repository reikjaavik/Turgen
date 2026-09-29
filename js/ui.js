// Общие элементы разметки: текст с учётом языка, источники, фото, ссылки-«чипы».
import { t, pick } from './i18n.js';
import { db, portrait } from './store.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function text(field) {
  const { text: s, fallback } = pick(field);
  return esc(s) + (fallback ? ` <span class="fallback-mark">(${esc(t('i18n.missing'))})</span>` : '');
}
export const plain = (field) => pick(field).text;

export function sources(list = []) {
  const parts = list.map(({ id, ref }) => {
    const name = db.sources.get(id)?.short ?? id;
    return esc(ref ? `${name}, ${ref}` : name);
  });
  return parts.length ? `<span class="src">[${parts.join('; ')}]</span>` : '';
}

export function thumbs(photos = [], size = '') {
  if (!photos.length) return '';
  return `<div class="photos ${size}">${photos.map((p) =>
    `<button type="button" class="thumb" data-photo="${esc(p.id)}" aria-label="${esc(plain(p.caption))}"><img loading="lazy" decoding="async" src="assets/photos/thumb/${esc(p.id)}.jpg" alt="${esc(plain(p.caption))}"></button>`
  ).join('')}</div>`;
}

export const decadeLabel = (d) => (d.label ? plain(d.label) : `${d.decade}${t('decade.suffix')}`);
export const decadeName = (n) => {
  const d = db.decades.find((x) => x.decade === n);
  return d ? decadeLabel(d) : `${n}${t('decade.suffix')}`;
};

export const link = {
  person: (id) => `#/people/${id}`,
  event: (id) => `#/events/${id}`,
  place: (id) => `#/places/${id}`,
  decade: (n) => `#/history/${n}`,
  group: (id) => `#/people?g=${id}`,
  theme: (id) => `#/tour/${id}`,
};

export function chips(kind, items) {
  if (!items.length) return '';
  const icon = { person: '👤', event: '⚔', place: '📍', time: '🕰', group: '👥' }[kind];
  return `<ul class="chips">${items.map(([href, label]) =>
    `<li><a class="chip chip-${kind}" href="${href}"><span aria-hidden="true">${icon}</span> ${esc(label)}</a></li>`).join('')}</ul>`;
}

// Блок связей записи: время, события, люди, места, источник — «Главный принцип» проекта.
export function relations({ decades = [], events = [], people = [], places = [], groups = [], src = [] }) {
  const rows = [
    ['rel.time', chips('time', decades.map((n) => [link.decade(n), decadeName(n)]))],
    ['rel.events', chips('event', events.map((e) => [link.event(e.id), plain(e.title)]))],
    ['rel.people', people.length > 12
      ? `${chips('person', people.slice(0, 12).map((p) => [link.person(p.id), plain(p.name)]))}<p class="more">${esc(t('rel.more'))} ${people.length - 12}</p>`
      : chips('person', people.map((p) => [link.person(p.id), plain(p.name)]))],
    ['rel.places', chips('place', places.map((p) => [link.place(p.id), plain(p.name)]))],
    ['rel.groups', chips('group', groups.map((g) => [link.group(g.id), plain(g.title)]))],
    ['rel.sources', src.length ? `<p>${sources(src)}</p>` : ''],
  ].filter(([, html]) => html);
  if (!rows.length) return '';
  return `<dl class="relations">${rows.map(([k, html]) => `<dt>${esc(t(k))}</dt><dd>${html}</dd>`).join('')}</dl>`;
}

export function personCard(p) {
  const img = portrait(p);
  const face = img
    ? `<img loading="lazy" decoding="async" src="assets/photos/thumb/${esc(img)}.jpg" alt="">`
    : `<span class="initials" aria-hidden="true">${esc(plain(p.name).split(/\s+/).slice(0, 2).map((w) => w[0]).join(''))}</span>`;
  return `<a class="person-card" href="${link.person(p.id)}"><span class="face">${face}</span><span class="pc-body"><strong>${text(p.name)}</strong>${p.life ? `<span class="life">${esc(p.life)}</span>` : ''}</span></a>`;
}

export function eventCard(e) {
  return `<a class="event-card theme-${esc(e.theme)}" href="${link.event(e.id)}"><span class="when">${esc(e.when)}</span><strong>${text(e.title)}</strong></a>`;
}

export const empty = (key = 'panel.empty') => `<p class="empty">${esc(t(key))}</p>`;
