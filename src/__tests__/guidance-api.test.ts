import { describe, expect, it, jest } from '@jest/globals';

import {
  createGuidanceState,
  createParkingFrameAnalyzer,
  CAPTURE_GUIDANCE_THRESHOLDS,
  getModelVersion,
  reduceGuidance,
  useParkingGuidance,
} from '../index';

jest.mock('../NativeParkingGuide', () => ({
  __esModule: true,
  default: { getModelVersion: () => '0.1.0-dev' },
}));

jest.mock('react-native-vision-camera', () => {
  throw new Error('VisionCamera must not load when importing the public API.');
});

describe('guidance public API', () => {
  it('exports JS guidance without installing Vision Camera', () => {
    expect(useParkingGuidance).toEqual(expect.any(Function));
    expect(createParkingFrameAnalyzer).toEqual(expect.any(Function));
    expect(CAPTURE_GUIDANCE_THRESHOLDS.minMeanLuminance).toBe(50);
    expect(
      reduceGuidance(
        createGuidanceState(),
        { ready: true, issues: [], progress: 1 },
        { debounceFrames: 1, smoothingFactor: 1 }
      ).guidance
    ).toEqual({ ready: true, issues: [], progress: 1 });
    expect(getModelVersion()).toBe('0.1.0-dev');
  });
});
