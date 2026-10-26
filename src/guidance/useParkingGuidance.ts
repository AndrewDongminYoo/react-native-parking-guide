import { useCallback, useEffect, useRef, useState } from 'react';

import { copyDetectorResult } from './detection';
import type { DetectorFrameResult } from './detection';
import type { GuidanceFrameResult } from './reducer';
import {
  createGuidanceSession,
  reduceGuidanceSession,
  validateGuidanceSessionOptions,
} from './session';
import type { GuidanceSessionOptions } from './session';
import type { GuidanceState } from '../types';

export interface ParkingGuidance extends GuidanceState {
  /** Call on the JS thread, not directly inside a frame-processor worklet. */
  onFrameResult: (result: GuidanceFrameResult) => void;
  /** Call on the JS thread with each `createParkingDetector` result. Ignored after `reset` for older callbacks. */
  onDetectorResult: (result: DetectorFrameResult) => void;
  /** Error code of the latest detection when the detector failed; `null` otherwise. */
  detectorError: string | null;
  /** True when `autoCapture` is set and `ready` has held for its hold time; take the photo, then acknowledge. */
  autoCaptureDue: boolean;
  /** Clears `autoCaptureDue`; the current ready period does not raise it again. */
  acknowledgeAutoCapture: () => void;
  /** Clear smoothing, debounce, detection, and auto-capture history when restarting capture. */
  reset: () => void;
}

export function useParkingGuidance(
  options: GuidanceSessionOptions = {}
): ParkingGuidance {
  validateGuidanceSessionOptions(options);
  const [state, setState] = useState(() => createGuidanceSession());
  // Callbacks read the latest options without being recreated, so frame-processor bridges stay stable.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const onFrameResult = useCallback((result: GuidanceFrameResult) => {
    // Snapshot the handoff before React processes the queued updater.
    const frame = { ...result, issues: [...result.issues] };
    const now = Date.now();
    setState((previous) =>
      reduceGuidanceSession(
        previous,
        { type: 'frame', frame, now },
        optionsRef.current
      )
    );
  }, []);
  const { generation } = state;
  const onDetectorResult = useCallback(
    (delivered: DetectorFrameResult) => {
      // Snapshot the handoff (a host object from the worklet) before React processes the queued updater.
      const result = copyDetectorResult(delivered);
      const now = Date.now();
      setState((previous) =>
        reduceGuidanceSession(
          previous,
          { type: 'detection', result, generation, now },
          optionsRef.current
        )
      );
    },
    [generation]
  );
  const acknowledgeAutoCapture = useCallback(
    () =>
      setState((previous) =>
        reduceGuidanceSession(
          previous,
          { type: 'acknowledgeAutoCapture' },
          optionsRef.current
        )
      ),
    []
  );
  const reset = useCallback(
    () =>
      setState((previous) =>
        reduceGuidanceSession(previous, { type: 'reset' }, optionsRef.current)
      ),
    []
  );

  return {
    ...state.guidance.guidance,
    onFrameResult,
    onDetectorResult,
    detectorError: state.detectorError,
    autoCaptureDue: state.autoCapture.due,
    acknowledgeAutoCapture,
    reset,
  };
}
