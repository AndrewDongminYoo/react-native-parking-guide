import type { ParkingPolicy } from '../types';

export const defaultPolicy: ParkingPolicy = {
  version: 1,
  passThreshold: 0.75,
  rules: {
    VEHICLE_DETECTED: {
      enabled: true,
      weight: 1.2,
      severity: 'FAIL',
      failBelow: 0.8,
    },
    UPRIGHT: { enabled: true, weight: 1.1, severity: 'FAIL', failBelow: 0.7 },
    TACTILE_PAVING: {
      enabled: true,
      weight: 1.4,
      severity: 'FAIL',
      failBelow: 1,
    },
    CROSSWALK: { enabled: true, weight: 1.3, severity: 'FAIL', failBelow: 1 },
    ROADWAY: { enabled: true, weight: 1.3, severity: 'FAIL', failBelow: 1 },
    SIDEWALK_BLOCK: {
      enabled: true,
      weight: 1.1,
      severity: 'WARN',
      failBelow: 0.5,
    },
    PARKING_ZONE: {
      enabled: true,
      weight: 0.9,
      severity: 'WARN',
      failBelow: 0.6,
    },
    GEOFENCE: { enabled: true, weight: 1.1, severity: 'FAIL', failBelow: 1 },
    IMAGE_QUALITY: {
      enabled: true,
      weight: 1.0,
      severity: 'WARN',
      failBelow: 0.6,
    },
  },
};
