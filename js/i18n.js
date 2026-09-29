const dicts = {};
let lang = 'ru';

export async function loadDicts() {
  for (const l of ['ru', 'kz']) {
    const res = await fetch(`data/i18n/${l}.json`);
    dicts[l] = res.ok ? await res.json() : {};
  }
}

export function getLang() { return lang; }
export function setLang(l) { lang = l; document.documentElement.lang = l === 'kz' ? 'kk' : 'ru'; }

// UI string by key. Kazakh is never machine-translated: a missing key falls back to Russian.
export function t(key) {
  return dicts[lang]?.[key] ?? dicts.ru?.[key] ?? key;
}

// Content field shaped like { ru, kz? }. Returns { text, fallback }.
export function pick(field) {
  if (field == null) return { text: '', fallback: false };
  if (typeof field === 'string') return { text: field, fallback: false };
  if (lang === 'kz' && !field.kz && field.ru) return { text: field.ru, fallback: true };
  return { text: field[lang] ?? field.ru ?? '', fallback: false };
}
