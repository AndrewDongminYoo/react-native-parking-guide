import { describe, expect, it } from '@jest/globals';

import { defaultPolicy, evaluatePolicy } from '../index';

describe('public exports', () => {
  it('exports policy engine symbols', () => {
    expect(defaultPolicy.version).toBe(1);
    expect(typeof evaluatePolicy).toBe('function');
  });
});
