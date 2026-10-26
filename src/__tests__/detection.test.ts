import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_DETECTION_STALE_MS,
  copyDetectorResult,
  mergeDetection,
  toDetectionSnapshot,
  validateDetectionOptions,
} from '../guidance/detection';
import type {
  DetectionSnapshot,
  DetectorFrameResult,
} from '../guidance/detection';
import type { GuidanceFrameResult } from '../guidance/reducer';

const VEHICLE = {
  boxes: [0.2, 0.3, 0.8, 0.9],
  scores: [0.9],
  classes: [0],
  frameWidth: 480,
  frameHeight: 640,
};
const EMPTY = {
  boxes: [],
  scores: [],
  classes: [],
  frameWidth: 480,
  frameHeight: 640,
};
const QUALITY: GuidanceFrameResult = { ready: true, issues: [], progress: 1 };

/**
 * Imitates how react-native-worklets-core delivers a worklet value on the JS thread: a host object whose `in` operator
 * reports every key, with arrays that are array-like host objects instead of arrays.
 */
function hostObject(value: Record<string, unknown>): DetectorFrameResult {
  const wrap = (item: unknown) =>
    Array.isArray(item) ? { ...item, length: item.length } : item;
  return new Proxy(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, wrap(item)])
    ),
    { has: () => true }
  ) as unknown as DetectorFrameResult;
}

describe('copyDetectorResult', () => {
  it('copies a host-object result into plain values', () => {
    const copy = copyDetectorResult(hostObject({ ...VEHICLE, capturedAt: 5 }));
    expect('error' in copy).toBe(false);
    expect(copy).toEqual({ ...VEHICLE, capturedAt: 5 });
    expect(Array.isArray('boxes' in copy && copy.boxes)).toBe(true);
  });

  it('keeps an error result', () => {
    expect(
      copyDetectorResult(hostObject({ error: 'E_MODEL_LOAD', capturedAt: 5 }))
    ).toEqual({ error: 'E_MODEL_LOAD', capturedAt: 5 });
  });
});

describe('toDetectionSnapshot', () => {
  it('maps a vehicle detection to model issues', () => {
    // The box fills 0.6 of the whole frame and leaves a 0.1 ground margin: no issue.
    expect(toDetectionSnapshot(VEHICLE, 10, {})).toEqual({
      issues: [],
      error: null,
      at: 10,
    });
    expect(toDetectionSnapshot(EMPTY, 10, {})).toEqual({
      issues: ['NO_VEHICLE'],
      error: null,
      at: 10,
    });
  });

  it('applies the guide frame from the options', () => {
    expect(
      toDetectionSnapshot(VEHICLE, 10, { guideFrame: [0.3, 0.3, 0.7, 0.9] })
        .issues
    ).toEqual(['TOO_CLOSE', 'GROUND_NOT_VISIBLE']);
  });

  it('maps a host-object detection instead of reading it as an error', () => {
    expect(toDetectionSnapshot(hostObject(EMPTY), 10, {})).toEqual({
      issues: ['NO_VEHICLE'],
      error: null,
      at: 10,
    });
  });

  it('turns a native error into a snapshot error', () => {
    expect(toDetectionSnapshot({ error: 'E_MODEL_LOAD' }, 10, {})).toEqual({
      issues: [],
      error: 'E_MODEL_LOAD',
      at: 10,
    });
  });

  it('turns invalid model output into E_MODEL_CONTRACT without throwing', () => {
    expect(
      toDetectionSnapshot({ ...VEHICLE, scores: [Number.NaN] }, 10, {}).error
    ).toBe('E_MODEL_CONTRACT');
    expect(toDetectionSnapshot({ ...VEHICLE, classes: [] }, 10, {}).error).toBe(
      'E_MODEL_CONTRACT'
    );
  });
});

describe('mergeDetection', () => {
  const noVehicle: DetectionSnapshot = {
    issues: ['NO_VEHICLE'],
    error: null,
    at: 0,
  };
  const clear: DetectionSnapshot = { issues: [], error: null, at: 0 };

  it('merges fresh issues and keeps ready only without model issues', () => {
    expect(mergeDetection(QUALITY, noVehicle, 100, 1500)).toEqual({
      frame: { ready: false, issues: ['NO_VEHICLE'], progress: 1 },
      detectorError: null,
    });
    expect(mergeDetection(QUALITY, clear, 100, 1500)).toEqual({
      frame: QUALITY,
      detectorError: null,
    });
  });

  it('keeps the quality issues next to the model issues', () => {
    expect(
      mergeDetection(
        { ready: false, issues: ['BLURRY'], progress: 0.5 },
        noVehicle,
        100,
        1500
      ).frame.issues
    ).toEqual(['BLURRY', 'NO_VEHICLE']);
  });

  it('fails closed on a missing, stale, or failed detection without NO_VEHICLE', () => {
    expect(mergeDetection(QUALITY, null, 100, 1500)).toEqual({
      frame: { ready: false, issues: [], progress: 1 },
      detectorError: null,
    });
    expect(mergeDetection(QUALITY, clear, 1501, 1500).frame.ready).toBe(false);
    expect(mergeDetection(QUALITY, clear, 1500, 1500).frame.ready).toBe(true);
    expect(
      mergeDetection(QUALITY, { ...clear, at: 200 }, 100, 1500).frame.ready
    ).toBe(false);
    expect(
      mergeDetection(QUALITY, { ...clear, error: 'E_INFERENCE' }, 100, 1500)
    ).toEqual({
      frame: { ready: false, issues: [], progress: 1 },
      detectorError: 'E_INFERENCE',
    });
  });
});

describe('validateDetectionOptions', () => {
  it('accepts the defaults', () => {
    expect(DEFAULT_DETECTION_STALE_MS).toBe(1500);
    expect(() => validateDetectionOptions({})).not.toThrow();
  });

  it('rejects invalid detection options', () => {
    expect(() => validateDetectionOptions({ staleAfterMs: 0 })).toThrow(
      RangeError
    );
    expect(() =>
      validateDetectionOptions({ staleAfterMs: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
    expect(() =>
      validateDetectionOptions({
        thresholds: { tooFarBelow: 2, tooCloseAbove: 1 },
      })
    ).toThrow(RangeError);
    expect(() =>
      validateDetectionOptions({ guideFrame: [0.5, 0, 0.4, 1] })
    ).toThrow(RangeError);
  });
});
