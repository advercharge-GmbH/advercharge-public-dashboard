-- Apply after the existing Advercharge migrations.
-- These views expose only fields selected for the public dashboard.
-- Views use the database owner's permissions so anon can read the safe projection.
-- Review row-level public access before applying this to production.

create or replace view public.public_dashboard_charging_sessions
with (security_barrier = true) as
select
  id, transaction_id, status, station_sn, connector_id, site_id,
  lookup_brand, monta_start_time, monta_end_time, evb_start_time,
  evb_end_time, duration_seconds, energy_kwh, meter_start, meter_stop,
  camera_capture_status, gemini_status, campaign_status, created_at,
  updated_at, controller_id, resolved_brand, resolved_model, resolved_color,
  identity_source, identity_confidence, identity_updated_at, evccid_hash
from public.charging_sessions;

create or replace view public.public_dashboard_camera_events
with (security_barrier = true) as
select
  id, session_id, camera_id, controller_id, event_type,
  capture_time, status, zone_id, updated_at
from public.camera_events;

create or replace view public.public_dashboard_vehicle_observations
with (security_barrier = true) as
select
  id, session_id, source, make, model, color, body_type,
  confidence_make, confidence_model, confidence_color, observed_at,
  camera_event_id, decision, updated_at
from public.vehicle_observations;

create or replace view public.public_dashboard_ad_trigger_logs
with (security_barrier = true) as
select
  id, session_id, platform, player_id, trigger_id, campaign_name,
  trigger_reason, status, latency_ms, created_at, camera_event_id, campaign_id
from public.ad_trigger_logs;

create or replace view public.public_dashboard_proof_of_play
with (security_barrier = true) as
select
  id, session_id, campaign_id, player_id, played_at,
  duration_seconds, impressions, measurement_type
from public.proof_of_play;

create or replace view public.public_dashboard_station_connectors
with (security_barrier = true) as
select
  station_sn, connector_id, site_name, connector_name,
  controller_id, camera_id, player_id, active
from public.station_connectors;

revoke all on
  public.public_dashboard_charging_sessions,
  public.public_dashboard_camera_events,
  public.public_dashboard_vehicle_observations,
  public.public_dashboard_ad_trigger_logs,
  public.public_dashboard_proof_of_play,
  public.public_dashboard_station_connectors
from public, anon, authenticated;

grant select on
  public.public_dashboard_charging_sessions,
  public.public_dashboard_camera_events,
  public.public_dashboard_vehicle_observations,
  public.public_dashboard_ad_trigger_logs,
  public.public_dashboard_proof_of_play,
  public.public_dashboard_station_connectors
to anon;

-- A view does not remove direct access to its source table. Before publishing,
-- check and revoke any anon table-level SELECT grants or RLS policies on the
-- source tables that expose fields outside these views. This may affect the
-- existing operations dashboard, which currently reads base tables as anon.
