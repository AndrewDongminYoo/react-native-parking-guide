import { decodeDetectorOutput } from '../inference/detector';
import { mapGuidanceIssues } from '../inference/guidance';
import type { GuidanceMappingOptions } from '../inference/guidance';
import type { GuidanceIssue } from '../types';
import type { GuidanceFrameResult } from './reducer';

/**
 * One `parkingDetector` frame processor result: the detector output tensors and the upright frame size, or an error
 * code (`E_INVALID_URI`, `E_MODEL_LOAD`, `E_MODEL_CONTRACT`, `E_PHOTO_READ`, or `E_INFERENCE`). `capturedAt`
 * (`Date.now()` before inference, set by `createParkingDetector`) dates the detection for freshness checks.
 */
export type DetectorFrameResult = (
  | {
      boxes: number[];
      scores: number[];
      classes: number[];
      frameWidth: number;
      frameHeight: number;
    }
  | { error: string }
) & { capturedAt?: number };

export interface DetectionOptions extends GuidanceMappingOptions {
  /** A detection older than this many milliseconds keeps guidance not ready. Default: 1500 (provisional). */
  readonly staleAfterMs?: number;
}

/** Model-based guidance from the latest detection, or the error it failed with. */
export interface DetectionSnapshot {
  issues: GuidanceIssue[];
  error: string | null;
  /** Time of the detection in milliseconds, on the same clock as `mergeDetection`'s `now`. */
  at: number;
}

export const DEFAULT_DETECTION_STALE_MS = 1500;

/** Throws `RangeError` for options that `mapGuidanceIssues` rejects or a `staleAfterMs` that is not finite and > 0. */
export function validateDetectionOptions(options: DetectionOptions): void {
  const { staleAfterMs = DEFAULT_DETECTION_STALE_MS } = options;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new RangeError('staleAfterMs must be finite and > 0.');
  }
  mapGuidanceIssues({ detections: [] }, options);
}

/**
 * A plain copy of one detector result. `react-native-worklets-core` delivers a worklet value to the JS thread as a host
 * object: the `in` operator reports every key on it, and its arrays fail `Array.isArray`. Copy a result before
 * reading it. An `error` that is not a string, or a tensor field that is not a list, is copied as it is, so decoding
 * rejects it as `E_MODEL_CONTRACT`.
 */
export function copyDetectorResult(
  result: DetectorFrameResult,
): DetectorFrameResult {
  const source = result as unknown as Record<string, unknown>;
  const capturedAt = source.capturedAt as number | undefined;
  if (typeof source.error === 'string') {
    return { error: source.error, capturedAt };
  }
  return {
    boxes: copyList(source.boxes),
    scores: copyList(source.scores),
    classes: copyList(source.classes),
    frameWidth: source.frameWidth as number,
    frameHeight: source.frameHeight as number,
    capturedAt,
  };
}

function copyList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (value !== null && typeof value === 'object') {
    const { length } = value as { length?: unknown };
    if (typeof length === 'number' && Number.isInteger(length) && length >= 0) {
      return Array.from({ length }, (_, index) => (value as number[])[index]!);
    }
  }
  return value as number[];
}

/**
 * Decodes one detector result and maps it to model-based guidance issues. Invalid model output becomes
 * `E_MODEL_CONTRACT` instead of throwing; validate `options` first with `validateDetectionOptions`.
 */
export function toDetectionSnapshot(
  result: DetectorFrameResult,
  at: number,
  options: DetectionOptions,
): DetectionSnapshot {
  const copy = copyDetectorResult(result);
  if ('error' in copy) {
    return { issues: [], error: copy.error, at };
  }
  try {
    const output = decodeDetectorOutput(copy);
    return { issues: mapGuidanceIssues(output, options), error: null, at };
  } catch (error) {
    if (error instanceof RangeError) {
      return { issues: [], error: 'E_MODEL_CONTRACT', at };
    }
    throw error;
  }
}

/**
 * Adds the latest detection to one image-quality frame. A missing, stale (older than `staleAfterMs`, or from the
 * future), or failed detection adds no issue but makes the frame not ready; a failure is returned as `detectorError`.
 */
export function mergeDetection(
  frame: GuidanceFrameResult,
  snapshot: DetectionSnapshot | null,
  now: number,
  staleAfterMs: number,
): { frame: GuidanceFrameResult; detectorError: string | null } {
  if (snapshot?.error != null) {
    return { frame: { ...frame, ready: false }, detectorError: snapshot.error };
  }
  const age = snapshot === null ? Number.NaN : now - snapshot.at;
  if (snapshot === null || !(age >= 0 && age <= staleAfterMs)) {
    return { frame: { ...frame, ready: false }, detectorError: null };
  }
  return {
    frame: {
      ...frame,
      ready: frame.ready && snapshot.issues.length === 0,
      issues: [...frame.issues, ...snapshot.issues],
    },
    detectorError: null,
  };
}
