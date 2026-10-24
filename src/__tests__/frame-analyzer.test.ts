import { describe, expect, it, jest } from '@jest/globals';

import {
  CAPTURE_GUIDANCE_THRESHOLDS,
  createParkingFrameAnalyzer,
} from '../guidance/frameAnalyzer';
import { createGuidanceState, reduceGuidance } from '../guidance/reducer';

describe('native frame analyzer adapter', () => {
  it('initializes parkingGuide once with the iOS parity thresholds', () => {
    const result = { ready: false, issues: ['BLURRY'], progress: 2 / 3 };
    const call = jest.fn((_frame: { id: number }) => result);
    const initFrameProcessorPlugin = jest.fn(() => ({ call }));
    const analyze = createParkingFrameAnalyzer({ initFrameProcessorPlugin });
    expect(initFrameProcessorPlugin).toHaveBeenCalledWith('parkingGuide', {
      minLaplacianVariance: 100,
      minMeanLuminance: 50,
      maxTiltRadians: Math.PI / 9,
    });
    expect(Object.isFrozen(CAPTURE_GUIDANCE_THRESHOLDS)).toBe(true);
    const frame = { id: 1 };
    expect(analyze(frame)).toBe(result);
    expect(call).toHaveBeenCalledWith(frame);
    analyze(frame);
    expect(initFrameProcessorPlugin).toHaveBeenCalledTimes(1);
  });

  it('throws when the optional native plugin is unavailable', () => {
    expect(() =>
      createParkingFrameAnalyzer({
        initFrameProcessorPlugin: () => undefined,
      })
    ).toThrow('parkingGuide frame processor is unavailable');
  });

  it('falls back to a non-ready result when native output is missing', () => {
    const analyze = createParkingFrameAnalyzer({
      initFrameProcessorPlugin: () => ({ call: (_frame: object) => undefined }),
    });
    expect(analyze({})).toEqual({ ready: false, issues: [], progress: 0 });
  });

  it('hands serializable quality results to the guidance reducer', () => {
    const analyze = createParkingFrameAnalyzer({
      initFrameProcessorPlugin: () => ({
        call: (_frame: object) => ({
          ready: false,
          issues: ['LOW_LIGHT', 'TILTED'],
          progress: 1 / 3,
        }),
      }),
    });
    expect(
      reduceGuidance(createGuidanceState(), analyze({}), {
        debounceFrames: 1,
        smoothingFactor: 1,
      }).guidance
    ).toEqual({
      ready: false,
      issues: ['LOW_LIGHT', 'TILTED'],
      progress: 1 / 3,
    });
  });
});
