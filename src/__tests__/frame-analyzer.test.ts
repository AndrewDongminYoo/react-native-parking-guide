import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  Frame,
  FrameProcessorPlugin,
  VisionCameraProxy,
} from 'react-native-vision-camera';

import {
  CAPTURE_GUIDANCE_THRESHOLDS,
  createParkingFrameAnalyzer,
} from '../guidance/frameAnalyzer';
import { createGuidanceState, reduceGuidance } from '../guidance/reducer';

const call = jest.fn<FrameProcessorPlugin['call']>();
const mockInitFrameProcessorPlugin =
  jest.fn<typeof VisionCameraProxy.initFrameProcessorPlugin>();
const proxy = { initFrameProcessorPlugin: mockInitFrameProcessorPlugin };

beforeEach(() => {
  call.mockReset();
  mockInitFrameProcessorPlugin.mockReset().mockReturnValue({ call });
});

describe('createParkingFrameAnalyzer', () => {
  it('initializes the native plugin with the shared Android/iOS thresholds', () => {
    const analyze = createParkingFrameAnalyzer(proxy);
    expect(mockInitFrameProcessorPlugin).toHaveBeenCalledWith(
      'parkingGuide',
      CAPTURE_GUIDANCE_THRESHOLDS
    );
    expect(CAPTURE_GUIDANCE_THRESHOLDS).toEqual({
      minLaplacianVariance: 100,
      minMeanLuminance: 50,
      maxTiltRadians: Math.PI / 9,
    });
    expect(Object.isFrozen(CAPTURE_GUIDANCE_THRESHOLDS)).toBe(true);
    analyze({} as Frame);
    analyze({} as Frame);
    expect(mockInitFrameProcessorPlugin).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly when the native plugin is not registered', () => {
    mockInitFrameProcessorPlugin.mockReturnValue(undefined);
    expect(() => createParkingFrameAnalyzer(proxy)).toThrow(
      /parkingGuide.*native plugin/
    );
  });

  it('hands serializable native results to the existing guidance reducer', () => {
    const frame = {} as Frame;
    const result = {
      ready: false,
      issues: ['BLURRY', 'LOW_LIGHT', 'TILTED'],
      progress: 0,
    };
    call.mockReturnValue(
      result as unknown as ReturnType<FrameProcessorPlugin['call']>
    );
    const analyze = createParkingFrameAnalyzer(proxy);
    let state = createGuidanceState();
    for (let index = 0; index < 3; index++) {
      state = reduceGuidance(state, analyze(frame));
    }
    expect(call).toHaveBeenCalledWith(frame);
    expect(state.guidance).toEqual(result);
  });

  it('does not signal readiness when native analysis returns no result', () => {
    call.mockReturnValue(undefined);
    expect(createParkingFrameAnalyzer(proxy)({} as Frame)).toEqual({
      ready: false,
      issues: [],
      progress: 0,
    });
  });
});
