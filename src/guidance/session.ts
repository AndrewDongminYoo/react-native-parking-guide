import {
  DEFAULT_AUTO_CAPTURE_HOLD_MS,
  acknowledgeAutoCapture,
  createAutoCaptureState,
  reduceAutoCapture,
} from './autoCapture';
import type { AutoCaptureState } from './autoCapture';
import {
  DEFAULT_DETECTION_STALE_MS,
  mergeDetection,
  toDetectionSnapshot,
  validateDetectionOptions,
} from './detection';
import type {
  DetectionOptions,
  DetectionSnapshot,
  DetectorFrameResult,
} from './detection';
import { createGuidanceState, reduceGuidance } from './reducer';
import type {
  GuidanceFrameResult,
  GuidanceOptions,
  GuidanceReducerState,
} from './reducer';

export interface GuidanceSessionOptions extends GuidanceOptions {
  /** Enables model-based guidance; `ready` then requires a fresh detection without model issues. */
  detection?: DetectionOptions;
  /** Enables the auto-capture signal. Default hold: `DEFAULT_AUTO_CAPTURE_HOLD_MS`. */
  autoCapture?: { holdMs?: number };
}

export interface GuidanceSessionState {
  guidance: GuidanceReducerState;
  snapshot: DetectionSnapshot | null;
  detectorError: string | null;
  autoCapture: AutoCaptureState;
  /** Incremented by `reset`; detections from an older generation are ignored. */
  generation: number;
}

export type GuidanceSessionEvent =
  | { type: 'frame'; frame: GuidanceFrameResult; now: number }
  | {
      type: 'detection';
      result: DetectorFrameResult;
      generation: number;
      now: number;
    }
  | { type: 'reset' }
  | { type: 'acknowledgeAutoCapture' };

/** Throws `RangeError` for invalid `detection` or `autoCapture` options. */
export function validateGuidanceSessionOptions(
  options: GuidanceSessionOptions
): void {
  if (options.detection !== undefined) {
    validateDetectionOptions(options.detection);
  }
  const holdMs = options.autoCapture?.holdMs ?? DEFAULT_AUTO_CAPTURE_HOLD_MS;
  if (!Number.isFinite(holdMs) || holdMs < 0) {
    throw new RangeError('autoCapture.holdMs must be finite and >= 0.');
  }
}

export function createGuidanceSession(generation = 0): GuidanceSessionState {
  return {
    guidance: createGuidanceState(),
    snapshot: null,
    detectorError: null,
    autoCapture: createAutoCaptureState(),
    generation,
  };
}

/** Pure session reducer behind `useParkingGuidance`. Validate `options` first with `validateGuidanceSessionOptions`. */
export function reduceGuidanceSession(
  state: GuidanceSessionState,
  event: GuidanceSessionEvent,
  options: GuidanceSessionOptions
): GuidanceSessionState {
  switch (event.type) {
    case 'reset':
      return createGuidanceSession(state.generation + 1);
    case 'acknowledgeAutoCapture':
      return {
        ...state,
        autoCapture: acknowledgeAutoCapture(state.autoCapture),
      };
    case 'detection': {
      if (event.generation !== state.generation) {
        return state;
      }
      const { capturedAt } = event.result;
      const snapshot = toDetectionSnapshot(
        event.result,
        capturedAt !== undefined && Number.isFinite(capturedAt)
          ? capturedAt
          : event.now,
        options.detection ?? {}
      );
      return { ...state, snapshot, detectorError: snapshot.error };
    }
    case 'frame': {
      const { detection, autoCapture } = options;
      const merged =
        detection === undefined
          ? { frame: event.frame, detectorError: null }
          : mergeDetection(
              event.frame,
              state.snapshot,
              event.now,
              detection.staleAfterMs ?? DEFAULT_DETECTION_STALE_MS
            );
      const guidance = reduceGuidance(state.guidance, merged.frame, options);
      return {
        ...state,
        guidance,
        detectorError: merged.detectorError,
        autoCapture:
          autoCapture === undefined
            ? createAutoCaptureState()
            : reduceAutoCapture(
                state.autoCapture,
                { ready: guidance.guidance.ready, now: event.now },
                autoCapture.holdMs ?? DEFAULT_AUTO_CAPTURE_HOLD_MS
              ),
      };
    }
  }
}
