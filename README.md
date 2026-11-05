# advercharge public dashboard

Public pilot dashboard for the Barth charging station, showing charging activity,
vehicle recognition, advertising decisions, and confirmed playback.

**Live site:** https://pilot.advercharge.eu/

## Run locally

This is a static HTML/CSS/JavaScript site. No build or dependency installation is required.
Serve the repository over HTTP: opening `index.html` directly with `file://` blocks
the JavaScript module imports in browsers.

With Python 3 installed, run this from the repository directory:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173/. Keep the server running while using the dashboard;
press Ctrl+C to stop it. The local site reads live Supabase data.

## Supabase connection

`config.js` defines `window.PUBLIC_DASHBOARD_CONFIG` with:

- `SUPABASE_URL`: the project's public URL; an optional `/rest/v1/` suffix is accepted.
- `SUPABASE_ANON_KEY`: the public publishable or legacy anon key.

Everything in this file is visible to visitors. Never put a service-role key,
database password, or other private credential in the frontend.

The browser reads the existing `public_dashboard_*` views for charging sessions,
camera events, vehicle observations, advertising logs, station connectors, and
proof of play. The views must allow the configured public key to read their
intended public columns. Do not expose raw payloads or private identifiers to
make the dashboard work.

The dashboard scopes records to Barth station `2251110030800001`. Non-playback
datasets load up to 5,000 recent rows each; a notice appears when that limit is
reached. The `public_dashboard_barth_daily_plays` view exposes playback totals
for Barth by Berlin calendar day over the most recent 14 days. The dashboard
sums the selected days and lists up to five recent daily totals.

## Vehicle recognition

`recognition.mjs` builds one vehicle record per charging session, using:

1. The session's resolved vehicle brand and identity source.
2. Its EVCCID lookup brand when a resolved brand is missing.
3. The latest usable, non-rejected vision observation linked to the session or
   one of its camera events.

Repeated camera frames and provider attempts do not count as additional arrivals.
Unknown brands remain unidentified and do not increase the recognized count.
The overview, vehicle mix, recognition feed, and insights use this shared result.
The feed distinguishes unique identifiers, AI vision, and saved vehicle profiles.
The `get_barth_repeat_visit_totals` RPC groups sessions by EVCCID hash inside
Supabase. Its public response contains only counts of unique and returning
vehicles and three visit-frequency buckets. The repeat rate is the share of
tracked vehicles that visited more than once during the selected Berlin
calendar dates. Vehicle hashes and individual visit histories stay private.

Date filters use the session arrival time (`created_at`, with charging start
times as fallbacks), so a later recognition does not move an arrival to another
period. Custom date boundaries use Europe/Berlin time, including daylight-saving
changes. The charging activity chart always spans the last 14 days.

## English and German

The header's **DE / EN** toggle translates the page copy, filters, live labels,
empty states, dates, and number formatting. Brand names and identifiers stay
unchanged. Switching languages preserves the current date selection and does
not refetch data.

English is the default. The selected language is saved in browser local storage
under `advercharge-language`. Switching still works if storage is unavailable.
Local and public origins store their preferences separately.

Translations and locale helpers are in `i18n.mjs`. Mark static translated text
with `data-i18n`, accessible labels with `data-i18n-aria`, and translated metadata
with `data-i18n-content`. Add the corresponding English-to-German entry to the
dictionary. Use `t()` for dynamically rendered messages.

## Tests

Use Node.js with its built-in test runner; no test packages are required:

```sh
node --test tests/recognition.test.mjs tests/i18n.test.mjs
```

Tests cover recognition sources and precedence, duplicate camera observations,
date ranges, translation coverage, language persistence, blocked browser storage,
and preservation of live counts and filters when switching languages.

## Deployment

Netlify publishes the static repository from `main` to the live site. Pushes to
`main` trigger deployment. After publishing, verify that the live page loads its
Supabase data, both languages work, and the 7-day and 30-day views show the expected
recognition counts. Source changes are visible locally after a browser refresh.
