# react-native-parking-guide

A React Native TurboModule library for iOS and Android. It guides users of rentable shared personal mobility
vehicles while they photograph their parked vehicle with the device camera, and returns a parking verdict of
`PASS`, `WARN`, or `FAIL`.

Supported vehicles are rentable shared personal mobility only: bicycles, electric-assist bicycles (e-bikes),
kickboards including electric kickboards, and motorcycles or mopeds. Cars are out of scope.

> **Status:** the policy evaluation engine (`evaluatePolicy`), JS capture-guidance state processing
> (`useParkingGuidance`), iOS image-quality frame analysis, and a native `getModelVersion()` stub are implemented.
> Android frame analysis, vehicle detection, and on-device inference are not implemented.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference: CoreML on iOS, TFLite on Android.
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.2 (M2)**: JS frame-result handoff, smoothed capture guidance, and iOS native frame analysis are implemented.
  Android native frame analysis remains planned.
- **v0.5**: prohibited-zone rules (tactile paving, crosswalk, roadway), geofence integration, additional guidance signals.
- **v1.0**: production on-device model pipeline, attestation support, upload and server-side verification integration.

## Installation

```sh
npm install react-native-parking-guide
```

`react-native-vision-camera@^4.7.3` is an optional peer dependency. Install it in the app only when using its
camera/frame processors; the policy engine and JS guidance logic do not import or require it.

For iOS capture guidance, also install `react-native-worklets-core@^1.6.3`, add
`react-native-worklets-core/plugin` to the app's Babel `plugins`, set `NSCameraUsageDescription` and
`NSMotionUsageDescription` in the app's `Info.plist`, and run `pod install`.
Worklets Core 1.6.3 also requires the Babel development dependencies
`@babel/plugin-proposal-optional-chaining@7.21.0` and
`@babel/plugin-proposal-nullish-coalescing-operator@7.18.6`.
`ParkingGuide.podspec` enables the plugin only when both camera and worklets packages resolve from the app
and `$VCEnableFrameProcessors` is not `false`. Do not disable VisionCamera frame processors when using this API.

## API

The package implements policy evaluation, JS guidance state processing, and iOS image-quality frame analysis.
`VerificationResult` describes a planned photo-verification result; no photo verification is implemented.

### Runtime exports

- `evaluatePolicy(ruleResults: RuleResult[], policy: ParkingPolicy): { verdict: Verdict; score: number }`
  evaluates enabled rules and returns a verdict and score. See [Verdict rules](#verdict-rules).
- `defaultPolicy: ParkingPolicy` uses `version: 1`, `passThreshold: 0.75`, and the rule settings in the
  [policy example](#policy-format).
- `getModelVersion(): string` returns `"0.1.0-dev"` on iOS and Android.
- `useParkingGuidance(options?: GuidanceOptions): ParkingGuidance` returns `ready`, `issues`, `progress`,
  `onFrameResult`, and `reset`. See [Capture guidance](#capture-guidance).
- `createParkingFrameAnalyzer(VisionCameraProxy): ParkingFrameAnalyzer<Frame>` creates an iOS VisionCamera plugin
  instance on the JS thread and returns a worklet that analyzes one frame. Import `VisionCameraProxy` from
  `react-native-vision-camera` in the app and pass it explicitly; the library has no runtime import of the
  optional camera package. The factory throws if the plugin is unavailable.
- `CAPTURE_GUIDANCE_THRESHOLDS` contains the named initialization values shared by iOS and future Android plugins.
- `createGuidanceState(): GuidanceReducerState` creates independent smoothing/debounce history.
- `reduceGuidance(state: GuidanceReducerState, frame: GuidanceFrameResult, options?: GuidanceOptions): GuidanceReducerState`
  processes one frame without I/O, timers, or input mutation.

### Capture guidance

`useParkingGuidance` manages JS-side state; `createParkingFrameAnalyzer` supplies iOS native analysis.
Neither API creates a camera or detects a vehicle. Analysis returns serializable `GuidanceFrameResult` objects
containing `ready`, `issues`, and `progress`.
Call `onFrameResult` in frame order on the **JS thread**. A Vision Camera worklet must use the app's
worklet-to-JS bridge to invoke it; do not call the React callback directly from a worklet or transfer camera
`Frame` objects to it. The app owns camera permissions, worklet setup, and the bridge. Frames are processed
synchronously on VisionCamera's frame-processor thread, never retained, saved, logged, or uploaded.

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

Pass `frameProcessor` to a VisionCamera `Camera` with `pixelFormat="yuv"`. Mount the capture component only while
capture is active, and unmount it when capture stops or the app enters the background, as in `example/src/App.tsx`.
The plugin stops CoreMotion updates when its one-second idle timer observes at least one second without frames,
and releases the timer and motion manager when the plugin is destroyed. No frame is captured by this timer.

`src/guidance/frameAnalyzer.ts` defines the single set of thresholds passed into native plugin initialization:

| Constant field | Issue condition |
| --- | --- |
| `minLaplacianVariance = 100` | `BLURRY` when the four-neighbor Laplacian population variance is strictly below `100`. |
| `minMeanLuminance = 50` | `LOW_LIGHT` when mean luminance is strictly below `50` on the `[0, 255]` scale. |
| `maxTiltRadians = Math.PI / 9` | `TILTED` when absolute pitch or roll deviation is strictly above `20` degrees. |

`cpp/CaptureMetrics.h` samples the entire luma plane on a nearest-neighbor grid of at most `160 × 120` pixels,
excludes grid borders from Laplacian variance, respects row padding, and normalizes video-range YUV `[16, 235]`
to `[0, 255]`. Full-range YUV is used directly. These are image-quality heuristics, not calibrated guarantees
of sharpness or exposure.
CoreMotion gravity determines pitch deviation from vertical and roll deviation from the nearest upright portrait
or landscape pose. A device lying flat is tilted. Motion samples older than `0.5` seconds, missing sensors, and
unsupported pixel formats never produce `ready: true`. Missing motion does not fabricate a `TILTED` issue.
Progress is the fraction of the three quality checks that pass; unavailable motion counts as a check not passed.
An invalid or unsupported image produces `{ ready: false, issues: [], progress: 0 }`.

`ready: true` means only that these three image-quality checks passed. It does not assert vehicle presence,
ground visibility, parking compliance, or a `PASS` verdict. ML-based guidance remains out of scope.

#### Manual iOS verification

Run `yarn example ios` with Xcode and a physical iOS device, allow camera access, and select **Start capture**.
Use a well-lit textured scene with the phone upright, then check each condition for at least three analyzed frames:
cover the lens for `LOW_LIGHT`, defocus or shake the camera for `BLURRY`, and rotate or lean the phone more than
`20` degrees away from an upright pose for `TILTED`. Conditions may produce multiple issues simultaneously.
Select **Stop capture** and restart to check that guidance history resets. Backgrounding the app must close capture.
Simulators without a camera or CoreMotion cannot verify all three signals. Native device behavior cannot be
verified in a Linux cloud session. CI tests the portable native metric implementation and builds the iOS example
with VisionCamera and Worklets Core, including compilation of `ios/ParkingGuideFrameProcessor.mm`.

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
| `ParkingFrameAnalyzer<Frame>` | `(frame: Frame) => GuidanceFrameResult`; `Frame` is inferred from the injected camera proxy. Invoke only inside a VisionCamera frame-processor worklet. |
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
