import type { ParkingPolicy } from '../types';

export const defaultPolicy: ParkingPolicy = {
  version: 1,
  passThreshold: 0.75,
  rules: {
    VEHICLE_DETECTED: {
      enabled: true,
      weight: 1.2,
      severity: 'FAIL',
      failBelow: 0.6,
    },
    UPRIGHT: { enabled: true, weight: 1.1, severity: 'FAIL', failBelow: 0.7 },
    TACTILE_PAVING: {
      enabled: true,
      weight: 1,
      severity: 'FAIL',
      failBelow: 0.9,
    },
    CROSSWALK: { enabled: true, weight: 1, severity: 'FAIL', failBelow: 0.9 },
    ROADWAY: { enabled: true, weight: 1, severity: 'FAIL', failBelow: 0.85 },
    SIDEWALK_BLOCK: {
      enabled: true,
      weight: 1,
      severity: 'WARN',
      failBelow: 0.8,
    },
    PARKING_ZONE: {
      enabled: true,
      weight: 0.8,
      severity: 'WARN',
      failBelow: 0.7,
    },
    // evaluateGeofence scores WARN (GPS accuracy covers a zone boundary) as 0.5, which must not hard-fail.
    GEOFENCE: { enabled: true, weight: 1, severity: 'FAIL', failBelow: 0.5 },
    IMAGE_QUALITY: {
      enabled: true,
      weight: 0.9,
      severity: 'WARN',
      failBelow: 0.6,
    },
  },
};
