import { describe, expect, it } from '@jest/globals';

import { defaultPolicy } from '../policy/defaultPolicy';
import { validatePolicy } from '../policy/validate';

describe('validatePolicy', () => {
  it('returns a typed policy when the input is valid', () => {
    expect(validatePolicy(defaultPolicy)).toEqual(defaultPolicy);
  });

  it('rejects inputs that are not policy objects', () => {
    expect(validatePolicy(null)).toEqual(['Policy must be an object.']);
  });

  it('requires a version', () => {
    expect(
      validatePolicy({
        passThreshold: 0.75,
        rules: {},
      })
    ).toEqual(expect.arrayContaining(['version is required.']));
  });

  it.each([-0.1, 1.1, Number.NaN])(
    'rejects passThreshold value %s outside [0, 1]',
    (passThreshold) => {
      expect(validatePolicy({ version: 1, passThreshold, rules: {} })).toEqual(
        expect.arrayContaining([
          'passThreshold must be a finite number between 0 and 1.',
        ])
      );
    }
  );

  it('rejects unknown rule IDs', () => {
    expect(
      validatePolicy({
        version: 1,
        passThreshold: 0.75,
        rules: {
          UNKNOWN: { enabled: true },
        },
      })
    ).toEqual(
      expect.arrayContaining(['rules.UNKNOWN is not a recognized RuleId.'])
    );
  });

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects weight value %s when it is negative or non-finite',
    (weight) => {
      expect(
        validatePolicy({
          version: 1,
          passThreshold: 0.75,
          rules: { UPRIGHT: { enabled: true, weight } },
        })
      ).toEqual(
        expect.arrayContaining([
          'rules.UPRIGHT.weight must be a finite non-negative number.',
        ])
      );
    }
  );

  it.each([-0.1, 1.1, Number.NaN])(
    'rejects failBelow value %s outside [0, 1]',
    (failBelow) => {
      expect(
        validatePolicy({
          version: 1,
          passThreshold: 0.75,
          rules: { UPRIGHT: { enabled: true, failBelow } },
        })
      ).toEqual(
        expect.arrayContaining([
          'rules.UPRIGHT.failBelow must be a finite number between 0 and 1.',
        ])
      );
    }
  );
});
