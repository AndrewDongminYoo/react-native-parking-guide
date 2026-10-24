import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_FEEDBACK_TEXT,
  getParkingFeedback,
} from '../feedback/feedback';
import type { FeedbackKey } from '../feedback/feedback';
import { mapModelOutput } from '../inference/mapping';
import type { RawModelOutput } from '../inference/mapping';
import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type {
  GuidanceIssue,
  ParkingPolicy,
  RuleId,
  RuleResult,
  VerificationResult,
} from '../types';

const RULE_IDS = [
  'VEHICLE_DETECTED',
  'UPRIGHT',
  'TACTILE_PAVING',
  'CROSSWALK',
  'ROADWAY',
  'SIDEWALK_BLOCK',
  'PARKING_ZONE',
  'GEOFENCE',
  'IMAGE_QUALITY',
] as const satisfies readonly RuleId[];
const GUIDANCE_ISSUES = [
  'NO_VEHICLE',
  'TOO_CLOSE',
  'TOO_FAR',
  'TILTED',
  'BLURRY',
  'LOW_LIGHT',
  'GROUND_NOT_VISIBLE',
] as const satisfies readonly GuidanceIssue[];

// Compile-time proof that the lists above are exhaustive.
const allRules: Exclude<RuleId, (typeof RULE_IDS)[number]> extends never
  ? true
  : false = true;
const allIssues: Exclude<
  GuidanceIssue,
  (typeof GUIDANCE_ISSUES)[number]
> extends never
  ? true
  : false = true;

function rule(
  id: RuleId,
  verdict: RuleResult['verdict'],
  extra: Partial<RuleResult> = {}
): RuleResult {
  return { id, verdict, confidence: 0.9, ...extra };
}

function keys(
  input: Parameters<typeof getParkingFeedback>[0],
  policy?: ParkingPolicy
) {
  return getParkingFeedback(input, policy ? { policy } : {}).map(
    (entry) => entry.key
  );
}

describe('getParkingFeedback', () => {
  it('has a key and non-empty default text for every RuleId status and GuidanceIssue', () => {
    expect(allRules && allIssues).toBe(true);
    const expected: string[] = [
      ...RULE_IDS.flatMap((id) => [
        `rule.${id}.FAIL`,
        `rule.${id}.WARN`,
        `rule.${id}.UNCHECKED`,
      ]),
      ...GUIDANCE_ISSUES.map((issue) => `guidance.${issue}`),
    ];
    expect(Object.keys(DEFAULT_FEEDBACK_TEXT).sort()).toEqual(expected.sort());
    for (const key of expected) {
      expect(DEFAULT_FEEDBACK_TEXT[key as FeedbackKey].trim()).not.toBe('');
    }
    expect(Object.isFrozen(DEFAULT_FEEDBACK_TEXT)).toBe(true);
  });

  it('returns no entry for passing rules and no issues', () => {
    expect(
      getParkingFeedback({ rules: RULE_IDS.map((id) => rule(id, 'PASS')) })
    ).toEqual([]);
  });

  it('returns a rule entry with key, verdict, and default text', () => {
    expect(getParkingFeedback({ rules: [rule('CROSSWALK', 'FAIL')] })).toEqual([
      {
        kind: 'rule',
        key: 'rule.CROSSWALK.FAIL',
        ruleId: 'CROSSWALK',
        verdict: 'FAIL',
        text: DEFAULT_FEEDBACK_TEXT['rule.CROSSWALK.FAIL'],
      },
    ]);
  });

  it('orders FAIL before WARN, by RuleId order, then guidance issues', () => {
    const feedback = getParkingFeedback({
      rules: [
        rule('IMAGE_QUALITY', 'WARN'),
        rule('PARKING_ZONE', 'FAIL'),
        rule('UPRIGHT', 'WARN'),
        rule('CROSSWALK', 'FAIL'),
        rule('ROADWAY', 'PASS'),
      ],
      issues: ['GROUND_NOT_VISIBLE', 'NO_VEHICLE'],
    });
    expect(feedback.map((entry) => entry.key)).toEqual([
      'rule.CROSSWALK.FAIL',
      'rule.PARKING_ZONE.FAIL',
      'rule.UPRIGHT.WARN',
      'rule.IMAGE_QUALITY.WARN',
      'guidance.NO_VEHICLE',
      'guidance.GROUND_NOT_VISIBLE',
    ]);
    expect(feedback[4]).toEqual({
      kind: 'guidance',
      key: 'guidance.NO_VEHICLE',
      issue: 'NO_VEHICLE',
      text: DEFAULT_FEEDBACK_TEXT['guidance.NO_VEHICLE'],
    });
  });

  it('keeps one entry per rule and issue, preferring FAIL over WARN', () => {
    const feedback = getParkingFeedback({
      rules: [
        rule('ROADWAY', 'WARN'),
        rule('ROADWAY', 'FAIL'),
        rule('ROADWAY', 'WARN'),
        rule('UPRIGHT', 'WARN'),
        rule('UPRIGHT', 'WARN'),
      ],
      issues: ['TILTED', 'TILTED'],
    });
    expect(feedback.map((entry) => entry.key)).toEqual([
      'rule.ROADWAY.FAIL',
      'rule.UPRIGHT.WARN',
      'guidance.TILTED',
    ]);
  });

  it('accepts a VerificationResult', () => {
    const result: VerificationResult = {
      verdict: 'FAIL',
      score: 0,
      rules: [rule('TACTILE_PAVING', 'FAIL')],
      photo: { uri: 'file:///photo.jpg', width: 1, height: 1, sha256: '0' },
      metadata: {
        capturedAt: '2026-01-01T00:00:00Z',
        deviceTilt: { pitch: 0, roll: 0 },
        modelVersion: '0.1.0-dev',
        platform: 'ios',
      },
    };
    expect(getParkingFeedback(result).map((entry) => entry.key)).toEqual([
      'rule.TACTILE_PAVING.FAIL',
    ]);
  });

  it('skips rules that evaluatePolicy ignores when a policy is given', () => {
    const policy: ParkingPolicy = {
      ...defaultPolicy,
      rules: {
        CROSSWALK: { enabled: true },
        ROADWAY: { enabled: false },
      },
    };
    const input = {
      rules: [
        rule('CROSSWALK', 'FAIL'),
        rule('ROADWAY', 'FAIL'),
        rule('GEOFENCE', 'FAIL'),
      ],
      issues: ['BLURRY'] as const,
    };
    expect(
      getParkingFeedback(input, { policy }).map((entry) => entry.key)
    ).toEqual(['rule.CROSSWALK.FAIL', 'guidance.BLURRY']);
    expect(getParkingFeedback(input).map((entry) => entry.key)).toEqual([
      'rule.CROSSWALK.FAIL',
      'rule.ROADWAY.FAIL',
      'rule.GEOFENCE.FAIL',
      'guidance.BLURRY',
    ]);
  });

  it('omits unknown rule ids, verdicts, and issues', () => {
    expect(
      getParkingFeedback({
        rules: [
          { id: 'UNKNOWN' as RuleId, verdict: 'FAIL', confidence: 1 },
          { id: 'UPRIGHT', verdict: 'BAD' as 'FAIL', confidence: 1 },
        ],
        issues: ['UNKNOWN' as GuidanceIssue],
      })
    ).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = Object.freeze({
      rules: Object.freeze([
        Object.freeze(rule('UPRIGHT', 'WARN')),
        Object.freeze(rule('CROSSWALK', 'FAIL')),
      ]),
      issues: Object.freeze(['TOO_FAR', 'NO_VEHICLE'] as GuidanceIssue[]),
    });
    expect(getParkingFeedback(input).map((entry) => entry.key)).toEqual([
      'rule.CROSSWALK.FAIL',
      'rule.UPRIGHT.WARN',
      'guidance.NO_VEHICLE',
      'guidance.TOO_FAR',
    ]);
  });
  it('uses the UNCHECKED key for a WARN result with confidence 0', () => {
    expect(
      getParkingFeedback({
        rules: [rule('UPRIGHT', 'WARN', { score: 0, confidence: 0 })],
      })
    ).toEqual([
      {
        kind: 'rule',
        key: 'rule.UPRIGHT.UNCHECKED',
        ruleId: 'UPRIGHT',
        verdict: 'WARN',
        text: DEFAULT_FEEDBACK_TEXT['rule.UPRIGHT.UNCHECKED'],
      },
    ]);
  });

  it('omits vehicle-dependent rules when VEHICLE_DETECTED fails', () => {
    expect(
      keys({
        rules: [
          rule('VEHICLE_DETECTED', 'FAIL'),
          rule('UPRIGHT', 'WARN'),
          rule('CROSSWALK', 'FAIL'),
          rule('PARKING_ZONE', 'WARN'),
          rule('GEOFENCE', 'FAIL'),
          rule('IMAGE_QUALITY', 'WARN'),
        ],
      })
    ).toEqual([
      'rule.VEHICLE_DETECTED.FAIL',
      'rule.GEOFENCE.FAIL',
      'rule.IMAGE_QUALITY.WARN',
    ]);
  });

  it('keeps vehicle-dependent rules when VEHICLE_DETECTED fails only by policy escalation', () => {
    // A low-confidence vehicle was found, so zone rules were evaluated against it.
    expect(
      keys(
        {
          rules: [
            rule('VEHICLE_DETECTED', 'WARN', { score: 0.55 }),
            rule('CROSSWALK', 'FAIL'),
          ],
        },
        defaultPolicy
      )
    ).toEqual(['rule.VEHICLE_DETECTED.WARN', 'rule.CROSSWALK.FAIL']);
  });

  it('reports only the missing vehicle for a mapped scene without a vehicle', () => {
    const rules = mapModelOutput({
      detections: [],
      imageQuality: { score: 0.9, confidence: 0.9 },
    });
    expect(keys({ rules }, defaultPolicy)).toEqual([
      'rule.VEHICLE_DETECTED.FAIL',
    ]);
  });

  it('escalates the verdict like evaluatePolicy but keeps the uncertain copy', () => {
    // UPRIGHT WARN score 0.6 is below defaultPolicy UPRIGHT.failBelow 0.7 with severity FAIL.
    const borderline = [rule('UPRIGHT', 'WARN', { score: 0.6 })];
    expect(evaluatePolicy(borderline, defaultPolicy).verdict).toBe('FAIL');
    expect(
      getParkingFeedback({ rules: borderline }, { policy: defaultPolicy })
    ).toEqual([
      {
        kind: 'rule',
        key: 'rule.UPRIGHT.WARN',
        ruleId: 'UPRIGHT',
        verdict: 'FAIL',
        text: DEFAULT_FEEDBACK_TEXT['rule.UPRIGHT.WARN'],
      },
    ]);
    expect(keys({ rules: borderline })).toEqual(['rule.UPRIGHT.WARN']);

    const passing = [rule('CROSSWALK', 'PASS', { score: 0.85 })];
    expect(evaluatePolicy(passing, defaultPolicy).verdict).toBe('FAIL');
    expect(keys({ rules: passing }, defaultPolicy)).toEqual([
      'rule.CROSSWALK.WARN',
    ]);
    expect(keys({ rules: passing })).toEqual([]);

    // severity WARN never escalates.
    expect(
      keys(
        { rules: [rule('SIDEWALK_BLOCK', 'WARN', { score: 0.1 })] },
        defaultPolicy
      )
    ).toEqual(['rule.SIDEWALK_BLOCK.WARN']);
  });

  it('keeps UNCHECKED for an escalated result with confidence 0', () => {
    const output: RawModelOutput = {
      detections: [
        { classId: 'vehicle', confidence: 0.95, box: [0.3, 0.3, 0.6, 0.6] },
        { classId: 'parking_zone', confidence: 0.95, box: [0, 0, 1, 1] },
      ],
      imageQuality: { score: 0.9, confidence: 0.9 },
    };
    const rules = mapModelOutput(output);
    expect(evaluatePolicy(rules, defaultPolicy).verdict).toBe('FAIL');
    const feedback = getParkingFeedback({ rules }, { policy: defaultPolicy });
    expect(feedback.map((entry) => entry.key)).toEqual([
      'rule.UPRIGHT.UNCHECKED',
    ]);
    expect(feedback[0]).toMatchObject({ verdict: 'FAIL' });
  });

  it('includes a FAIL entry whenever evaluatePolicy fails', () => {
    const cases: RuleResult[][] = [
      [rule('VEHICLE_DETECTED', 'WARN', { score: 0.55 })],
      [rule('ROADWAY', 'WARN', { score: 0.8 })],
      [rule('GEOFENCE', 'FAIL')],
      [rule('UPRIGHT', 'WARN', { score: 0, confidence: 0 })],
    ];
    for (const rules of cases) {
      expect(evaluatePolicy(rules, defaultPolicy).verdict).toBe('FAIL');
      expect(
        getParkingFeedback({ rules }, { policy: defaultPolicy }).some(
          (entry) => entry.kind === 'rule' && entry.verdict === 'FAIL'
        )
      ).toBe(true);
    }
  });

  it('prefers a FAIL result over an escalated WARN result for the same rule', () => {
    for (const rules of [
      [rule('UPRIGHT', 'WARN', { score: 0.6 }), rule('UPRIGHT', 'FAIL')],
      [rule('UPRIGHT', 'FAIL'), rule('UPRIGHT', 'WARN', { score: 0.6 })],
    ]) {
      expect(keys({ rules }, defaultPolicy)).toEqual(['rule.UPRIGHT.FAIL']);
    }
  });

  it('prefers a checked result over an UNCHECKED one with the same verdict', () => {
    expect(
      keys({
        rules: [
          rule('UPRIGHT', 'WARN', { confidence: 0 }),
          rule('UPRIGHT', 'WARN'),
        ],
      })
    ).toEqual(['rule.UPRIGHT.WARN']);
    expect(
      keys({
        rules: [
          rule('UPRIGHT', 'WARN'),
          rule('UPRIGHT', 'WARN', { confidence: 0 }),
        ],
      })
    ).toEqual(['rule.UPRIGHT.WARN']);
  });
});
