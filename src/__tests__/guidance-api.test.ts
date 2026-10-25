import { describe, expect, it, jest } from '@jest/globals';

import {
  createGuidanceState,
  createParkingFrameAnalyzer,
  CAPTURE_GUIDANCE_THRESHOLDS,
  mapModelOutput,
  DEFAULT_MAPPING_THRESHOLDS,
  reduceGuidance,
  useParkingGuidance,
} from '../index';

jest.mock('../NativeParkingGuide', () => ({
  __esModule: true,
  default: {},
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
  });

  it('exports pure inference mapping without loading Vision Camera', () => {
    expect(mapModelOutput({ detections: [] })[0]?.verdict).toBe('FAIL');
    expect(DEFAULT_MAPPING_THRESHOLDS.VEHICLE_DETECTED.passAt).toBe(0.8);
  });
});
