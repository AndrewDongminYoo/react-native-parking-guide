import { describe, expect, it } from '@jest/globals';

import { GUIDANCE_ISSUE_MESSAGES } from '../../example/src/guidanceMessages';

describe('example capture guidance messages', () => {
  it('provides a readable message for every guidance issue', () => {
    expect(Object.values(GUIDANCE_ISSUE_MESSAGES)).toEqual(
      expect.arrayContaining([
        'Move the vehicle into the frame.',
        'Move farther away from the vehicle.',
        'Move closer to the vehicle.',
        'Hold the camera level.',
        'Hold the camera steady.',
        'Move to a brighter area.',
        'Include the ground around the vehicle.',
      ])
    );
    expect(Object.values(GUIDANCE_ISSUE_MESSAGES)).toHaveLength(7);
  });
});
