import type { ParkingPolicy, RulePolicy, RuleResult, Verdict } from '../types';

const DEFAULT_VERDICT_SCORES: Record<Verdict, number> = {
  PASS: 1,
  WARN: 0.5,
  FAIL: 0,
};

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

export function getRuleScore(rule: RuleResult): number {
  if (typeof rule.score === 'number' && !Number.isNaN(rule.score)) {
    return clamp01(rule.score);
  }

  return DEFAULT_VERDICT_SCORES[rule.verdict];
}

/** True when this rule alone makes `evaluatePolicy` return `FAIL`. Does not check `enabled`. */
export function isHardFail(
  result: RuleResult,
  rulePolicy: RulePolicy
): boolean {
  const score = getRuleScore(result);
  const failBelowTriggered =
    typeof rulePolicy.failBelow === 'number' && score < rulePolicy.failBelow;
  return (
    rulePolicy.severity === 'FAIL' &&
    (result.verdict === 'FAIL' || failBelowTriggered)
  );
}

export function evaluatePolicy(
  ruleResults: RuleResult[],
  policy: ParkingPolicy
): { verdict: Verdict; score: number } {
  let weightedScoreSum = 0;
  let weightSum = 0;
  let hasHardFail = false;

  for (const result of ruleResults) {
    const rulePolicy = policy.rules[result.id];

    if (!rulePolicy?.enabled) {
      continue;
    }

    const score = getRuleScore(result);
    const weight = rulePolicy.weight ?? 1;

    weightedScoreSum += score * weight;
    weightSum += weight;

    if (isHardFail(result, rulePolicy)) {
      hasHardFail = true;
    }
  }

  const normalizedScore =
    weightSum > 0 ? clamp01(weightedScoreSum / weightSum) : 1;

  if (hasHardFail) {
    return { verdict: 'FAIL', score: normalizedScore };
  }

  if (normalizedScore >= policy.passThreshold) {
    return { verdict: 'PASS', score: normalizedScore };
  }

  return { verdict: 'WARN', score: normalizedScore };
}
