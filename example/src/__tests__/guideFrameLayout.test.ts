import { describe, expect, it } from '@jest/globals';

import {
  GUIDE_FRAME_ASPECT_RATIO,
  GUIDE_FRAME_HINT_GAP,
  GUIDE_FRAME_MAX_WIDTH,
  GUIDE_FRAME_VERTICAL_MARGIN,
  fitGuideFrameWidth,
  frameSizeChange,
  usableGuideBox,
} from '../guideFrameLayout';

function usedHeight(frameWidth: number, hintHeight: number) {
  return (
    frameWidth / GUIDE_FRAME_ASPECT_RATIO +
    GUIDE_FRAME_HINT_GAP +
    hintHeight +
    2 * GUIDE_FRAME_VERTICAL_MARGIN
  );
}

describe('fitGuideFrameWidth', () => {
  it('uses the width minus margins on a tall portrait area', () => {
    expect(fitGuideFrameWidth({ width: 393, height: 520 }, 40)).toBe(345);
  });

  it('caps the frame at the maximum width on a wide, tall area', () => {
    expect(fitGuideFrameWidth({ width: 1024, height: 900 }, 20)).toBe(
      GUIDE_FRAME_MAX_WIDTH,
    );
  });

  it('limits the frame by height on a short landscape area', () => {
    const area = { width: 800, height: 200 };
    const width = fitGuideFrameWidth(area, 20);
    expect(width).toBe(181);
    expect(usedHeight(width, 20)).toBeLessThanOrEqual(area.height);
  });

  it('returns 0 when the hint and margins leave no room', () => {
    expect(fitGuideFrameWidth({ width: 800, height: 50 }, 20)).toBe(0);
    expect(fitGuideFrameWidth({ width: 40, height: 600 }, 20)).toBe(0);
  });
});

describe('frameSizeChange', () => {
  const tensors = { boxes: [], scores: [], classes: [] };

  it('reports a first or changed upright frame size', () => {
    const portrait = { ...tensors, frameWidth: 480, frameHeight: 640 };
    expect(frameSizeChange(null, portrait)).toEqual({
      width: 480,
      height: 640,
    });
    expect(frameSizeChange({ width: 640, height: 480 }, portrait)).toEqual({
      width: 480,
      height: 640,
    });
  });

  it('ignores an unchanged size, an error, and a non-positive size', () => {
    expect(
      frameSizeChange(
        { width: 480, height: 640 },
        { ...tensors, frameWidth: 480, frameHeight: 640 },
      ),
    ).toBeNull();
    expect(frameSizeChange(null, { error: 'E_INFERENCE' })).toBeNull();
    expect(
      frameSizeChange(null, { ...tensors, frameWidth: 0, frameHeight: 640 }),
    ).toBeNull();
  });
});

describe('usableGuideBox', () => {
  it('passes a box with a positive area and drops an empty one', () => {
    expect(usableGuideBox([0.2, 0.3, 0.8, 0.9])).toEqual([0.2, 0.3, 0.8, 0.9]);
    expect(usableGuideBox([1, 0.3, 1, 0.9])).toBeUndefined();
    expect(usableGuideBox(undefined)).toBeUndefined();
  });
});
