import ParkingGuide from './NativeParkingGuide';
import type { DetectorOutput } from './inference/detector';

export { useParkingGuidance } from './guidance/useParkingGuidance';
export type { ParkingGuidance } from './guidance/useParkingGuidance';
export {
  CAPTURE_GUIDANCE_THRESHOLDS,
  createParkingDetector,
  createParkingFrameAnalyzer,
} from './guidance/frameAnalyzer';
export type {
  ParkingDetector,
  ParkingFrameAnalyzer,
} from './guidance/frameAnalyzer';
export { createDetectorAsyncRunner } from './guidance/asyncRunner';
export type {
  DetectorAsyncRunner,
  DetectorRunnerWorklets,
} from './guidance/asyncRunner';
export {
  DEFAULT_DETECTION_STALE_MS,
  copyDetectorResult,
} from './guidance/detection';
export type {
  DetectionOptions,
  DetectorFrameResult,
} from './guidance/detection';
export { DEFAULT_AUTO_CAPTURE_HOLD_MS } from './guidance/autoCapture';
export { screenRectToFrameBox } from './guidance/screenRect';
export type { ScreenRect, Size } from './guidance/screenRect';
export {
  createGuidanceSession,
  reduceGuidanceSession,
} from './guidance/session';
export type {
  GuidanceSessionEvent,
  GuidanceSessionOptions,
  GuidanceSessionState,
} from './guidance/session';
export { createGuidanceState, reduceGuidance } from './guidance/reducer';
export type {
  GuidanceFrameResult,
  GuidanceOptions,
  GuidanceReducerState,
} from './guidance/reducer';
export { DEFAULT_FEEDBACK_TEXT, getParkingFeedback } from './feedback/feedback';
export type {
  FeedbackInput,
  FeedbackKey,
  FeedbackOptions,
  FeedbackVerdict,
  GuidanceFeedbackKey,
  ParkingFeedback,
  RuleFeedbackKey,
  RuleFeedbackStatus,
} from './feedback/feedback';
export {
  DEFAULT_GUIDANCE_THRESHOLDS,
  mapGuidanceIssues,
} from './inference/guidance';
export type {
  GuidanceMappingOptions,
  GuidanceThresholds,
} from './inference/guidance';
export { DETECTOR_CLASSES, decodeDetectorOutput } from './inference/detector';
export type { DetectorOutput } from './inference/detector';
export {
  DEFAULT_MAPPING_THRESHOLDS,
  DEFAULT_PROXIMITY_THRESHOLD,
  mapModelOutput,
} from './inference/mapping';
export type {
  InferenceRuleId,
  MappingOptions,
  MappingThresholds,
  ModelAssessment,
  ModelBox,
  ModelClass,
  ModelDetection,
  ModelMask,
  RawModelOutput,
} from './inference/mapping';
export {
  DEFAULT_MAX_GEOFENCE_ACCURACY,
  evaluateGeofence,
} from './geofence/geofence';
export type {
  GeoLocation,
  GeoPoint,
  GeofenceOptions,
  GeofenceZone,
  GeofenceZoneKind,
} from './geofence/geofence';
export {
  DEFAULT_UPLOAD_RETRIES,
  DEFAULT_UPLOAD_RETRY_DELAY_MS,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  uploadVerification,
} from './upload';
export type { UploadErrorKind, UploadOptions, UploadResult } from './upload';
export { verifyParking } from './verification';
export type { VerifyParkingOptions } from './verification';
export { defaultPolicy } from './policy/defaultPolicy';
export { evaluatePolicy } from './policy/evaluate';
export { validatePolicy } from './policy/validate';
export type { PolicyValidationResult } from './policy/validate';
export type {
  GuidanceIssue,
  GuidanceState,
  ParkingPolicy,
  RuleId,
  RulePolicy,
  RuleResult,
  VehicleType,
  VerificationResult,
  Verdict,
  ZoneProximity,
} from './types';

/**
 * Lowercase hexadecimal SHA-256 of the file at `uri`, computed off the JS thread. Accepts an absolute path, a
 * `file:///` URI (percent-decoded as UTF-8), and on Android also a `content://` URI. See the README section
 * "Photo verification" for the exact rule.
 */
export function getFileSha256(uri: string): Promise<string> {
  return ParkingGuide.getFileSha256(uri);
}

/**
 * Runs the host-supplied detector model at `modelUri` on the photo at `photoUri`, off the JS thread, and returns
 * its output tensors for `decodeDetectorOutput`. See the README section "Native detector inference".
 */
export function runDetector(
  photoUri: string,
  modelUri: string
): Promise<DetectorOutput> {
  return ParkingGuide.runDetector(photoUri, modelUri);
}
