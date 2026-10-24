import ParkingGuide from './NativeParkingGuide';

export { useParkingGuidance } from './guidance/useParkingGuidance';
export type { ParkingGuidance } from './guidance/useParkingGuidance';
export {
  CAPTURE_GUIDANCE_THRESHOLDS,
  createParkingFrameAnalyzer,
} from './guidance/frameAnalyzer';
export type { ParkingFrameAnalyzer } from './guidance/frameAnalyzer';
export { createGuidanceState, reduceGuidance } from './guidance/reducer';
export type {
  GuidanceFrameResult,
  GuidanceOptions,
  GuidanceReducerState,
} from './guidance/reducer';
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
} from './types';

export function getModelVersion(): string {
  return ParkingGuide.getModelVersion();
}
