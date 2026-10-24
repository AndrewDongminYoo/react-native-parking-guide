import { describe, expect, it } from '@jest/globals';

import {
  GUIDE_FRAME_ASPECT_RATIO,
  GUIDE_FRAME_HINT_GAP,
  GUIDE_FRAME_MAX_WIDTH,
  GUIDE_FRAME_VERTICAL_MARGIN,
  fitGuideFrameWidth,
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
      GUIDE_FRAME_MAX_WIDTH
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
