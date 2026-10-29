import type { ParkingPolicy, RuleId, RulePolicy, Verdict } from '../types';

export type PolicyValidationResult = ParkingPolicy | string[];

const RULE_IDS: readonly RuleId[] = [
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

const VERDICTS: readonly Verdict[] = ['PASS', 'WARN', 'FAIL'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNumberInRange(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function validatePolicy(input: unknown): PolicyValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return ['Policy must be an object.'];
  }

  if (!hasOwn(input, 'version')) {
    errors.push('version is required.');
  } else if (
    typeof input.version !== 'number' ||
    !Number.isFinite(input.version)
  ) {
    errors.push('version must be a finite number.');
  }

  if (
    !hasOwn(input, 'passThreshold') ||
    !isNumberInRange(input.passThreshold)
  ) {
    errors.push('passThreshold must be a finite number between 0 and 1.');
  }

  if (!hasOwn(input, 'rules') || !isRecord(input.rules)) {
    errors.push('rules must be an object.');
  }

  const rules: Partial<Record<RuleId, RulePolicy>> = {};

  if (isRecord(input.rules)) {
    for (const [id, value] of Object.entries(input.rules)) {
      if (!RULE_IDS.includes(id as RuleId)) {
        errors.push(`rules.${id} is not a recognized RuleId.`);
        continue;
      }

      if (!isRecord(value)) {
        errors.push(`rules.${id} must be an object.`);
        continue;
      }

      const rule: RulePolicy = { enabled: false };

      if (!hasOwn(value, 'enabled') || typeof value.enabled !== 'boolean') {
        errors.push(`rules.${id}.enabled must be a boolean.`);
      } else {
        rule.enabled = value.enabled;
      }

      if (hasOwn(value, 'weight')) {
        if (
          typeof value.weight !== 'number' ||
          !Number.isFinite(value.weight) ||
          value.weight < 0
        ) {
          errors.push(
            `rules.${id}.weight must be a finite non-negative number.`,
          );
        } else {
          rule.weight = value.weight;
        }
      }

      if (hasOwn(value, 'severity')) {
        if (!VERDICTS.includes(value.severity as Verdict)) {
          errors.push(`rules.${id}.severity must be PASS, WARN, or FAIL.`);
        } else {
          rule.severity = value.severity as Verdict;
        }
      }

      if (hasOwn(value, 'failBelow')) {
        if (!isNumberInRange(value.failBelow)) {
          errors.push(
            `rules.${id}.failBelow must be a finite number between 0 and 1.`,
          );
        } else {
          rule.failBelow = value.failBelow;
        }
      }

      rules[id as RuleId] = rule;
    }
  }

  if (errors.length > 0) {
    return errors;
  }

  return {
    version: input.version as number,
    passThreshold: input.passThreshold as number,
    rules,
  };
}
