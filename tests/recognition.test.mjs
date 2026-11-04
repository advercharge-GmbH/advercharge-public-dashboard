import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { knownBrand, recognitionRecords, sourceLabel } from '../recognition.mjs';
import { t, locale, setupLanguage, setLanguage } from '../i18n.mjs';

const session = (id, fields = {}) => ({id, created_at: '2026-11-03T10:00:00Z', ...fields});

test('EVCCID-only arrivals are recognized without any vision observations', () => {
  const [row] = recognitionRecords([session('s', {lookup_brand: 'Tesla', evccid_hash: 'private-id'})]);
  assert.equal(row.brand, 'Tesla');
  assert.equal(sourceLabel(row.source), 'Unique identifier');
});

test('resolved session identity wins over conflicting camera attempts', () => {
  const rows = recognitionRecords([session('s', {resolved_brand: 'Ford', identity_source: 'evccid_prefix'})], [
    {session_id: 's', make: 'Tesla', source: 'vertex_ai_gemini'},
    {session_id: 's', make: 'Honda', source: 'plate_recognizer'}
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brand, 'Ford');
  assert.equal(sourceLabel(rows[0].source), 'Unique identifier');
});

test('resolved AI and saved-profile identities keep their correct source', () => {
  const rows = recognitionRecords([
    session('ai', {resolved_brand: 'Fiat', lookup_brand: 'Hyundai', identity_source: 'vertex_ai_gemini'}),
    session('profile', {resolved_brand: 'Nissan', identity_source: 'vehicle_profile'})
  ]);
  assert.equal(rows[0].brand, 'Fiat');
  assert.equal(sourceLabel(rows[0].source), 'AI vision');
  assert.equal(sourceLabel(rows[1].source), 'Vehicle profile');
});

test('latest usable vision observation is a fallback and stays linked to the arrival', () => {
  const [row] = recognitionRecords([session('s')], [
    {session_id: 's', make: 'BMW', observed_at: '2026-11-03T11:00:00Z'},
    {camera_event_id: 'camera', make: 'Tesla', model: 'Model 3', source: 'vertex_ai_gemini', observed_at: '2026-11-04T11:00:00Z'},
    {session_id: 's', make: 'Ford', decision: 'rejected', observed_at: '2026-11-04T12:00:00Z'},
    {session_id: 'other-station', make: 'Audi', observed_at: '2026-11-04T13:00:00Z'}
  ], [{id: 'camera', session_id: 's'}]);
  assert.equal(row.brand, 'Tesla');
  assert.equal(row.model, 'Model 3');
  assert.equal(row.arrived_at, '2026-11-03T10:00:00Z');
  assert.equal(row.recognized_at, '2026-11-04T11:00:00Z');
});

test('unknown results do not inflate recognition counts', () => {
  for (const value of [null, '', ' ', 'Unknown', 'Unidentified', 'N/A']) assert.equal(knownBrand(value), '');
  const [row] = recognitionRecords([session('s', {resolved_brand: 'Unknown'})], [{session_id: 's', make: null}]);
  assert.equal(row.brand, '');
});

// Exercise the actual application fetch -> station scope -> range -> render path.
async function dashboard() {
  setLanguage('en');
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === '#periodFilter' ? '30' : '',
      textContent: '', innerHTML: '', dataset: {}, classList: {toggle() {}}, addEventListener() {}
    });
    return elements.get(selector);
  };
  const barth = '2251110030800001';
  const datasets = {
    public_dashboard_charging_sessions: [
      session('evccid', {station_sn: barth, lookup_brand: 'Tesla', evccid_hash: 'do-not-render'}),
      session('profile', {station_sn: barth, resolved_brand: 'Nissan', identity_source: 'vehicle_profile'}),
      session('vision', {station_sn: barth, created_at: '2026-10-20T10:00:00Z', resolved_brand: 'BMW', identity_source: 'vertex_ai_gemini'}),
      session('unknown', {station_sn: barth}),
      session('other', {station_sn: 'another-station', resolved_brand: 'Audi'})
    ],
    public_dashboard_vehicle_observations: [
      {session_id: 'vision', make: 'BMW', observed_at: '2026-10-20T11:00:00Z'},
      {session_id: 'vision', make: 'BMW', observed_at: '2026-10-20T12:00:00Z'}
    ]
  };
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-04T12:00:00Z'])); }
    static now() { return Date.parse('2026-11-04T12:00:00Z'); }
  };
  const context = vm.createContext({
    recognitionRecords, sourceLabel, t, locale, setupLanguage, Date: FixedDate, Intl, URLSearchParams, AbortController, setTimeout, clearTimeout,
    document: {documentElement: {}, querySelector: get, querySelectorAll: () => []}, location: {hash: ''},
    window: {PUBLIC_DASHBOARD_CONFIG: {SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-test-key'}, addEventListener() {}},
    fetch: async url => ({ok: true, json: async () => datasets[new URL(url).pathname.split('/').pop()] || [], headers: {get: () => '0-0/0'}})
  });
  const code = (await readFile(new URL('../app.js', import.meta.url), 'utf8'))
    .replace(/^import .*?;\r?\n/gm, '')
    .replace(/loadData\(\);\s*$/, 'globalThis.loading = loadData();');
  vm.runInContext(code, context);
  await context.loading;
  return {context, get, run: code => vm.runInContext(code, context)};
}

test('7-day dashboard shows EVCCID arrivals even when vision has no recent rows', async () => {
  const app = await dashboard();
  app.get('#periodFilter').value = '7';
  app.run('render()');
  assert.equal(app.get('#metricSessions').textContent, '3');
  assert.equal(app.get('#metricRecognized').textContent, '2');
  assert.equal(app.get('#vehicleCount').textContent, '2 of 3 recognized');
  assert.match(app.get('#cameraEvents').innerHTML, /Tesla/);
  assert.match(app.get('#cameraEvents').innerHTML, /Unique identifier/);
  assert.match(app.get('#cameraEvents').innerHTML, /Vehicle profile/);
  assert.doesNotMatch(app.get('#cameraEvents').innerHTML, /BMW|Audi|do-not-render/);
});

test('30-day dashboard combines sources and deduplicates repeated vision frames', async () => {
  const app = await dashboard();
  assert.equal(app.get('#vehicleCount').textContent, '3 of 4 recognized');
  assert.equal(app.get('#metricRecognized').textContent, '3');
  assert.match(app.get('#vehicleChart').innerHTML, /Tesla/);
  assert.match(app.get('#vehicleChart').innerHTML, /BMW/);
  assert.match(app.get('#vehicleChart').innerHTML, /Unidentified/);
  assert.equal((app.get('#cameraEvents').innerHTML.match(/BMW/g) || []).length, 1);
});

test('custom dates include Berlin midnight and exclude the following day', async () => {
  const app = await dashboard();
  app.get('#periodFilter').value = 'custom';
  app.get('#dateFrom').value = '2026-11-03';
  app.get('#dateTo').value = '2026-11-03';
  app.run('render()');
  assert.equal(app.get('#metricRecognized').textContent, '2');
  const range = app.run('currentRange()');
  assert.equal(new Date(range.from).toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(new Date(range.to).toISOString(), '2026-11-03T23:00:00.000Z');
});

test('switching languages updates live labels while keeping date filters and counts', async () => {
  const app = await dashboard();
  app.get('#periodFilter').value = '7';
  setLanguage('de');
  app.run('render()');
  assert.equal(app.get('#periodFilter').value, '7');
  assert.equal(app.get('#vehicleCount').textContent, '2 von 3 erkannt');
  assert.equal(app.get('#metricRecognized').textContent, '2');
  assert.match(app.get('#cameraEvents').innerHTML, /Fahrzeugkennung/);
  assert.match(app.get('#vehicleChart').innerHTML, /Nicht identifiziert/);
  setLanguage('en');
  app.run('render()');
  assert.equal(app.get('#vehicleCount').textContent, '2 of 3 recognized');
});
