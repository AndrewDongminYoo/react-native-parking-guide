import { describe, expect, it } from '@jest/globals';

import {
  GUIDANCE_ANNOUNCEMENT_INTERVAL_MS,
  decideGuidanceAnnouncement,
} from '../announcements';

const READY = 'Ready. Take the photo.';
const STEADY = 'Hold the phone steady.';

describe('decideGuidanceAnnouncement', () => {
  it('waits 2 seconds between announcements by default', () => {
    expect(GUIDANCE_ANNOUNCEMENT_INTERVAL_MS).toBe(2000);
  });

  it('announces the first line', () => {
    expect(decideGuidanceAnnouncement(null, STEADY, 0)).toEqual({
      kind: 'announce',
    });
  });

  it('does not repeat the last announced line, however much time passed', () => {
    const last = { line: STEADY, at: 0 };
    expect(decideGuidanceAnnouncement(last, STEADY, 500)).toEqual({
      kind: 'skip',
    });
    expect(decideGuidanceAnnouncement(last, STEADY, 60_000)).toEqual({
      kind: 'skip',
    });
  });

  it('announces a changed line once the interval has passed', () => {
    const last = { line: STEADY, at: 1000 };
    expect(decideGuidanceAnnouncement(last, READY, 3000)).toEqual({
      kind: 'announce',
    });
    expect(decideGuidanceAnnouncement(last, READY, 9000)).toEqual({
      kind: 'announce',
    });
  });

  it('defers a changed line until the interval ends', () => {
    const last = { line: STEADY, at: 1000 };
    expect(decideGuidanceAnnouncement(last, READY, 1500)).toEqual({
      kind: 'wait',
      delayMs: 1500,
    });
    expect(decideGuidanceAnnouncement(last, READY, 2999)).toEqual({
      kind: 'wait',
      delayMs: 1,
    });
  });

  it('waits at most one interval when the clock went backwards', () => {
    expect(
      decideGuidanceAnnouncement({ line: STEADY, at: 5000 }, READY, 1000),
    ).toEqual({ kind: 'wait', delayMs: GUIDANCE_ANNOUNCEMENT_INTERVAL_MS });
  });

  it('uses a custom interval', () => {
    const last = { line: STEADY, at: 0 };
    expect(decideGuidanceAnnouncement(last, READY, 500, 400)).toEqual({
      kind: 'announce',
    });
    expect(decideGuidanceAnnouncement(last, READY, 300, 400)).toEqual({
      kind: 'wait',
      delayMs: 100,
    });
  });
});
