import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  Frame,
  FrameProcessorPlugin,
  VisionCameraProxy,
} from 'react-native-vision-camera';

import {
  CAPTURE_GUIDANCE_THRESHOLDS,
  createParkingDetector,
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
      CAPTURE_GUIDANCE_THRESHOLDS,
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
      /parkingGuide.*native plugin/,
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
      result as unknown as ReturnType<FrameProcessorPlugin['call']>,
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

describe('createParkingDetector', () => {
  it('initializes the parkingDetector plugin with the model URI and returns its result', () => {
    const result = {
      boxes: [0.1, 0.2, 0.6, 0.9],
      scores: [0.8],
      classes: [0],
      frameWidth: 480,
      frameHeight: 640,
    };
    // The native result holds number arrays, which VisionCamera's ParameterType does not model.
    call.mockReturnValue(result as never);
    const detect = createParkingDetector(proxy, { modelUri: '/m.tflite' });
    expect(mockInitFrameProcessorPlugin).toHaveBeenCalledWith(
      'parkingDetector',
      { modelUri: '/m.tflite' },
    );
    jest.spyOn(Date, 'now').mockReturnValue(1234);
    expect(detect({} as Frame)).toEqual({ ...result, capturedAt: 1234 });
  });

  it('fails explicitly when the native plugin is not registered', () => {
    mockInitFrameProcessorPlugin.mockReturnValue(undefined);
    expect(() =>
      createParkingDetector(proxy, { modelUri: '/m.tflite' }),
    ).toThrow(/parkingDetector.*native plugin/);
  });

  it('reports E_INFERENCE when the plugin returns nothing', () => {
    call.mockReturnValue(undefined);
    const detect = createParkingDetector(proxy, { modelUri: '/m.tflite' });
    jest.spyOn(Date, 'now').mockReturnValue(5);
    expect(detect({} as Frame)).toEqual({
      error: 'E_INFERENCE',
      capturedAt: 5,
    });
  });
});
