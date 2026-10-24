# react-native-parking-guide

A React Native TurboModule library for iOS and Android. It guides users of rentable shared personal mobility
vehicles while they photograph their parked vehicle with the device camera, and returns a parking verdict of
`PASS`, `WARN`, or `FAIL`.

Supported vehicles are rentable shared personal mobility only: bicycles, electric-assist bicycles (e-bikes),
kickboards including electric kickboards, and motorcycles or mopeds. Cars are out of scope.

> **Status:** early scaffold. The policy evaluation engine (`evaluatePolicy`), JS capture-guidance state
> processing (`useParkingGuidance`), and a native `getModelVersion()` stub are implemented. Native frame analysis,
> vehicle detection, and on-device inference are not implemented.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference: CoreML on iOS, TFLite on Android.
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.2 (M2)**: JS frame-result handoff, smoothed capture guidance, and native frame analysis (not yet implemented).
- **v0.5**: prohibited-zone rules (tactile paving, crosswalk, roadway), geofence integration, additional guidance signals.
- **v1.0**: production on-device model pipeline, attestation support, upload and server-side verification integration.

## Installation

```sh
npm install react-native-parking-guide
```

`react-native-vision-camera@^4.7.3` is an optional peer dependency. Install it in the app only when using its
camera/frame processors; the policy engine and JS guidance logic do not import or require it.

## API

The package implements policy evaluation and JS guidance state processing. `VerificationResult` describes a
planned photo-verification result; no photo verification or native frame analysis is implemented.

### Runtime exports

- `evaluatePolicy(ruleResults: RuleResult[], policy: ParkingPolicy): { verdict: Verdict; score: number }`
  evaluates enabled rules and returns a verdict and score. See [Verdict rules](#verdict-rules).
- `defaultPolicy: ParkingPolicy` uses `version: 1`, `passThreshold: 0.75`, and the rule settings in the
  [policy example](#policy-format).
- `getModelVersion(): string` returns `"0.1.0-dev"` on iOS and Android.
- `useParkingGuidance(options?: GuidanceOptions): ParkingGuidance` returns `ready`, `issues`, `progress`,
  `onFrameResult`, and `reset`. See [Capture guidance](#capture-guidance).
- `createGuidanceState(): GuidanceReducerState` creates independent smoothing/debounce history.
- `reduceGuidance(state: GuidanceReducerState, frame: GuidanceFrameResult, options?: GuidanceOptions): GuidanceReducerState`
  processes one frame without I/O, timers, or input mutation.

### Capture guidance

`useParkingGuidance` is the JS-side frame-processor scaffold. It does not create a camera, analyze a frame, or
detect a vehicle. Supply serializable `GuidanceFrameResult` objects containing `ready`, `issues`, and `progress`.
Call `onFrameResult` in frame order on the **JS thread**. A Vision Camera worklet must use the app's
worklet-to-JS bridge to invoke it; do not call the React callback directly from a worklet or transfer camera
`Frame` objects to it. The app owns camera permissions, worklet setup, analysis, and the bridge. No photos,
locations, or device data are logged, stored, or uploaded by this hook.

For a mock Vision Camera 4 frame processor, install and configure `react-native-worklets-core` in the app
according to Vision Camera's frame-processor setup instructions. The following scaffold always reports
`ready: false`; replace its mock object with native analysis output when that implementation is available:

```tsx
import { useMemo } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useParkingGuidance } from 'react-native-parking-guide';

export function useMockParkingFrameProcessor() {
  const guidance = useParkingGuidance();
  const { onFrameResult } = guidance;
  const deliver = useMemo(
    () => Worklets.createRunOnJS(onFrameResult),
    [onFrameResult]
  );
  const frameProcessor = useFrameProcessor(() => {
    'worklet';
    deliver({ ready: false, issues: [], progress: 0 });
  }, [deliver]);

  return { ...guidance, frameProcessor };
}
```

Pass `frameProcessor` to the app's Vision Camera `Camera` component and render `ready`, `issues`, and `progress`
in the app's UI. This scaffold does not replace native analysis and never signals that capture is ready.

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
