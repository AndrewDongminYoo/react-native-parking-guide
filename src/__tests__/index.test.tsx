import { describe, expect, it } from '@jest/globals';

import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type { ParkingPolicy, RuleResult } from '../types';

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
});
