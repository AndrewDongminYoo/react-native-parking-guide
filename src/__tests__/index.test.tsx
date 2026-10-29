import { describe, expect, it } from '@jest/globals';

import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type { ParkingPolicy, RuleResult } from '../types';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach((item) => deepFreeze(item));
  }

  return value;
}

describe('evaluatePolicy', () => {
  it('returns PASS when weighted score is above threshold', () => {
    const rules: RuleResult[] = [
      { id: 'VEHICLE_DETECTED', verdict: 'PASS', confidence: 0.99 },
      { id: 'UPRIGHT', verdict: 'PASS', confidence: 0.92 },
      { id: 'IMAGE_QUALITY', verdict: 'WARN', confidence: 0.85, score: 0.8 },
    ];

    const result = evaluatePolicy(rules, defaultPolicy);

    expect(result.verdict).toBe('PASS');
    expect(result.score).toBeGreaterThanOrEqual(defaultPolicy.passThreshold);
  });

  it('returns FAIL when enabled FAIL severity rule fails', () => {
    const rules: RuleResult[] = [
      { id: 'VEHICLE_DETECTED', verdict: 'FAIL', confidence: 0.2 },
      { id: 'UPRIGHT', verdict: 'PASS', confidence: 0.95 },
    ];

    const result = evaluatePolicy(rules, defaultPolicy);

    expect(result.verdict).toBe('FAIL');
  });

  it('returns WARN when score is below threshold without hard fail', () => {
    const policy: ParkingPolicy = {
      version: 1,
      passThreshold: 0.9,
      rules: {
        SIDEWALK_BLOCK: {
          enabled: true,
          weight: 1,
          severity: 'WARN',
          failBelow: 0.7,
        },
        IMAGE_QUALITY: {
          enabled: true,
          weight: 1,
          severity: 'WARN',
          failBelow: 0.7,
        },
      },
    };

    const rules: RuleResult[] = [
      { id: 'SIDEWALK_BLOCK', verdict: 'WARN', confidence: 0.8 },
      { id: 'IMAGE_QUALITY', verdict: 'WARN', confidence: 0.8 },
    ];

    const result = evaluatePolicy(rules, policy);

    expect(result.verdict).toBe('WARN');
    expect(result.score).toBeLessThan(policy.passThreshold);
  });

  it('uses failBelow for FAIL severity even if verdict is WARN', () => {
    const policy: ParkingPolicy = {
      version: 1,
      passThreshold: 0.7,
      rules: {
        GEOFENCE: {
          enabled: true,
          weight: 1,
          severity: 'FAIL',
          failBelow: 0.95,
        },
      },
    };

    const rules: RuleResult[] = [
      { id: 'GEOFENCE', verdict: 'WARN', confidence: 0.9, score: 0.7 },
    ];

    const result = evaluatePolicy(rules, policy);

    expect(result.verdict).toBe('FAIL');
  });

  it.each([
    {
      name: 'a rule without a policy entry',
      rules: [{ id: 'VEHICLE_DETECTED', verdict: 'FAIL', confidence: 1 }],
      policy: {
        version: 1,
        passThreshold: 0.8,
        rules: {},
      },
    },
    {
      name: 'a disabled rule',
      rules: [{ id: 'VEHICLE_DETECTED', verdict: 'FAIL', confidence: 1 }],
      policy: {
        version: 1,
        passThreshold: 0.8,
        rules: {
          VEHICLE_DETECTED: {
            enabled: false,
            weight: 1,
            severity: 'FAIL',
          },
        },
      },
    },
  ] satisfies Array<{
    name: string;
    rules: RuleResult[];
    policy: ParkingPolicy;
  }>)('ignores $name', ({ rules, policy }) => {
    const result = evaluatePolicy(rules, policy);

    expect(result).toEqual({ verdict: 'PASS', score: 1 });
  });

  it.each([
    { verdict: 'PASS', score: 1 },
    { verdict: 'WARN', score: 0.5 },
    { verdict: 'FAIL', score: 0 },
  ] as const)(
    'uses the default score $score for verdict $verdict',
    ({ verdict, score }) => {
      const result = evaluatePolicy(
        [{ id: 'UPRIGHT', verdict, confidence: 1 }],
        {
          version: 1,
          passThreshold: 0.75,
          rules: {
            UPRIGHT: { enabled: true, severity: 'WARN' },
          },
        },
      );

      expect(result.score).toBe(score);
    },
  );

  it.each([
    { score: -0.25, expected: 0 },
    { score: 1.25, expected: 1 },
  ])('clamps score $score to $expected', ({ score, expected }) => {
    const result = evaluatePolicy(
      [{ id: 'UPRIGHT', verdict: 'WARN', confidence: 1, score }],
      {
        version: 1,
        passThreshold: 0.8,
        rules: {
          UPRIGHT: { enabled: true, severity: 'WARN' },
        },
      },
    );

    expect(result.score).toBe(expected);
  });

  it('uses the verdict default when an explicit score is NaN', () => {
    const result = evaluatePolicy(
      [{ id: 'UPRIGHT', verdict: 'WARN', confidence: 1, score: Number.NaN }],
      {
        version: 1,
        passThreshold: 0.8,
        rules: {
          UPRIGHT: { enabled: true, severity: 'WARN' },
        },
      },
    );

    expect(result).toEqual({ verdict: 'WARN', score: 0.5 });
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it('calculates a weighted mean', () => {
    const result = evaluatePolicy(
      [
        { id: 'UPRIGHT', verdict: 'PASS', confidence: 1 },
        { id: 'GEOFENCE', verdict: 'FAIL', confidence: 1 },
      ],
      {
        version: 1,
        passThreshold: 0.8,
        rules: {
          UPRIGHT: { enabled: true, severity: 'WARN', weight: 3 },
          GEOFENCE: { enabled: true, severity: 'WARN', weight: 1 },
        },
      },
    );

    expect(result).toEqual({ verdict: 'WARN', score: 0.75 });
  });

  it('returns a score of 1 when the sum of enabled rule weights is zero', () => {
    const result = evaluatePolicy(
      [{ id: 'UPRIGHT', verdict: 'FAIL', confidence: 1 }],
      {
        version: 1,
        passThreshold: 0.8,
        rules: {
          UPRIGHT: { enabled: true, severity: 'WARN', weight: 0 },
        },
      },
    );

    expect(result).toEqual({ verdict: 'PASS', score: 1 });
  });

  it('returns PASS when the score equals the pass threshold', () => {
    const result = evaluatePolicy(
      [{ id: 'UPRIGHT', verdict: 'WARN', confidence: 1, score: 0.75 }],
      {
        version: 1,
        passThreshold: 0.75,
        rules: {
          UPRIGHT: { enabled: true, severity: 'WARN' },
        },
      },
    );

    expect(result).toEqual({ verdict: 'PASS', score: 0.75 });
  });

  it('does not mutate deeply frozen inputs', () => {
    const rules: RuleResult[] = deepFreeze([
      { id: 'UPRIGHT', verdict: 'PASS', confidence: 1 },
    ]);
    const policy: ParkingPolicy = deepFreeze({
      version: 1,
      passThreshold: 0.8,
      rules: {
        UPRIGHT: { enabled: true, severity: 'WARN', weight: 1 },
      },
    });

    expect(evaluatePolicy(rules, policy)).toEqual({
      verdict: 'PASS',
      score: 1,
    });
    expect(Object.isFrozen(rules[0])).toBe(true);
    expect(Object.isFrozen(policy.rules.UPRIGHT)).toBe(true);
  });
});
