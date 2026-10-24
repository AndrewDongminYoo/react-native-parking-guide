import { describe, expect, it } from '@jest/globals';

import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type { RuleResult } from '../types';

const baseRules: RuleResult[] = [
  {
    id: 'VEHICLE_DETECTED',
    verdict: 'PASS',
    confidence: 0.99,
    message: 'vehicle detected',
    score: 1,
  },
  {
    id: 'UPRIGHT',
    verdict: 'PASS',
    confidence: 0.97,
    message: 'upright',
    score: 1,
  },
  {
    id: 'TACTILE_PAVING',
    verdict: 'PASS',
    confidence: 0.98,
    message: 'not on tactile paving',
    score: 1,
  },
  {
    id: 'CROSSWALK',
    verdict: 'PASS',
    confidence: 0.95,
    message: 'not in crosswalk',
    score: 1,
  },
  {
    id: 'ROADWAY',
    verdict: 'PASS',
    confidence: 0.95,
    message: 'not in roadway',
    score: 1,
  },
  {
    id: 'SIDEWALK_BLOCK',
    verdict: 'PASS',
    confidence: 0.9,
    message: 'sidewalk clear',
    score: 1,
  },
  {
    id: 'PARKING_ZONE',
    verdict: 'PASS',
    confidence: 0.88,
    message: 'parking zone ok',
    score: 1,
  },
  {
    id: 'GEOFENCE',
    verdict: 'PASS',
    confidence: 0.91,
    message: 'in geofence',
    score: 1,
  },
  {
    id: 'IMAGE_QUALITY',
    verdict: 'PASS',
    confidence: 0.92,
    message: 'good quality',
    score: 1,
  },
];

describe('evaluatePolicy', () => {
  it('returns PASS when all enabled rules pass and score is above threshold', () => {
    const result = evaluatePolicy(baseRules, defaultPolicy);

    expect(result.verdict).toBe('PASS');
    expect(result.score).toBe(1);
  });

  it('returns FAIL on hard-fail rule failure regardless of weighted average', () => {
    const rules = baseRules.map((rule) =>
      rule.id === 'CROSSWALK'
        ? { ...rule, verdict: 'FAIL' as const, score: 0, confidence: 0.99 }
        : rule
    );

    const result = evaluatePolicy(rules, defaultPolicy);

    expect(result.verdict).toBe('FAIL');
    expect(result.score).toBeLessThan(1);
  });

  it('returns WARN when score is below passThreshold without hard-fail violation', () => {
    const rules = baseRules.map((rule) =>
      rule.id === 'IMAGE_QUALITY' ||
      rule.id === 'PARKING_ZONE' ||
      rule.id === 'SIDEWALK_BLOCK'
        ? { ...rule, verdict: 'WARN' as const, score: 0 }
        : rule
    );

    const result = evaluatePolicy(rules, defaultPolicy);

    expect(result.verdict).toBe('WARN');
    expect(result.score).toBeLessThan(defaultPolicy.passThreshold);
  });
});
