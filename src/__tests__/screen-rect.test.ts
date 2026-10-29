import { describe, expect, it } from '@jest/globals';

import { screenRectToFrameBox } from '../guidance/screenRect';

const VIEW = { width: 390, height: 844 };
const PORTRAIT = { width: 480, height: 640 };

describe('screenRectToFrameBox', () => {
  it('maps the whole view through the cover crop', () => {
    // 480 x 640 shown in 390 x 844: scale 1.31875, frame shown 633 x 844, 121.5 points cropped on each side.
    const [left, top, right, bottom] = screenRectToFrameBox(
      { x: 0, y: 0, width: 390, height: 844 },
      VIEW,
      PORTRAIT,
    );
    expect(left).toBeCloseTo(0.19194, 4);
    expect(top).toBe(0);
    expect(right).toBeCloseTo(0.80806, 4);
    expect(bottom).toBe(1);
  });

  it('maps an inner rect', () => {
    const [left, top, right, bottom] = screenRectToFrameBox(
      { x: 45, y: 300, width: 300, height: 225 },
      VIEW,
      PORTRAIT,
    );
    expect(left).toBeCloseTo((45 + 121.5) / 633, 6);
    expect(top).toBeCloseTo(300 / 844, 6);
    expect(right).toBeCloseTo((345 + 121.5) / 633, 6);
    expect(bottom).toBeCloseTo(525 / 844, 6);
  });

  it('maps the same rect differently for a landscape frame', () => {
    const rect = { x: 45, y: 300, width: 300, height: 225 };
    expect(
      screenRectToFrameBox(rect, VIEW, { width: 640, height: 480 }),
    ).not.toEqual(screenRectToFrameBox(rect, VIEW, PORTRAIT));
  });

  it('clamps to [0, 1]', () => {
    expect(
      screenRectToFrameBox(
        { x: -200, y: -10, width: 1000, height: 2000 },
        VIEW,
        PORTRAIT,
      ),
    ).toEqual([0, 0, 1, 1]);
  });

  it('rejects empty or non-finite sizes', () => {
    const rect = { x: 0, y: 0, width: 1, height: 1 };
    expect(() =>
      screenRectToFrameBox(rect, { width: 0, height: 1 }, PORTRAIT),
    ).toThrow(RangeError);
    expect(() =>
      screenRectToFrameBox(rect, VIEW, { width: 480, height: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      screenRectToFrameBox({ ...rect, width: Number.NaN }, VIEW, PORTRAIT),
    ).toThrow(RangeError);
  });
});
