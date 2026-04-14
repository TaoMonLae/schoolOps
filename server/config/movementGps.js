function parseRequiredNumber(name, errors) {
  const raw = process.env[name];
  if (raw == null || raw.toString().trim() === '') {
    errors.push(`${name} environment variable is required`);
    return null;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${name} must be a valid number`);
    return null;
  }
  return value;
}

function assertRange(name, value, min, max, errors) {
  if (value == null) return;
  if (value < min || value > max) {
    errors.push(`${name} must be between ${min} and ${max}`);
  }
}

function resolveMovementGpsConfig() {
  const errors = [];
  const SCHOOL_LAT = parseRequiredNumber('SCHOOL_LAT', errors);
  const SCHOOL_LNG = parseRequiredNumber('SCHOOL_LNG', errors);
  const SCHOOL_GEOFENCE_RADIUS_M = parseRequiredNumber('SCHOOL_GEOFENCE_RADIUS_M', errors);
  const MAX_LOCATION_ACCURACY_M = parseRequiredNumber('MAX_LOCATION_ACCURACY_M', errors);

  assertRange('SCHOOL_LAT', SCHOOL_LAT, -90, 90, errors);
  assertRange('SCHOOL_LNG', SCHOOL_LNG, -180, 180, errors);
  if (SCHOOL_GEOFENCE_RADIUS_M != null && SCHOOL_GEOFENCE_RADIUS_M <= 0) {
    errors.push('SCHOOL_GEOFENCE_RADIUS_M must be greater than 0');
  }
  if (MAX_LOCATION_ACCURACY_M != null && MAX_LOCATION_ACCURACY_M <= 0) {
    errors.push('MAX_LOCATION_ACCURACY_M must be greater than 0');
  }

  return {
    enabled: errors.length === 0,
    errors,
    SCHOOL_LAT,
    SCHOOL_LNG,
    SCHOOL_GEOFENCE_RADIUS_M,
    MAX_LOCATION_ACCURACY_M,
  };
}

function getMovementGpsConfig() {
  return resolveMovementGpsConfig();
}

module.exports = { getMovementGpsConfig };
