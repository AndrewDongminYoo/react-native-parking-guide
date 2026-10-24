import type { GuidanceIssue, GuidanceState } from '../types';

/** Serializable output to hand off from a frame processor to the JS thread. */
export interface GuidanceFrameResult {
  ready: boolean;
  issues: readonly GuidanceIssue[];
  progress: number;
}

export interface GuidanceOptions {
  /** Exponential moving average factor in (0, 1]. Defaults to 0.25. */
  smoothingFactor?: number;
  /** Consecutive matching frames required to commit issues/readiness. Defaults to 3. */
  debounceFrames?: number;
}

export interface GuidanceReducerState {
  guidance: GuidanceState;
  candidate: { ready: boolean; issues: GuidanceIssue[] };
  consecutiveFrames: number;
}

export function createGuidanceState(): GuidanceReducerState {
  return {
    guidance: { ready: false, issues: [], progress: 0 },
    candidate: { ready: false, issues: [] },
    consecutiveFrames: 0,
  };
}

export function reduceGuidance(
  state: GuidanceReducerState,
  frame: GuidanceFrameResult,
  options: GuidanceOptions = {}
): GuidanceReducerState {
  const { smoothingFactor = 0.25, debounceFrames = 3 } = options;
  if (
    !Number.isFinite(smoothingFactor) ||
    smoothingFactor <= 0 ||
    smoothingFactor > 1
  ) {
    throw new RangeError('smoothingFactor must be finite and in (0, 1].');
  }
  if (!Number.isSafeInteger(debounceFrames) || debounceFrames < 1) {
    throw new RangeError('debounceFrames must be a positive safe integer.');
  }

  const issues = [...new Set(frame.issues)].sort();
  const ready = frame.ready && issues.length === 0;
  const matches =
    state.candidate.ready === ready &&
    state.candidate.issues.length === issues.length &&
    state.candidate.issues.every((issue, index) => issue === issues[index]);
  const consecutiveFrames = matches
    ? Math.min(state.consecutiveFrames + 1, debounceFrames)
    : 1;
  const settled = consecutiveFrames >= debounceFrames;
  const progress = Number.isNaN(frame.progress)
    ? 0
    : Math.max(0, Math.min(1, frame.progress));

  return {
    guidance: {
      ready: ready && settled,
      issues: settled ? issues : state.guidance.issues,
      progress:
        state.guidance.progress +
        smoothingFactor * (progress - state.guidance.progress),
    },
    candidate: { ready, issues },
    consecutiveFrames,
  };
}
