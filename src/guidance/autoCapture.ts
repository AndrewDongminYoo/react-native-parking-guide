export const DEFAULT_AUTO_CAPTURE_HOLD_MS = 800;

export interface AutoCaptureState {
  /** Start of the current continuous `ready` period, or `null` while not ready. */
  readySince: number | null;
  /** True once this `ready` period has raised `due`. */
  fired: boolean;
  /** True when the app should take the photo now; cleared by `acknowledgeAutoCapture`. */
  due: boolean;
}

export function createAutoCaptureState(): AutoCaptureState {
  return { readySince: null, fired: false, due: false };
}

/**
 * Raises `due` once per continuous `ready` period, `holdMs` after it started. A drop of `ready` clears the state, so
 * the next `ready` period can fire again. Pure; `now` is in milliseconds.
 */
export function reduceAutoCapture(
  state: AutoCaptureState,
  input: { ready: boolean; now: number },
  holdMs: number
): AutoCaptureState {
  if (!Number.isFinite(holdMs) || holdMs < 0) {
    throw new RangeError('holdMs must be finite and >= 0.');
  }
  if (!input.ready) {
    return createAutoCaptureState();
  }
  const readySince = state.readySince ?? input.now;
  if (!state.fired && input.now - readySince >= holdMs) {
    return { readySince, fired: true, due: true };
  }
  return { ...state, readySince };
}

/** Clears `due` after the app has taken the photo; the current `ready` period does not fire again. */
export function acknowledgeAutoCapture(
  state: AutoCaptureState
): AutoCaptureState {
  return { ...state, due: false };
}
