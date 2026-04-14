function parseRequiredNumber(name) {
  const raw = process.env[name];
  if (raw == null || raw.toString().trim() === '') {
    throw new Error(`${name} environment variable is required`);
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid number`);
  }
  return value;
}

function assertRange(name, value, min, max) {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
}

const SCHOOL_LAT = parseRequiredNumber('SCHOOL_LAT');
const SCHOOL_LNG = parseRequiredNumber('SCHOOL_LNG');
const SCHOOL_GEOFENCE_RADIUS_M = parseRequiredNumber('SCHOOL_GEOFENCE_RADIUS_M');
const MAX_LOCATION_ACCURACY_M = parseRequiredNumber('MAX_LOCATION_ACCURACY_M');

assertRange('SCHOOL_LAT', SCHOOL_LAT, -90, 90);
assertRange('SCHOOL_LNG', SCHOOL_LNG, -180, 180);
if (SCHOOL_GEOFENCE_RADIUS_M <= 0) {
  throw new Error('SCHOOL_GEOFENCE_RADIUS_M must be greater than 0');
}
if (MAX_LOCATION_ACCURACY_M <= 0) {
  throw new Error('MAX_LOCATION_ACCURACY_M must be greater than 0');
}

module.exports = {
  SCHOOL_LAT,
  SCHOOL_LNG,
  SCHOOL_GEOFENCE_RADIUS_M,
  MAX_LOCATION_ACCURACY_M,
};
