const { getMovementGpsConfig } = require('../config/movementGps');

function toFiniteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationPayload(payload = {}) {
  const lat = toFiniteNumber(payload.latitude ?? payload.lat);
  const lng = toFiniteNumber(payload.longitude ?? payload.lng);
  const accuracy = toFiniteNumber(payload.accuracy);

  if (lat == null || lng == null || accuracy == null) {
    return { ok: false, error: 'Location payload must include latitude, longitude, and accuracy' };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'Invalid latitude or longitude values' };
  }

  if (accuracy < 0) {
    return { ok: false, error: 'Location accuracy must be zero or greater' };
  }

  return { ok: true, location: { lat, lng, accuracy } };
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function evaluateLocationAgainstSchool(location) {
  const config = getMovementGpsConfig();
  if (!config.enabled) {
    return {
      configError: true,
      error: `Movement GPS is not configured: ${config.errors.join('; ')}`,
    };
  }

  const {
    SCHOOL_LAT,
    SCHOOL_LNG,
    SCHOOL_GEOFENCE_RADIUS_M,
    MAX_LOCATION_ACCURACY_M,
  } = config;
  const distanceMeters = haversineDistanceMeters(location.lat, location.lng, SCHOOL_LAT, SCHOOL_LNG);
  const accuracyAcceptable = location.accuracy <= MAX_LOCATION_ACCURACY_M;
  const insideGeofence = distanceMeters <= SCHOOL_GEOFENCE_RADIUS_M;

  return {
    distanceMeters: Math.round(distanceMeters * 100) / 100,
    insideGeofence,
    accuracyAcceptable,
    maxAccuracyMeters: MAX_LOCATION_ACCURACY_M,
    geofenceRadiusMeters: SCHOOL_GEOFENCE_RADIUS_M,
  };
}

module.exports = {
  parseLocationPayload,
  haversineDistanceMeters,
  evaluateLocationAgainstSchool,
  getMovementGpsConfig,
};
