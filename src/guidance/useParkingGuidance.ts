import { useCallback, useState } from 'react';

import { createGuidanceState, reduceGuidance } from './reducer';
import type { GuidanceFrameResult, GuidanceOptions } from './reducer';
import type { GuidanceState } from '../types';

export interface ParkingGuidance extends GuidanceState {
  /** Call on the JS thread, not directly inside a frame-processor worklet. */
  onFrameResult: (result: GuidanceFrameResult) => void;
  /** Clear smoothing and debounce history when restarting capture. */
  reset: () => void;
}

export function useParkingGuidance(
  options: GuidanceOptions = {}
): ParkingGuidance {
  const [state, setState] = useState(createGuidanceState);
  const { smoothingFactor, debounceFrames } = options;
  const onFrameResult = useCallback(
    (result: GuidanceFrameResult) => {
      // Snapshot the handoff before React processes the queued updater.
      const frame = { ...result, issues: [...result.issues] };
      setState((previous) =>
        reduceGuidance(previous, frame, { smoothingFactor, debounceFrames })
      );
    },
    [smoothingFactor, debounceFrames]
  );
  const reset = useCallback(() => setState(createGuidanceState()), []);

  return { ...state.guidance, onFrameResult, reset };
}
