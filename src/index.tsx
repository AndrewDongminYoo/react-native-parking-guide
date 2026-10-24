import ParkingGuide from './NativeParkingGuide';

export { defaultPolicy } from './policy/defaultPolicy';
export { evaluatePolicy } from './policy/evaluate';
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
