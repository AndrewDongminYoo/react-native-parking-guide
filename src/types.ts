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

export interface RuleResult {
  id: RuleId;
  verdict: Verdict;
  confidence: number;
  message: string;
  evidence?: {
    bbox?: number[];
    maskUri?: string;
  };
  score?: number;
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

export interface ParkingPolicyRule {
  enabled: boolean;
  weight?: number;
  severity?: Exclude<Verdict, 'PASS'>;
  failBelow?: number;
}

export interface ParkingPolicy {
  version: number;
  rules: Partial<Record<RuleId, ParkingPolicyRule>>;
  passThreshold: number;
}
