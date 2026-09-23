// This dashboard is scoped to a single station: Barth.
// Connector mapping per station configuration: 1 = right bay, 2 = left bay.
const BARTH_STATION_SN = '2251110030800001';
const connectorLabel = id => (String(id) === '1' ? 'Right connector' : String(id) === '2' ? 'Left connector' : `Connector ${id}`);

// The browser only requests these public views and these explicit columns.
// Keep this list aligned with supabase_public_views.sql.
const DATASETS = {
  charging_sessions: {
    label: 'Charging sessions', view: 'public_dashboard_charging_sessions', order: 'created_at.desc',
    columns: ['id','transaction_id','status','station_sn','connector_id','site_id','lookup_brand','monta_start_time','monta_end_time','evb_start_time','evb_end_time','duration_seconds','energy_kwh','meter_start','meter_stop','camera_capture_status','gemini_status','campaign_status','created_at','updated_at','controller_id','resolved_brand','resolved_model','resolved_color','identity_source','identity_confidence','identity_updated_at','evccid_hash'],
    display: ['transaction_id','status','site_id','station_sn','connector_id','resolved_brand','energy_kwh','created_at']
  },
  camera_events: {
    label: 'Camera events', view: 'public_dashboard_camera_events', order: 'capture_time.desc',
    columns: ['id','session_id','camera_id','controller_id','event_type','capture_time','status','zone_id','updated_at'],
    display: ['event_type','status','camera_id','zone_id','capture_time']
  },
  vehicle_observations: {
    label: 'Vehicle observations', view: 'public_dashboard_vehicle_observations', order: 'observed_at.desc',
    columns: ['id','session_id','source','make','model','color','body_type','confidence_make','confidence_model','confidence_color','observed_at','camera_event_id','decision','updated_at'],
    display: ['make','model','color','source','decision','observed_at']
  },
  ad_trigger_logs: {
    label: 'Ad trigger logs', view: 'public_dashboard_ad_trigger_logs', order: 'created_at.desc',
    columns: ['id','session_id','platform','player_id','trigger_id','campaign_name','trigger_reason','status','latency_ms','created_at','camera_event_id','campaign_id'],
    display: ['campaign_name','platform','player_id','status','latency_ms','created_at']
  },
  proof_of_play: {
    label: 'Proof of play', view: 'public_dashboard_proof_of_play', order: 'played_at.desc', maxRows: 1000,
    columns: ['id','session_id','campaign_id','player_id','played_at','duration_seconds','impressions','measurement_type'],
    display: ['campaign_id','player_id','played_at','duration_seconds','impressions','measurement_type']
  },
  station_connectors: {
    label: 'Station connectors', view: 'public_dashboard_station_connectors', order: 'station_sn.asc',
    columns: ['station_sn','connector_id','site_name','connector_name','controller_id','camera_id','player_id','active'],
    display: ['site_name','station_sn','connector_name','connector_id','active']
  }
};

const state = {
  data: Object.fromEntries(Object.keys(DATASETS).map(name => [name, []])),
  errors: {}, selectedDataset: 'charging_sessions', partial: {}, connected: false
};
const $ = selector => document.querySelector(selector);
const formatNumber = (value, digits = 0) => new Intl.NumberFormat('en-US', {maximumFractionDigits: digits}).format(Number(value) || 0);
const escapeHtml = value => String(value ?? '—').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label = value => String(value).replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
const dateValue = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 0 : date.getTime(); };
const formatDate = value => value && dateValue(value) ? new Date(value).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const empty = message => `<div class="empty">${escapeHtml(message)}</div>`;

function showMessage(message, tone = 'notice') {
  const element = $('#dataMessage');
  element.textContent = message;
  element.dataset.tone = tone;
  element.hidden = false;
}

function config() {
  const value = window.PUBLIC_DASHBOARD_CONFIG || {};
  return {
    url: String(value.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''),
    key: String(value.SUPABASE_ANON_KEY || '').trim()
  };
}

async function fetchDataset(connection, name, spec) {
  const pageSize = 1000;
  const maxRows = spec.maxRows || 5000;
  const rows = [];
  const headers = {apikey: connection.key};
  if (connection.key.startsWith('eyJ')) headers.Authorization = `Bearer ${connection.key}`;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const params = new URLSearchParams({select: spec.columns.join(','), order: spec.order, limit: String(pageSize), offset: String(offset)});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${connection.url}/rest/v1/${spec.view}?${params}`, {headers, signal: controller.signal});
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(`${spec.label}: ${detail.message || `HTTP ${response.status}`}`);
      }
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error(`${spec.label}: unexpected response`);
      rows.push(...page);
      if (page.length < pageSize) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {name, rows, partial: rows.length === maxRows};
}

function scopeToBarth() {
  state.data.charging_sessions = state.data.charging_sessions.filter(row => row.station_sn === BARTH_STATION_SN);
  state.data.station_connectors = state.data.station_connectors.filter(row => row.station_sn === BARTH_STATION_SN);
  const barthSessionIds = new Set(state.data.charging_sessions.map(row => row.id));
  const barthCameraEventIds = new Set();
  state.data.camera_events = state.data.camera_events.filter(row => {
    const keep = barthSessionIds.has(row.session_id);
    if (keep) barthCameraEventIds.add(row.id);
    return keep;
  });
  ['vehicle_observations', 'ad_trigger_logs'].forEach(name => {
    state.data[name] = state.data[name].filter(row =>
      barthSessionIds.has(row.session_id) || (row.camera_event_id && barthCameraEventIds.has(row.camera_event_id))
    );
  });
  // proof_of_play has no session_id populated at the source, so it can't be joined to a
  // session or station yet. Barth is currently the only live station, so leaving this
  // dataset unfiltered is correct today. Revisit once a second station exists.
}

async function loadData() {
  const connection = config();
  if (!connection.url || !connection.key) {
    showMessage('Live data is not configured yet. Set the public project URL and publishable key in config.js to connect this dashboard.');
    $('#statusText').textContent = 'Configuration needed';
    $('#footerStatus').textContent = 'Live data not connected';
    render();
    return;
  }
  $('#statusText').textContent = 'Loading data';
  const entries = Object.entries(DATASETS);
  const results = await Promise.allSettled(entries.map(([name, spec]) => fetchDataset(connection, name, spec)));
  state.errors = {};
  results.forEach((result, index) => {
    const name = entries[index][0];
    if (result.status === 'fulfilled') {
      state.data[name] = result.value.rows;
      state.partial[name] = result.value.partial;
    } else {
      state.errors[name] = result.reason?.message || 'Request failed';
    }
  });
  scopeToBarth();
  state.connected = Object.keys(state.errors).length < entries.length;
  $('#statusText').textContent = state.connected ? 'Live network data' : 'Connection unavailable';
  $('#statusDot').classList.toggle('is-live', state.connected);
  $('#updatedAt').textContent = state.connected ? `Updated ${formatDate(new Date())}` : 'Waiting for data';
  $('#footerStatus').textContent = state.connected ? `Updated ${formatDate(new Date())}` : 'Live data unavailable';
  if (Object.keys(state.errors).length) {
    showMessage(`Some datasets could not load: ${Object.values(state.errors).join(' · ')}`, 'error');
  } else if (Object.values(state.partial).some(Boolean)) {
    showMessage('Some datasets have more than 5,000 rows. Figures on this page use the most recent 5,000 rows per dataset.');
  } else {
    $('#dataMessage').hidden = true;
  }
  render();
}

function withinPeriod(row, field, days) {
  return days === 'all' || (dateValue(row[field]) > 0 && dateValue(row[field]) >= Date.now() - Number(days) * 86400000);
}

function filtered(name, field) {
  const days = $('#periodFilter').value;
  return state.data[name].filter(row => !field || withinPeriod(row, field, days));
}

function list(items, toMarkup, emptyMessage) {
  return items.length ? items.slice(0, 5).map(toMarkup).join('') : empty(emptyMessage);
}

function renderBarList(element, pairs, suffix = '', limit = 6) {
  const top = pairs.sort((a, b) => b[1] - a[1]).slice(0, limit);
  const max = Math.max(1, ...top.map(pair => pair[1]));
  element.innerHTML = top.length ? top.map(([name, value]) => `<div class="bar-row"><div class="bar-row-top"><span>${escapeHtml(name)}</span><strong>${formatNumber(value, 1)}${suffix}</strong></div><div class="bar-track"><span style="width:${Math.max(2, value / max * 100)}%"></span></div></div>`).join('') : empty('No records for this selection.');
}

function renderChart(sessions) {
  const days = Array.from({length: 14}, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 13 + index);
    return date;
  });
  const counts = days.map(day => sessions.filter(row => new Date(row.created_at).toDateString() === day.toDateString()).length);
  const max = Math.max(1, ...counts);
  $('#sessionChart').innerHTML = `<div class="chart-bars">${counts.map((count, index) => `<div class="chart-column" title="${escapeHtml(days[index].toDateString())}: ${count} sessions"><span style="height:${Math.max(3, count / max * 100)}%"></span></div>`).join('')}</div><div class="chart-axis"><span>${days[0].toLocaleDateString('en-GB', {day:'2-digit',month:'short'})}</span><span>${days[6].toLocaleDateString('en-GB', {day:'2-digit',month:'short'})}</span><span>${days[13].toLocaleDateString('en-GB', {day:'2-digit',month:'short'})}</span></div>`;
}

function renderOverview() {
  const sessions = filtered('charging_sessions', 'created_at');
  const plays = filtered('proof_of_play', 'played_at');
  const triggers = filtered('ad_trigger_logs', 'created_at');
  const recognized = sessions.filter(row => row.resolved_brand);
  $('#metricSessions').textContent = formatNumber(sessions.length);
  $('#metricRecognized').textContent = formatNumber(recognized.length);
  $('#metricTriggered').textContent = formatNumber(triggers.length);
  $('#metricPlayback').textContent = formatNumber(plays.length);
  $('#outcomeList').innerHTML = [
    ['Vehicles reached', sessions.length],
    ['Automatically recognized', recognized.length],
    ['Ads triggered', triggers.length],
    ['Verified plays', plays.length]
  ].map(([name, count]) => `<div class="outcome"><span>${escapeHtml(name)}</span><strong>${formatNumber(count)}</strong></div>`).join('');
  renderChart(sessions);
}

function renderVehicles() {
  const observations = filtered('vehicle_observations', 'observed_at');
  const makes = new Map();
  observations.forEach(row => makes.set(row.make || 'Unidentified', (makes.get(row.make || 'Unidentified') || 0) + 1));
  renderBarList($('#vehicleChart'), [...makes]);
  $('#vehicleCount').textContent = `${formatNumber(observations.length)} recognized`;
  $('#cameraEvents').innerHTML = list(observations, row => `<div class="compact-row"><div class="compact-symbol camera-symbol">◎</div><div class="compact-main"><strong>${escapeHtml([row.make, row.model].filter(Boolean).join(' ') || 'Vehicle recognized')}</strong><span>${escapeHtml(row.color || row.source || 'Recognized')} · ${formatDate(row.observed_at)}</span></div><span class="status-chip">${escapeHtml(row.source === 'evccid_prefix' ? 'Unique identifier' : 'AI vision')}</span></div>`, 'No vehicles recognized for this selection.');
}

function renderMedia() {
  const triggers = filtered('ad_trigger_logs', 'created_at');
  const plays = filtered('proof_of_play', 'played_at');
  const successful = triggers.filter(row => ['success', 'delivered', 'completed', 'published', 'executed'].includes(String(row.status).toLowerCase())).length;
  $('#mediaTriggers').textContent = formatNumber(triggers.length);
  $('#mediaSuccess').textContent = formatNumber(successful);
  $('#mediaPlays').textContent = formatNumber(plays.length);
  $('#triggerList').innerHTML = list(triggers, row => `<div class="compact-row"><div class="compact-symbol media-symbol">✦</div><div class="compact-main"><strong>${escapeHtml(row.campaign_name || row.campaign_id || 'Campaign')}</strong><span>${escapeHtml(row.platform || 'Media platform')} · ${formatDate(row.created_at)}</span></div><span class="status-chip">${escapeHtml(row.status || 'Recorded')}</span></div>`, 'No ad triggers for this selection.');
  $('#playList').innerHTML = list(plays, row => `<div class="compact-row"><div class="compact-symbol media-symbol">▶</div><div class="compact-main"><strong>${escapeHtml(row.campaign_id || 'Campaign')}</strong><span>${escapeHtml(row.player_id || 'Player')} · ${formatDate(row.played_at)}</span></div><b>${formatNumber(row.duration_seconds, 0)}s</b></div>`, 'No confirmed playback for this selection.');
}

function renderInsights() {
  const sessions = filtered('charging_sessions', 'created_at');
  const brands = new Map();
  sessions.forEach(row => {
    const brand = row.resolved_brand || 'Unidentified';
    brands.set(brand, (brands.get(brand) || 0) + 1);
  });
  renderBarList($('#insightBrandChart'), [...brands], '', 20);
  $('#insightBrandCount').textContent = `${formatNumber(brands.size)} brands`;

  const hashVisits = new Map();
  sessions.forEach(row => {
    if (!row.evccid_hash) return;
    if (!hashVisits.has(row.evccid_hash)) hashVisits.set(row.evccid_hash, []);
    hashVisits.get(row.evccid_hash).push(row);
  });
  const uniqueVehicles = hashVisits.size;
  const repeatVehicles = [...hashVisits.values()].filter(visits => visits.length > 1);
  const repeatRate = uniqueVehicles ? Math.round((repeatVehicles.length / uniqueVehicles) * 100) : 0;
  $('#insightUnique').textContent = formatNumber(uniqueVehicles);
  $('#insightRepeat').textContent = formatNumber(repeatVehicles.length);
  $('#insightRepeatRate').textContent = uniqueVehicles ? `${repeatRate}%` : '—';

  const ranked = repeatVehicles.sort((a, b) => b.length - a.length).slice(0, 5);
  $('#insightRepeatList').innerHTML = ranked.length ? ranked.map((visits, index) => {
    const latest = visits.reduce((best, row) => dateValue(row.created_at) > dateValue(best.created_at) ? row : best, visits[0]);
    const brand = visits.find(row => row.resolved_brand)?.resolved_brand;
    return `<div class="compact-row"><div class="compact-symbol media-symbol">↻</div><div class="compact-main"><strong>Returning vehicle #${index + 1}${brand ? ` · ${escapeHtml(brand)}` : ''}</strong><span>${visits.length} visits · last seen ${formatDate(latest.created_at)}</span></div></div>`;
  }).join('') : empty('No repeat visits yet for this selection.');
}

function render() {
  renderOverview();
  renderVehicles();
  renderMedia();
  renderInsights();
}

$('#periodFilter').addEventListener('change', render);
const nav = [...document.querySelectorAll('[data-nav]')];
function markNavigation() {
  const section = (location.hash || '#overview').slice(1);
  nav.forEach(link => link.classList.toggle('active', link.dataset.nav === section));
}
window.addEventListener('hashchange', markNavigation);
markNavigation();
render();
loadData();
