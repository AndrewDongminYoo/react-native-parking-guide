/**
 * Rentable shared personal mobility vehicle types. Cars are out of scope.
 *
 * - `bicycle`: shared bicycle without electric assist.
 * - `ebike`: shared electric-assist bicycle.
 * - `kickboard`: shared kickboard, including electric kickboards (e-scooters).
 * - `motorcycle`: shared motorcycle or moped.
 * - `auto`: the caller does not specify a vehicle type; it is to be detected automatically.
 *   `auto` does not mean automobile.
 */
export type VehicleType =
  'bicycle' | 'kickboard' | 'ebike' | 'motorcycle' | 'auto';

export type Verdict = 'PASS' | 'WARN' | 'FAIL';

export type RuleId =
  | 'VEHICLE_DETECTED'
  | 'UPRIGHT'
  | 'TACTILE_PAVING'
  | 'CROSSWALK'
  | 'ROADWAY'
  | 'SIDEWALK_BLOCK'
  | 'PARKING_ZONE'
  | 'GEOFENCE'
  | 'IMAGE_QUALITY';

export type GuidanceIssue =
  | 'NO_VEHICLE'
  | 'TOO_CLOSE'
  | 'TOO_FAR'
  | 'TILTED'
  | 'BLURRY'
  | 'LOW_LIGHT'
  | 'GROUND_NOT_VISIBLE';

export interface GuidanceState {
  ready: boolean;
  issues: GuidanceIssue[];
  progress: number;
}

/**
 * Image-space nearness of the selected vehicle to the nearest accepted zone instance of a rule's class.
 * `distance` is the gap between the two boxes divided by the longer side of the vehicle box (`0` when they touch or
 * overlap); `near` is `distance <= MappingOptions.proximityThreshold`. It does not affect the rule score or verdict.
 */
export interface ZoneProximity {
  distance: number;
  near: boolean;
}

export interface RuleResult {
  id: RuleId;
  verdict: Verdict;
  confidence: number;
  score?: number;
  message?: string;
  evidence?: {
    bbox?: number[];
    maskUri?: string;
    /** Set by `mapModelOutput` for `TACTILE_PAVING` and `CROSSWALK` only. */
    proximity?: ZoneProximity;
  };
}

export interface VerificationResult {
  verdict: Verdict;
  score: number;
  rules: RuleResult[];
  photo: {
    uri: string;
    width: number;
    height: number;
    sha256: string;
  };
  metadata: {
    capturedAt: string;
    location?: {
      lat: number;
      lng: number;
      accuracy: number;
    };
    heading?: number;
    deviceTilt: {
      pitch: number;
      roll: number;
    };
    modelVersion: string;
    platform: 'ios' | 'android';
    attestation?: string;
  };
}

export interface RulePolicy {
  enabled: boolean;
  weight?: number;
  severity?: Verdict;
  failBelow?: number;
}

export interface ParkingPolicy {
  version: number;
  rules: Partial<Record<RuleId, RulePolicy>>;
  passThreshold: number;
}
