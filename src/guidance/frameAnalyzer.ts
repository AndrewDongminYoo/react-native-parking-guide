import type { DetectorFrameResult } from './detection';
import type { GuidanceFrameResult } from './reducer';

/** Shared initialization values for iOS and Android frame processor plugins. */
export const CAPTURE_GUIDANCE_THRESHOLDS = Object.freeze({
  minLaplacianVariance: 100,
  minMeanLuminance: 50,
  maxTiltRadians: Math.PI / 9,
});

export interface ParkingFrameAnalyzer<Frame> {
  /** Invoke only in a VisionCamera frame-processor worklet. */
  (frame: Frame): GuidanceFrameResult;
}

/** Create once per capture session on the JS thread. */
export function createParkingFrameAnalyzer<Frame>(proxy: {
  initFrameProcessorPlugin(
    name: string,
    options: Record<string, number>
  ): { call(frame: Frame): unknown } | undefined;
}): ParkingFrameAnalyzer<Frame> {
  const plugin = proxy.initFrameProcessorPlugin(
    'parkingGuide',
    CAPTURE_GUIDANCE_THRESHOLDS
  );
  if (plugin == null) {
    throw new Error(
      'The parkingGuide frame processor is unavailable. Install the native plugin and enable VisionCamera frame processors.'
    );
  }

  return (frame: Frame): GuidanceFrameResult => {
    'worklet';
    return (
      (plugin.call(frame) as unknown as GuidanceFrameResult | undefined) ?? {
        ready: false,
        issues: [],
        progress: 0,
      }
    );
  };
}

export interface ParkingDetector<Frame> {
  /** Invoke only in a VisionCamera frame-processor worklet, preferably inside `runAsync`; it runs the model. */
  (frame: Frame): DetectorFrameResult;
}

/**
 * Create once per capture session on the JS thread. `modelUri` accepts the same forms as `runDetector`, and the
 * native side shares the loaded model with `runDetector` for the same URI.
 */
export function createParkingDetector<Frame>(
  proxy: {
    initFrameProcessorPlugin(
      name: string,
      options: Record<string, string | number>
    ): { call(frame: Frame): unknown } | undefined;
  },
  options: { modelUri: string }
): ParkingDetector<Frame> {
  const plugin = proxy.initFrameProcessorPlugin('parkingDetector', {
    modelUri: options.modelUri,
  });
  if (plugin == null) {
    throw new Error(
      'The parkingDetector frame processor is unavailable. Install the native plugin and enable VisionCamera frame processors.'
    );
  }

  return (frame: Frame): DetectorFrameResult => {
    'worklet';
    return (
      (plugin.call(frame) as unknown as DetectorFrameResult | undefined) ?? {
        error: 'E_INFERENCE',
      }
    );
  };
}
