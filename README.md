# react-native-parking-guide

A React Native TurboModule library for iOS and Android. It guides users of rentable shared personal mobility
vehicles while they photograph their parked vehicle with the device camera, and returns a parking verdict of
`PASS`, `WARN`, or `FAIL`.

Supported vehicles are rentable shared personal mobility only: bicycles, electric-assist bicycles (e-bikes),
kickboards including electric kickboards, and motorcycles or mopeds. Cars are out of scope.

> **Status:** early scaffold. The policy evaluation engine (`evaluatePolicy`), JS capture-guidance state
> processing (`useParkingGuidance`), Android image-quality frame analysis, and a native `getModelVersion()` stub
> are implemented. This branch does not implement iOS frame analysis, vehicle detection, or on-device inference.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference: CoreML on iOS, TFLite on Android.
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.2 (M2)**: JS frame-result handoff, smoothed capture guidance, and Android image-quality frame analysis.
  iOS native analysis is developed separately.
- **v0.5**: prohibited-zone rules (tactile paving, crosswalk, roadway), geofence integration, additional guidance signals.
- **v1.0**: production on-device model pipeline, attestation support, upload and server-side verification integration.

## Installation

```sh
npm install react-native-parking-guide
```

`react-native-vision-camera@^4.7.3` is an optional peer dependency. Install it in the app only when using its
camera/frame processors; the policy engine and JS guidance logic do not import or require it.

For Android capture guidance, install `react-native-worklets-core@1.6.3` and add
`react-native-worklets-core/plugin` to the app's Babel `plugins`. Worklets Core 1.6.3 requires
`@babel/plugin-proposal-optional-chaining@7.21.0` and
`@babel/plugin-proposal-nullish-coalescing-operator@7.18.6` as Babel development dependencies.
Declare `android.permission.CAMERA` in the app's manifest and request camera permission before mounting `Camera`.
Do not set `VisionCamera_enableFrameProcessors=false`. `android/build.gradle` includes the plugin only when
both camera and worklets projects are autolinked and frame processors are enabled; policy-only consumers need neither.

## API

The package implements policy evaluation, JS guidance state processing, and Android image-quality frame analysis.
`VerificationResult` describes a planned photo-verification result; photo verification is not implemented.

### Runtime exports

- `evaluatePolicy(ruleResults: RuleResult[], policy: ParkingPolicy): { verdict: Verdict; score: number }`
  evaluates enabled rules and returns a verdict and score. See [Verdict rules](#verdict-rules).
- `defaultPolicy: ParkingPolicy` uses `version: 1`, `passThreshold: 0.75`, and the rule settings in the
  [policy example](#policy-format).
- `getModelVersion(): string` returns `"0.1.0-dev"` on iOS and Android.
- `useParkingGuidance(options?: GuidanceOptions): ParkingGuidance` returns `ready`, `issues`, `progress`,
  `onFrameResult`, and `reset`. See [Capture guidance](#capture-guidance).
- `createParkingFrameAnalyzer(VisionCameraProxy): ParkingFrameAnalyzer<Frame>` creates the `parkingGuide` plugin
  on the JS thread and returns a frame-processor worklet. Pass `VisionCameraProxy` from the app's VisionCamera import;
  the library does not import optional camera/worklets packages at runtime. Throws if the native plugin is unavailable.
- `CAPTURE_GUIDANCE_THRESHOLDS` contains the immutable native initialization thresholds listed below.
- `createGuidanceState(): GuidanceReducerState` creates independent smoothing/debounce history.
- `reduceGuidance(state: GuidanceReducerState, frame: GuidanceFrameResult, options?: GuidanceOptions): GuidanceReducerState`
  processes one frame without I/O, timers, or input mutation.

### Capture guidance

`useParkingGuidance` manages JS state; `createParkingFrameAnalyzer` supplies Android native image-quality analysis.
Neither API creates a camera or detects a vehicle. Analysis returns serializable `GuidanceFrameResult` objects
containing `ready`, `issues`, and `progress`.
Call `onFrameResult` in frame order on the **JS thread**. A Vision Camera worklet must use the app's
worklet-to-JS bridge to invoke it; do not call the React callback directly from a worklet or transfer camera
`Frame` objects to it. The app owns camera permissions, worklet setup, and the bridge. Native analysis runs
synchronously on VisionCamera's frame-processor thread, not the JS or main thread. It never retains, saves,
logs, or uploads frames, location, or sensor data.

After configuring VisionCamera 4 and Worklets Core, create one analyzer per capture session:

```tsx
import { useMemo } from 'react';
import {
  runAtTargetFps,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import {
  createParkingFrameAnalyzer,
  useParkingGuidance,
} from 'react-native-parking-guide';

export function useParkingFrameProcessor() {
  const guidance = useParkingGuidance();
  const { onFrameResult } = guidance;
  const analyze = useMemo(
    () => createParkingFrameAnalyzer(VisionCameraProxy),
    []
  );
  const deliver = useMemo(
    () => Worklets.createRunOnJS(onFrameResult),
    [onFrameResult]
  );
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runAtTargetFps(5, () => {
      'worklet';
      deliver(analyze(frame));
    });
  }, [analyze, deliver]);

  return { ...guidance, frameProcessor };
}
```

Pass `frameProcessor` to a VisionCamera `Camera` with `pixelFormat="yuv"`. Mount capture only while the app is
active and unmount it when capture stops, as in `example/src/App.android.tsx`.

The Android implementation matches the algorithms and values in the iOS implementation from
[PR #23](https://github.com/donminzzi/react-native-parking-guide/pull/23), commit
`3f284355f92f47a08c4ec8db50ea2c48153e8687`. `src/guidance/frameAnalyzer.ts` supplies all three thresholds:

| Constant field | Issue condition |
| --- | --- |
| `minLaplacianVariance = 100` | `BLURRY` when four-neighbor Laplacian population variance is strictly below `100`. |
| `minMeanLuminance = 50` | `LOW_LIGHT` when mean luminance is strictly below `50` on the `[0, 255]` scale. |
| `maxTiltRadians = Math.PI / 9` | `TILTED` when absolute pitch or roll deviation is strictly above `20` degrees. |

`android/src/main/java/com/parkingguide/CaptureMetrics.kt` samples the entire luma plane on a nearest-neighbor
grid of at most `160 × 120` pixels, excluding grid borders from Laplacian variance. It respects buffer position,
row padding, and pixel stride. `YUV_420_888` video-range luminance `[16, 235]` is normalized to `[0, 255]`.
On Android 13+, explicitly full-range image data is used directly; older versions and unspecified data ranges
are treated as video range. Unsupported formats or invalid planes return `{ ready: false, issues: [], progress: 0 }`.
These are image-quality heuristics, not calibrated guarantees of sharpness or exposure.

`SensorManager.TYPE_ROTATION_VECTOR` supplies a gravity direction on a dedicated `HandlerThread`. Pitch measures
deviation from vertical; roll measures deviation from the nearest upright portrait or landscape pose. Lying flat
is tilted. Missing sensors, samples older than `0.5` seconds, and non-finite motion never produce `ready: true`
and do not fabricate a `TILTED` issue. Progress is the fraction of the three checks that pass; unavailable motion
counts as a check not passed. Sensor listeners and their worker thread are released on host pause, host destruction,
TurboModule invalidation, or after one second without frames. After idle shutdown or host pause, analysis restarts
sensor updates on the next active-session frame.

`ready: true` means only that these three image-quality checks passed. It does not assert vehicle presence,
ground visibility, parking compliance, or a `PASS` verdict. ML-based issues remain out of scope.

#### Manual Android verification

Run `yarn example android` with an Android device or emulator providing a camera and rotation-vector sensor.
The Android example uses `example/src/App.android.tsx`; the iOS example retains `example/src/App.tsx` and does not
autolink the Android example's camera/worklets packages. Allow camera access and select **Start capture**.
Use a well-lit textured scene with the phone upright, then check each condition for at least three analyzed frames:
cover the lens for `LOW_LIGHT`, defocus or shake for `BLURRY`, and lean or rotate more than `20` degrees from the
nearest upright pose for `TILTED`. Multiple issues may appear simultaneously. Check portrait and landscape poses,
stop capture for at least two seconds, and restart to confirm fresh motion samples and reset guidance history.
Background the app to confirm capture stops; returning to the app must require **Start capture** again.
Emulators without a rotation-vector sensor cannot report readiness.

Device behavior cannot be verified in a cloud session. CI builds the Android example with the plugin enabled and
runs `:react-native-parking-guide:testDebugUnitTest` for native metric and boundary tests.

- Initial state and `reset()` output: `{ ready: false, issues: [], progress: 0 }`. Call `reset()` after stopping
  capture and before starting a new session; stop delivery of old-session results first. No timeout clears stale
  results automatically.
- `smoothingFactor` defaults to `0.25` and must be finite and greater than `0` and less than or equal to `1`.
  Each frame updates progress to `previous + smoothingFactor * (normalizedFrameProgress - previous)`.
  Frame progress is clamped to `[0, 1]`; `NaN` becomes `0`, positive infinity becomes `1`, and negative infinity
  becomes `0`. Output progress always remains in `[0, 1]`; it does not determine readiness.
- `debounceFrames` defaults to `3` and must be a positive safe integer. Issues are deduplicated and sorted.
  Commit an issue set only after `debounceFrames` consecutive frames have the same normalized issue set and
  readiness. Until then, retain the previously committed issues.
- A frame is ready only if its `ready` field is `true` and its issue set is empty. Output `ready` becomes `true`
  after `debounceFrames` consecutive ready frames. A non-ready frame revokes readiness immediately.
- Invalid options throw `RangeError` when processing a frame. Options apply to subsequent frames; use `reset()`
  when changing options if the previous smoothing/debounce history must be discarded.
- `onFrameResult` retains its identity while the two option values are unchanged; `reset` retains its identity
  for the lifetime of the hook.

### Exported types

These are the types exported by `src/index.tsx`. Numeric fields are TypeScript `number` values; unless a range is
stated below, this package does not validate a narrower range. No fields have implicit defaults unless explicitly
stated.

| Type | Values and fields |
| --- | --- |
| `VehicleType` | `'bicycle'`, `'ebike'`, `'kickboard'`, `'motorcycle'`, or `'auto'`. `'auto'` means detect the vehicle type automatically; it does not mean automobile. |
| `Verdict` | `'PASS'`, `'WARN'`, or `'FAIL'`. |
| `RuleId` | `'VEHICLE_DETECTED'`, `'UPRIGHT'`, `'TACTILE_PAVING'`, `'CROSSWALK'`, `'ROADWAY'`, `'SIDEWALK_BLOCK'`, `'PARKING_ZONE'`, `'GEOFENCE'`, or `'IMAGE_QUALITY'`. |
| `GuidanceIssue` | `'NO_VEHICLE'`, `'TOO_CLOSE'`, `'TOO_FAR'`, `'TILTED'`, `'BLURRY'`, `'LOW_LIGHT'`, or `'GROUND_NOT_VISIBLE'`. |
| `GuidanceState` | Required `ready: boolean`, `issues: GuidanceIssue[]`, and `progress: number`. Guidance processing returns progress in `[0, 1]`; initial values are `false`, `[]`, and `0`. |
| `GuidanceFrameResult` | Required `ready: boolean`, `issues: readonly GuidanceIssue[]`, and `progress: number`. Serializable frame-processor output delivered on the JS thread. |
| `GuidanceOptions` | Optional `smoothingFactor: number` (default `0.25`) and `debounceFrames: number` (default `3`); constraints are specified in [Capture guidance](#capture-guidance). |
| `GuidanceReducerState` | Required `guidance: GuidanceState`, `candidate: { ready: boolean; issues: GuidanceIssue[] }`, and `consecutiveFrames: number`. Initialize with `createGuidanceState()`. |
| `ParkingGuidance` | Extends `GuidanceState` with `onFrameResult(result: GuidanceFrameResult): void` and `reset(): void`. |
| `ParkingFrameAnalyzer<Frame>` | `(frame: Frame) => GuidanceFrameResult`; `Frame` is inferred from the injected VisionCamera proxy. Invoke only in a frame-processor worklet. |
| `RuleResult` | Required `id: RuleId`, `verdict: Verdict`, and `confidence: number`; optional `score: number`, `message: string`, and `evidence: { bbox?: number[]; maskUri?: string }`. `evaluatePolicy` clamps a numeric `score` to `[0, 1]`; it does not use `confidence`. |
| `RulePolicy` | Required `enabled: boolean`; optional `weight: number`, `severity: Verdict`, and `failBelow: number`. An omitted `weight` defaults to `1` in `evaluatePolicy`. |
| `ParkingPolicy` | Required `version: number`, `rules: Partial<Record<RuleId, RulePolicy>>`, and `passThreshold: number`. No version or threshold range validation is defined. |
| `VerificationResult` | Required `verdict: Verdict`, `score: number`, `rules: RuleResult[]`, `photo: { uri: string; width: number; height: number; sha256: string }`, and `metadata: { capturedAt: string; location?: { lat: number; lng: number; accuracy: number }; heading?: number; deviceTilt: { pitch: number; roll: number }; modelVersion: string; platform: 'ios' \| 'android'; attestation?: string }`. The type defines no additional numeric ranges or defaults. |

### Policy format

`ParkingPolicy.rules` is a partial map: an omitted rule has no policy entry and is ignored. Each configured rule
must specify `enabled`; `weight`, `severity`, and `failBelow` are optional.

This JSON object matches `ParkingPolicy` and has the same values as `defaultPolicy`:

```json
{
  "version": 1,
  "passThreshold": 0.75,
  "rules": {
    "VEHICLE_DETECTED": { "enabled": true, "weight": 1.2, "severity": "FAIL", "failBelow": 0.6 },
    "UPRIGHT": { "enabled": true, "weight": 1.1, "severity": "FAIL", "failBelow": 0.7 },
    "TACTILE_PAVING": { "enabled": true, "weight": 1, "severity": "FAIL", "failBelow": 0.9 },
    "CROSSWALK": { "enabled": true, "weight": 1, "severity": "FAIL", "failBelow": 0.9 },
    "ROADWAY": { "enabled": true, "weight": 1, "severity": "FAIL", "failBelow": 0.85 },
    "SIDEWALK_BLOCK": { "enabled": true, "weight": 1, "severity": "WARN", "failBelow": 0.8 },
    "PARKING_ZONE": { "enabled": true, "weight": 0.8, "severity": "WARN", "failBelow": 0.7 },
    "GEOFENCE": { "enabled": true, "weight": 1, "severity": "FAIL", "failBelow": 0.95 },
    "IMAGE_QUALITY": { "enabled": true, "weight": 0.9, "severity": "WARN", "failBelow": 0.6 }
  }
}
```

Use the exported API from TypeScript:

```ts
import {
  defaultPolicy,
  evaluatePolicy,
  getModelVersion,
} from 'react-native-parking-guide';
import type { RuleResult } from 'react-native-parking-guide';

const ruleResults: RuleResult[] = [
  { id: 'VEHICLE_DETECTED', verdict: 'PASS', confidence: 0.98 },
];
const evaluation = evaluatePolicy(ruleResults, defaultPolicy);
const modelVersion = getModelVersion();

export { evaluation, modelVersion };
```

### Verdict rules

`evaluatePolicy(ruleResults, policy)` applies these rules:

1. Ignore a result if `policy.rules` has no entry for its `id`, or that entry has `enabled: false`.
2. Use a numeric `RuleResult.score` clamped to `[0, 1]`. If `score` is omitted, derive it from `verdict`: `PASS` is
   `1`, `WARN` is `0.5`, and `FAIL` is `0`.
3. An omitted `weight` is `1`. If the sum of weights is positive, calculate the overall score as the weighted mean
   of non-ignored rule scores and clamp it to `[0, 1]`. If the sum of weights is zero or negative, including when
   every rule is ignored, the overall score is `1`.
4. Return `FAIL` if any non-ignored rule has `severity: 'FAIL'` and either its `verdict` is `FAIL` or its score is
   strictly less than its configured `failBelow`.
5. If no hard fail applies, return `PASS` when the overall score is greater than or equal to `passThreshold`;
   otherwise return `WARN`.

## Development

```sh
yarn
yarn typecheck
yarn lint
yarn test
yarn example ios
yarn example android
```

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
