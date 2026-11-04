import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { german, t, locale, setLanguage, setupLanguage } from '../i18n.mjs';

test('every marked static phrase and accessible label has a German translation', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const phrases = [...html.matchAll(/<\w+[^>]*\bdata-i18n(?=\s|>)[^>]*>([^<>]+)</g)].map(match => match[1].trim());
  phrases.push(...[...html.matchAll(/data-i18n-aria aria-label="([^"]+)"/g)].map(match => match[1]));
  assert.ok(phrases.length > 60);
  for (const phrase of phrases) assert.ok(german[phrase], `Missing translation: ${phrase}`);
});

test('dynamic messages and numbers use the selected locale', () => {
  setLanguage('de');
  assert.equal(t('{recognized} of {total} recognized', {recognized: 6, total: 7}), '6 von 7 erkannt');
  assert.equal(new Intl.NumberFormat(locale()).format(125531), '125.531');
  assert.equal(t('Tesla'), 'Tesla');
  setLanguage('en');
  assert.equal(t('Overview'), 'Overview');
  assert.equal(t('Updated {date}', {date: 'today'}), 'Updated today');
});

function page() {
  const element = (textContent = '', dataset = {}) => ({
    textContent, dataset, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this[name] = handler; }
  });
  const heading = element('Overview');
  const buttons = ['de', 'en'].map(language => element(language.toUpperCase(), {language}));
  return {heading, buttons, documentElement: {}, querySelectorAll(selector) {
    return selector === '[data-i18n]' ? [heading] : selector === '[data-language]' ? buttons : [];
  }};
}

test('toggle persists preference, updates accessibility, and restores English losslessly', () => {
  let saved = 'de', changes = 0;
  const storage = {getItem: () => saved, setItem: (key, value) => { saved = value; }};
  const root = page();
  setupLanguage(root, () => changes++, storage);
  assert.equal(root.documentElement.lang, 'de');
  assert.equal(root.heading.textContent, 'Übersicht');
  assert.equal(root.buttons[0].attributes['aria-pressed'], 'true');
  root.buttons[1].click();
  assert.equal(saved, 'en');
  assert.equal(root.heading.textContent, 'Overview');
  assert.equal(root.documentElement.lang, 'en');
  assert.equal(changes, 1);
  setupLanguage(page(), () => {}, storage);
  assert.equal(locale(), 'en-GB');
});

test('language switching works when browser storage is blocked', () => {
  const root = page();
  const storage = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  setupLanguage(root, () => {}, storage);
  root.buttons[0].click();
  assert.equal(root.heading.textContent, 'Übersicht');
  setLanguage('en');
});
