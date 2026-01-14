const fs = require('fs');
const path = require('path');

const LOCALE_DIR = __dirname;
const cache = {};

function loadLocale(lang) {
  if (cache[lang]) return cache[lang];
  const file = path.join(LOCALE_DIR, `${lang}.json`);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    cache[lang] = JSON.parse(raw);
  } catch (e) {
    cache[lang] = {}; // fallback empty
  }
  return cache[lang];
}

const base = loadLocale('en');
['es','de','fr','pt'].forEach(loadLocale);

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{{2}(\w+)\}{2}/g, (_, key) => (key in vars ? String(vars[key]) : `{{${key}}}`));
}

function resolveKey(langObj, key) {
  // Support nested dotted keys
  if (key in langObj) return langObj[key];
  const parts = key.split('.');
  let cur = langObj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function t(lang, key, vars) {
  if (!lang) lang = 'en';
  const langObj = loadLocale(lang) || {};
  let template = resolveKey(langObj, key);
  if (!template) {
    template = resolveKey(base, key);
  }
  if (!template) return key; // debugging fallback
  return interpolate(template, vars);
}

module.exports = { t, loadLocale };
