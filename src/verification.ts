import { Platform } from 'react-native';

import ParkingGuide from './NativeParkingGuide';
import type { GeoLocation } from './geofence/geofence';
import { defaultPolicy } from './policy/defaultPolicy';
import { evaluatePolicy } from './policy/evaluate';
import { validatePolicy } from './policy/validate';
import type {
  ParkingPolicy,
  RuleResult,
  VerificationResult,
  Verdict,
} from './types';

export interface VerifyParkingOptions {
  /** The captured photo. `uri` is an absolute path or a `file:///` URI (Android also accepts `content://`). */
  readonly photo: {
    readonly uri: string;
    /** Pixel width; an integer > 0. */
    readonly width: number;
    /** Pixel height; an integer > 0. */
    readonly height: number;
  };
  /** Rule results for this photo, for example from `mapModelOutput` and `evaluateGeofence`. */
  readonly ruleResults: readonly RuleResult[];
  /** Must pass `validatePolicy`. Default: `defaultPolicy`. */
  readonly policy?: ParkingPolicy;
  /** Device pitch and roll in radians at capture time; each finite and in [-π, π]. */
  readonly deviceTilt: { readonly pitch: number; readonly roll: number };
  /** Degrees clockwise from true north; finite and in [0, 360). Omitted from the result when absent. */
  readonly heading?: number;
  /** Rider location; included in the result only when passed (explicit opt-in). Same ranges as `evaluateGeofence`. */
  readonly location?: GeoLocation;
  /** Capture time. Default: the time `verifyParking` is called. */
  readonly capturedAt?: Date;
  /** Device attestation token, copied as-is. Omitted from the result when absent. */
  readonly attestation?: string;
}

const VERDICTS: readonly unknown[] = [
  'PASS',
  'WARN',
  'FAIL',
] satisfies Verdict[];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function validateOptions(options: VerifyParkingOptions): ParkingPolicy {
  if (!isRecord(options)) {
    throw new RangeError('verifyParking options must be an object.');
  }
  const { photo, ruleResults, deviceTilt, heading, location, capturedAt } =
    options;
  if (
    !isRecord(photo) ||
    typeof photo.uri !== 'string' ||
    photo.uri.length === 0 ||
    !isPositiveInteger(photo.width) ||
    !isPositiveInteger(photo.height)
  ) {
    throw new RangeError(
      'photo must have a non-empty uri and integer width and height > 0.'
    );
  }
  if (
    !Array.isArray(ruleResults) ||
    // Array.from turns holes into undefined; every() would skip them.
    !Array.from(ruleResults).every(
      (rule: unknown) => isRecord(rule) && VERDICTS.includes(rule.verdict)
    )
  ) {
    throw new RangeError(
      'ruleResults must be an array of rule results with a PASS, WARN, or FAIL verdict.'
    );
  }
  const policy = validatePolicy(options.policy ?? defaultPolicy);
  if (Array.isArray(policy)) {
    throw new RangeError(`Invalid policy: ${policy.join(' ')}`);
  }
  if (
    !isRecord(deviceTilt) ||
    !isFiniteInRange(deviceTilt.pitch, -Math.PI, Math.PI) ||
    !isFiniteInRange(deviceTilt.roll, -Math.PI, Math.PI)
  ) {
    throw new RangeError(
      'deviceTilt pitch and roll must be finite radians in [-π, π].'
    );
  }
  if (
    heading !== undefined &&
    (!isFiniteInRange(heading, 0, 360) || heading === 360)
  ) {
    throw new RangeError('heading must be finite degrees in [0, 360).');
  }
  if (
    location !== undefined &&
    (!isRecord(location) ||
      !isFiniteInRange(location.lat, -90, 90) ||
      !isFiniteInRange(location.lng, -180, 180) ||
      !isFiniteInRange(location.accuracy, 0, Infinity))
  ) {
    throw new RangeError(
      'location must have lat in [-90, 90], lng in [-180, 180], and a finite accuracy >= 0.'
    );
  }
  if (
    capturedAt !== undefined &&
    (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.getTime()))
  ) {
    throw new RangeError('capturedAt must be a valid Date.');
  }
  if (
    options.attestation !== undefined &&
    typeof options.attestation !== 'string'
  ) {
    throw new RangeError('attestation must be a string.');
  }
  return policy;
}

/**
 * Hashes the photo on the native side and assembles a `VerificationResult` with the verdict and score from
 * `evaluatePolicy`. Rejects with `RangeError` for invalid options before reading the photo. Logs nothing.
 */
export async function verifyParking(
  options: VerifyParkingOptions
): Promise<VerificationResult> {
  const calledAt = Date.now();
  const policy = validateOptions(options);
  const platform = Platform.OS;
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error('verifyParking supports only iOS and Android.');
  }
  const { photo, ruleResults, deviceTilt, heading, location, attestation } =
    options;
  const capturedAt = options.capturedAt?.getTime() ?? calledAt;
  // Copy everything before the await: the caller can mutate its objects while the hash is pending.
  // shortcut: `evidence` stays shared with the caller; evaluatePolicy does not read it. Deep-copy it if it ever does.
  const rules = ruleResults.map((rule) => ({ ...rule }));
  const evaluation = evaluatePolicy(rules, policy);
  const { uri, width, height } = photo;
  const result = {
    ...evaluation,
    rules,
    metadata: {
      capturedAt: new Date(capturedAt).toISOString(),
      ...(location === undefined
        ? {}
        : {
            location: {
              lat: location.lat,
              lng: location.lng,
              accuracy: location.accuracy,
            },
          }),
      ...(heading === undefined ? {} : { heading }),
      deviceTilt: { pitch: deviceTilt.pitch, roll: deviceTilt.roll },
      modelVersion: ParkingGuide.getModelVersion(),
      platform,
      ...(attestation === undefined ? {} : { attestation }),
    },
  };
  const sha256 = await ParkingGuide.getFileSha256(uri);
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    throw new Error('getFileSha256 returned an invalid SHA-256 digest.');
  }

  return { ...result, photo: { uri, width, height, sha256 } };
}
