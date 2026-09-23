# Advercharge Public Dashboard

A separate, responsive public site for six Advercharge datasets. It does not reuse the operations dashboard or request all columns from the database.

## Included datasets

- `charging_sessions`
- `camera_events`
- `vehicle_observations`
- `ad_trigger_logs`
- `proof_of_play`
- `station_connectors`

The browser requests only explicit columns from six `public_dashboard_*` views. The charging view excludes `evccid_raw`, `evccid_clean`, `evccid_prefix`, and `id_tag`. The camera view excludes `storage_object_path`, `drive_file_id`, and `drive_web_url`. It also excludes `image_path` and unstructured JSON fields because they could indirectly contain unblurred-photo links or other private payloads.

## Setup

1. Apply the existing Supabase migrations through `20260824193500_repair_stage3_runtime_schema.sql` if they are not already applied.
2. Review and run `supabase_public_views.sql` in your Supabase SQL editor. It creates the six public views used by this site.
3. Put the public Supabase URL and publishable/anon key in `config.js`. Never use a `service_role` key.
4. In this folder, start a local server with `python -m http.server 4174`, then open `http://127.0.0.1:4174`.

Without a configured URL/key, the site displays empty states and a configuration message. It does not invent production metrics.

## Public access check

The views control what **this dashboard** fetches. They do not by themselves stop someone from calling an accessible base table directly with the same anon key. Before publishing, check the six source tables for anonymous table privileges and RLS policies, and remove anonymous access to private columns. The existing operations dashboard reads base tables as anon and may need authentication before those grants can be removed.

For example, test a direct REST request for `charging_sessions?select=evccid_raw` and `camera_events?select=drive_web_url` using the publishable key. Both should fail. The public view requests should succeed.

The page loads up to 5,000 recent rows per dataset. A visible notice appears if this cap is reached; figures then describe the loaded slice.
