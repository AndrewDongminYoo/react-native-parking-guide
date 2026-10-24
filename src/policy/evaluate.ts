import type { ParkingPolicy, RuleResult, Verdict } from '../types';

const VERDICT_SCORE: Record<Verdict, number> = {
  PASS: 1,
  WARN: 0.5,
  FAIL: 0,
};

const clamp01 = (value: number): number => {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const scoreFromResult = (result: RuleResult): number => {
  if (typeof result.score === 'number') {
    return clamp01(result.score);
  }

  return VERDICT_SCORE[result.verdict];
};

export function evaluatePolicy(
  ruleResults: RuleResult[],
  policy: ParkingPolicy
): { verdict: Verdict; score: number } {
  const resultById = new Map(ruleResults.map((rule) => [rule.id, rule]));

  let weightedScore = 0;
  let totalWeight = 0;
  let hasHardFail = false;

  for (const [ruleId, config] of Object.entries(policy.rules)) {
    if (!config?.enabled) {
      continue;
    }

    const result = resultById.get(ruleId as RuleResult['id']);
    if (!result) {
      continue;
    }

    const ruleScore = scoreFromResult(result);
    const weight = Math.max(0, config.weight ?? 1);

    weightedScore += ruleScore * weight;
    totalWeight += weight;

    if (config.severity === 'FAIL') {
      const failBelow = config.failBelow ?? 1;
      if (ruleScore < failBelow || result.verdict === 'FAIL') {
        hasHardFail = true;
      }
    }
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 0;
  if (hasHardFail) {
    return { verdict: 'FAIL', score };
  }

  return {
    verdict: score >= policy.passThreshold ? 'PASS' : 'WARN',
    score,
  };
}
