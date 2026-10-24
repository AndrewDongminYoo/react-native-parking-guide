import type {
  GuidanceIssue,
  ParkingPolicy,
  RuleId,
  RuleResult,
  Verdict,
} from '../types';
import { isHardFail } from '../policy/evaluate';

export type FeedbackVerdict = Exclude<Verdict, 'PASS'>;
/**
 * `FAIL` or `WARN` is the effective verdict. `UNCHECKED` marks a raw `WARN` result with `confidence` 0, which
 * `mapModelOutput` emits when it could not evaluate the rule.
 */
export type RuleFeedbackStatus = FeedbackVerdict | 'UNCHECKED';
export type RuleFeedbackKey = `rule.${RuleId}.${RuleFeedbackStatus}`;
export type GuidanceFeedbackKey = `guidance.${GuidanceIssue}`;
/** Stable message key. The host app localizes by key; keys do not change when default text changes. */
export type FeedbackKey = RuleFeedbackKey | GuidanceFeedbackKey;

export type ParkingFeedback =
  | {
      kind: 'rule';
      key: RuleFeedbackKey;
      ruleId: RuleId;
      /** Effective verdict after policy escalation (see `FeedbackOptions.policy`). */
      verdict: FeedbackVerdict;
      /** Default English text from `DEFAULT_FEEDBACK_TEXT`. */
      text: string;
    }
  | {
      kind: 'guidance';
      key: GuidanceFeedbackKey;
      issue: GuidanceIssue;
      /** Default English text from `DEFAULT_FEEDBACK_TEXT`. */
      text: string;
    };

/** A `VerificationResult` is assignable to this type. */
export interface FeedbackInput {
  readonly rules: readonly RuleResult[];
  readonly issues?: readonly GuidanceIssue[];
}

export interface FeedbackOptions {
  /**
   * When set, rule results that `evaluatePolicy` ignores (no entry or `enabled: false`) produce no feedback, and a
   * result that alone makes `evaluatePolicy` return `FAIL` has the effective verdict `FAIL`.
   */
  readonly policy?: ParkingPolicy;
}

export const DEFAULT_FEEDBACK_TEXT: Readonly<Record<FeedbackKey, string>> =
  Object.freeze({
    'rule.VEHICLE_DETECTED.FAIL':
      'No vehicle found in the photo. Retake it with the whole vehicle in the frame.',
    'rule.VEHICLE_DETECTED.WARN':
      'The vehicle is hard to recognize. Retake the photo with the whole vehicle in the frame.',
    'rule.VEHICLE_DETECTED.UNCHECKED':
      'Could not check for a vehicle. Retake the photo with the whole vehicle in the frame.',
    'rule.UPRIGHT.FAIL':
      'The vehicle has fallen over. Stand it upright on its kickstand.',
    'rule.UPRIGHT.WARN':
      'The vehicle may not be upright. Make sure it stands on its kickstand.',
    'rule.UPRIGHT.UNCHECKED':
      'Could not check whether the vehicle is upright. Retake the photo with the whole vehicle in the frame.',
    'rule.TACTILE_PAVING.FAIL':
      'The vehicle is on tactile paving for visually impaired pedestrians. Move it off the paving.',
    'rule.TACTILE_PAVING.WARN':
      'The vehicle may be on tactile paving. Make sure it is clear of the paving.',
    'rule.TACTILE_PAVING.UNCHECKED':
      'Could not check for tactile paving. Retake the photo with the ground around the vehicle in the frame.',
    'rule.CROSSWALK.FAIL':
      'The vehicle is on a crosswalk. Move it off the crosswalk.',
    'rule.CROSSWALK.WARN':
      'The vehicle may be on a crosswalk. Make sure it is clear of the crosswalk.',
    'rule.CROSSWALK.UNCHECKED':
      'Could not check for a crosswalk. Retake the photo with the ground around the vehicle in the frame.',
    'rule.ROADWAY.FAIL': 'The vehicle is on the road. Move it off the road.',
    'rule.ROADWAY.WARN':
      'The vehicle may be on the road. Make sure it is off the road.',
    'rule.ROADWAY.UNCHECKED':
      'Could not check whether the vehicle is on the road. Retake the photo with the ground around the vehicle in the frame.',
    'rule.SIDEWALK_BLOCK.FAIL':
      'The vehicle blocks the sidewalk. Move it to the edge so people can pass.',
    'rule.SIDEWALK_BLOCK.WARN':
      'The vehicle may block the sidewalk. Make sure people can pass.',
    'rule.SIDEWALK_BLOCK.UNCHECKED':
      'Could not check whether the vehicle blocks the sidewalk. Retake the photo with the ground around the vehicle in the frame.',
    'rule.PARKING_ZONE.FAIL':
      'The vehicle is outside the parking zone. Move it inside the marked zone.',
    'rule.PARKING_ZONE.WARN':
      'The vehicle may be outside the parking zone. Make sure it is fully inside the marked zone.',
    'rule.PARKING_ZONE.UNCHECKED':
      'Could not check the parking zone. Retake the photo with the ground around the vehicle in the frame.',
    'rule.GEOFENCE.FAIL':
      'Parking is not allowed here. Move the vehicle to an allowed parking area.',
    'rule.GEOFENCE.WARN':
      'Parking may not be allowed here. Check the map for allowed parking areas.',
    'rule.GEOFENCE.UNCHECKED':
      'Could not check the parking location. Make sure location access is on and try again.',
    'rule.IMAGE_QUALITY.FAIL':
      'The photo is too unclear to check. Retake it in better light and hold the phone steady.',
    'rule.IMAGE_QUALITY.WARN':
      'The photo may be too unclear to check. Retake it in better light and hold the phone steady.',
    'rule.IMAGE_QUALITY.UNCHECKED':
      'Could not check the photo quality. Retake the photo.',
    'guidance.NO_VEHICLE': 'Point the camera at the vehicle.',
    'guidance.TOO_CLOSE': 'Move back so the whole vehicle fits in the frame.',
    'guidance.TOO_FAR': 'Move closer to the vehicle.',
    'guidance.TILTED': 'Hold the phone upright and straight.',
    'guidance.BLURRY': 'Hold the phone steady.',
    'guidance.LOW_LIGHT': 'It is too dark. Move to a brighter spot.',
    'guidance.GROUND_NOT_VISIBLE':
      'Show the ground under the vehicle in the frame.',
  });

const RULE_ORDER: readonly RuleId[] = [
  'VEHICLE_DETECTED',
  'UPRIGHT',
  'TACTILE_PAVING',
  'CROSSWALK',
  'ROADWAY',
  'SIDEWALK_BLOCK',
  'PARKING_ZONE',
  'GEOFENCE',
  'IMAGE_QUALITY',
];

const GUIDANCE_ORDER: readonly GuidanceIssue[] = [
  'NO_VEHICLE',
  'TOO_CLOSE',
  'TOO_FAR',
  'TILTED',
  'BLURRY',
  'LOW_LIGHT',
  'GROUND_NOT_VISIBLE',
];

const VEHICLE_DEPENDENT_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'UPRIGHT',
  'TACTILE_PAVING',
  'CROSSWALK',
  'ROADWAY',
  'SIDEWALK_BLOCK',
  'PARKING_ZONE',
]);

interface RuleStatus {
  verdict: FeedbackVerdict;
  status: RuleFeedbackStatus;
}

const STATUS_RANK: Readonly<Record<RuleFeedbackStatus, number>> = {
  FAIL: 0,
  WARN: 1,
  UNCHECKED: 2,
};

/** FAIL before WARN; within a verdict, FAIL copy before WARN copy before UNCHECKED copy. */
function rank(entry: RuleStatus): number {
  return (entry.verdict === 'FAIL' ? 0 : 3) + STATUS_RANK[entry.status];
}

/** The copy follows the result's own verdict, so policy escalation never overstates certainty. */
function feedbackStatus(result: RuleResult): RuleFeedbackStatus {
  if (result.verdict === 'FAIL') {
    return 'FAIL';
  }
  return result.verdict === 'WARN' && result.confidence === 0
    ? 'UNCHECKED'
    : 'WARN';
}

/**
 * Pure, deterministic conversion of rule results and guidance issues into ordered rider-facing feedback.
 * See the README section "Rider feedback" for the selection and ordering rules.
 */
export function getParkingFeedback(
  input: FeedbackInput,
  options: FeedbackOptions = {}
): ParkingFeedback[] {
  const statuses = new Map<RuleId, RuleStatus>();
  let vehicleMissing = false;
  for (const result of input.rules) {
    if (!RULE_ORDER.includes(result.id)) {
      continue;
    }
    const rulePolicy = options.policy?.rules[result.id];
    if (options.policy && !rulePolicy?.enabled) {
      continue;
    }
    if (result.id === 'VEHICLE_DETECTED' && result.verdict === 'FAIL') {
      vehicleMissing = true;
    }
    let verdict: FeedbackVerdict | undefined =
      result.verdict === 'FAIL' || result.verdict === 'WARN'
        ? result.verdict
        : undefined;
    if (rulePolicy && isHardFail(result, rulePolicy)) {
      verdict = 'FAIL';
    }
    if (!verdict) {
      continue;
    }
    const entry: RuleStatus = { verdict, status: feedbackStatus(result) };
    const previous = statuses.get(result.id);
    if (!previous || rank(entry) < rank(previous)) {
      statuses.set(result.id, entry);
    }
  }
  if (vehicleMissing) {
    for (const ruleId of VEHICLE_DEPENDENT_RULES) {
      statuses.delete(ruleId);
    }
  }

  const feedback: ParkingFeedback[] = [];
  for (const verdict of ['FAIL', 'WARN'] as const) {
    for (const ruleId of RULE_ORDER) {
      const entry = statuses.get(ruleId);
      if (entry?.verdict === verdict) {
        const key: RuleFeedbackKey = `rule.${ruleId}.${entry.status}`;
        feedback.push({
          kind: 'rule',
          key,
          ruleId,
          verdict,
          text: DEFAULT_FEEDBACK_TEXT[key],
        });
      }
    }
  }
  const issues = new Set(input.issues);
  for (const issue of GUIDANCE_ORDER) {
    if (issues.has(issue)) {
      const key: GuidanceFeedbackKey = `guidance.${issue}`;
      feedback.push({
        kind: 'guidance',
        key,
        issue,
        text: DEFAULT_FEEDBACK_TEXT[key],
      });
    }
  }
  return feedback;
}
