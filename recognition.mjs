// One vehicle record per charging session. Provider attempts and camera frames
// must not count the same arrival more than once.
export function knownBrand(value) {
  const brand = String(value ?? '').trim();
  return /^(?:unknown|unidentified|none|null|n\/a|[-—])?$/i.test(brand) ? '' : brand;
}

export const sessionTime = row => row.created_at || row.evb_start_time || row.monta_start_time;
const time = value => Date.parse(value) || 0;

export function sourceLabel(source) {
  if (/evccid/i.test(source)) return 'Unique identifier';
  if (source === 'vehicle_profile') return 'Vehicle profile';
  if (/gemini|vision|plate_recognizer/i.test(source)) return 'AI vision';
  return 'Recognized';
}

export function recognitionRecords(sessions, observations = [], cameraEvents = []) {
  const cameraSessions = new Map(cameraEvents.map(row => [row.id, row.session_id]));
  const latestObservation = new Map();
  observations.forEach(row => {
    const sessionId = row.session_id || cameraSessions.get(row.camera_event_id);
    if (!sessionId || !knownBrand(row.make) || /reject/i.test(row.decision || '')) return;
    const previous = latestObservation.get(sessionId);
    if (!previous || time(row.observed_at) > time(previous.observed_at)) latestObservation.set(sessionId, row);
  });

  return sessions.map(session => {
    const observation = latestObservation.get(session.id);
    const resolved = knownBrand(session.resolved_brand);
    const lookup = knownBrand(session.lookup_brand);
    const brand = resolved || lookup || knownBrand(observation?.make);
    const source = resolved ? (session.identity_source || (lookup ? 'evccid_prefix' : observation?.source) || '')
      : lookup ? 'evccid_prefix' : observation?.source || '';
    return {
      ...session,
      brand,
      source,
      model: resolved ? session.resolved_model || '' : lookup ? '' : observation?.model || '',
      color: resolved ? session.resolved_color || '' : lookup ? '' : observation?.color || '',
      // Filter by the arrival, even when recognition completes on a later day.
      arrived_at: sessionTime(session),
      recognized_at: (resolved && session.identity_updated_at) || (!resolved && !lookup && observation?.observed_at) || sessionTime(session)
    };
  });
}
