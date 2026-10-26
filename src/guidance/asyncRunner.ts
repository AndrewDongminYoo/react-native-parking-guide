/** The parts of `react-native-worklets-core`'s `Worklets` that `createDetectorAsyncRunner` uses. */
export interface DetectorRunnerWorklets {
  createContext(name: string): {
    createRunAsync<Args extends unknown[]>(
      fn: (...args: Args) => void
    ): (...args: Args) => unknown;
  };
  createSharedValue<T>(value: T): { value: T };
}

export interface DetectorAsyncRunner<Frame> {
  /**
   * Invoke only in a VisionCamera frame-processor worklet. Runs `work` on the runner's background thread with `frame`
   * kept alive, unless a previous call is still running; returns whether `work` was started. An exception thrown by
   * `work` is lost, so `work` should report failures as values, as `createParkingDetector` does.
   */
  (frame: Frame, work: () => void): boolean;
}

/** VisionCamera's internal frame reference count, which its own `runAsync` uses in the same way. */
interface RefCountedFrame {
  incrementRefCount(): void;
  decrementRefCount(): void;
}

type RunOnContext = (frame: RefCountedFrame, work: () => void) => unknown;

/**
 * The runner's worklet context, created once and referenced for the life of the JS runtime. worklets-core's
 * `createRunAsync` keeps only a raw pointer to its context, so a context whose JS object is garbage-collected is
 * destroyed while the returned function still uses it. VisionCamera 4.7.3's `runAsync` drops its context object this
 * way, and then stops running work or crashes.
 */
let retained:
  | {
      context: unknown;
      run: RunOnContext;
      busy: { value: boolean };
    }
  | undefined;

/**
 * Creates a replacement for VisionCamera's `runAsync` whose worklet context stays alive. Create it on the JS thread and
 * pass `Worklets` from the app's `react-native-worklets-core` import. All runners share one context and one busy
 * flag, so detector calls on the JS runtime run one at a time.
 */
export function createDetectorAsyncRunner<Frame>(
  worklets: DetectorRunnerWorklets
): DetectorAsyncRunner<Frame> {
  if (retained === undefined) {
    const context = worklets.createContext('ParkingGuide.detector');
    const busy = worklets.createSharedValue(false);
    const run = context.createRunAsync(
      (frame: RefCountedFrame, work: () => void) => {
        'worklet';
        try {
          work();
        } finally {
          try {
            frame.decrementRefCount();
          } finally {
            busy.value = false;
          }
        }
      }
    );
    retained = { context, run, busy };
  }
  const { run, busy } = retained;

  return (frame: Frame, work: () => void): boolean => {
    'worklet';
    if (busy.value) {
      return false;
    }
    const counted = frame as unknown as RefCountedFrame;
    counted.incrementRefCount();
    busy.value = true;
    try {
      run(counted, work);
    } catch (error) {
      // The work was never scheduled, so nothing else releases the frame or the busy flag.
      counted.decrementRefCount();
      busy.value = false;
      throw error;
    }
    return true;
  };
}
