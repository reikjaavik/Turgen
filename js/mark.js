// Режим разметки (#/mark): автор выбирает место из списка и кликает по схеме.
// Отметки — черновики в браузере; кнопка «Скопировать» отдаёт JSON, который автор присылает для внесения в data/places.json.
import { t } from './i18n.js';
import { db } from './store.js';
import { esc, text, plain } from './ui.js';

const KEY = 'turgen.marks';
let marks = load();
let selected = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch { /* без хранилища — отметки живут до перезагрузки */ }
}

export const getMarks = () => marks;
export const getSelected = () => selected;
export function select(id) { selected = id; }
export function place(ll) {
  if (!selected) return false;
  marks = { ...marks, [selected]: { lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6) } };
  save();
  // Следующее неотмеченное место — чтобы размечать подряд.
  const next = candidates().find((p) => !marks[p.id] && (p.lat == null || p.approx));
  selected = next?.id ?? null;
  return true;
}
export function remove(id) {
  const { [id]: _, ...rest } = marks;
  marks = rest;
  save();
}
export function clearAll() { marks = {}; save(); }
export const exportJson = () => JSON.stringify(marks, null, 2);

// Все места: сначала без координат и «примерные», затем уже отмеченные (их можно переставить).
const unplaced = (p) => p.lat == null || p.approx;
const candidates = () => [...db.places.filter(unplaced), ...db.places.filter((p) => !unplaced(p))];

export function markView() {
  const list = candidates();
  if (selected == null) selected = list.find((p) => !marks[p.id] && unplaced(p))?.id ?? null;
  const n = Object.keys(marks).length;
  const html = `<div class="page mark">
    <h1>📍 ${esc(t('mark.title'))}</h1>
    <p>${esc(t('mark.how'))}</p>
    <ol class="mark-list">${list.map((p) => {
      const m = marks[p.id];
      return `<li class="${p.id === selected ? 'selected' : ''}">
        <button type="button" class="mark-pick" data-mark-select="${esc(p.id)}" aria-pressed="${p.id === selected}">
          <strong>${text(p.name)}</strong>
          <span class="muted">${m ? `✓ ${esc(t('mark.draft'))} ${m.lat}, ${m.lon}` : p.approx ? esc(t('mark.approx')) : p.lat == null ? esc(t('mark.none')) : `${esc(t('mark.has'))} ${p.lat}, ${p.lon}`}</span>
        </button>
        ${m ? `<button type="button" class="mark-del" data-mark-remove="${esc(p.id)}" aria-label="${esc(t('mark.remove'))}">✕</button>` : ''}
      </li>`;
    }).join('')}</ol>
    <p class="mark-status">${selected ? `${esc(t('mark.now'))} <strong>${esc(plain(db.byId.place.get(selected)?.name))}</strong>` : esc(t('mark.done'))}</p>
    <div class="mark-actions">
      <button type="button" class="btn" data-mark-copy ${n ? '' : 'disabled'}>${esc(t('mark.copy'))} (${n})</button>
      <button type="button" class="btn secondary" data-mark-clear ${n ? '' : 'disabled'}>${esc(t('mark.clear'))}</button>
    </div>
    ${n ? `<textarea class="mark-json" readonly rows="6" aria-label="JSON">${esc(exportJson())}</textarea>` : ''}
    <p class="muted small">${esc(t('mark.note'))}</p>
  </div>`;
  return { title: t('mark.title'), html, focus: { decade: 2000 }, marking: true };
}
