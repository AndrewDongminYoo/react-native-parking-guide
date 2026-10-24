# react-native-parking-guide

A React Native TurboModule library for iOS and Android. It guides users of rentable shared personal mobility
vehicles while they photograph their parked vehicle with the device camera, and returns a parking verdict of
`PASS`, `WARN`, or `FAIL`.

Supported vehicles are rentable shared personal mobility only: bicycles, electric-assist bicycles (e-bikes),
kickboards including electric kickboards, and motorcycles or mopeds. Cars are out of scope.

## Goal

After a ride, the rider photographs the parked vehicle in the host app.
The package decides on the device, without a network call, whether the vehicle stands upright in an allowed
location, so that the host app can give the rider immediate feedback before the rental ends.

The reference capture screen has a title that names the vehicle type (for example "Photograph your parked
kickboard"), a guide frame with a semi-transparent silhouette of that vehicle type, a shutter button, a torch toggle,
and a close button. The host app owns this screen, its copy, and its localization; the package supplies guidance
state, per-rule results, and the verdict. `example/` demonstrates the screen.

1. **Capture guidance**: enable the shutter only when the target vehicle is inside the guide frame at a usable
   distance, the ground around it is visible, and the image is sharp, bright enough, and level (`GuidanceIssue`).
2. **Parking judgment**: from the captured photo, decide whether the vehicle is detected (`VEHICLE_DETECTED`),
   stands upright (`UPRIGHT`), is not on tactile paving, a crosswalk, or a roadway and does not block the pedestrian
   passage (`TACTILE_PAVING`, `CROSSWALK`, `ROADWAY`, `SIDEWALK_BLOCK`), and is inside a designated parking zone
   or geofence (`PARKING_ZONE`, `GEOFENCE`).
3. **Immediate feedback**: return `PASS`, `WARN`, or `FAIL` with the per-rule `RuleResult[]`, so that the host app
   can tell the rider which rule failed and how to correct the parking.

### Implementation status

| Goal step | Implemented | Not implemented |
| --- | --- | --- |
| 1. Capture guidance | `useParkingGuidance`, `createParkingFrameAnalyzer`, iOS and Android image-quality analysis (`BLURRY`, `LOW_LIGHT`, `TILTED`), and `mapGuidanceIssues` (model output → `NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, `GROUND_NOT_VISIBLE`) | Producing model-based issues from camera frames (requires on-device inference); use of `VehicleType` by any API |
| 2. Parking judgment | `mapModelOutput` (model output → `RuleResult[]`, with target-vehicle selection inside `MappingOptions.guideFrame` and a `TACTILE_PAVING`/`CROSSWALK` proximity flag in `evidence.proximity`), `evaluateGeofence` (caller-supplied location and zones → `GEOFENCE`), `evaluatePolicy`, `validatePolicy`, `defaultPolicy` | A model and on-device inference (CoreML on iOS, TFLite on Android); reading device location or fetching zone data |
| 3. Immediate feedback | `Verdict`, score, and `RuleResult[]` from `evaluatePolicy` and `mapModelOutput`; `getParkingFeedback` (feedback keys and default English text for failed, warned, or unchecked rules and for each `GuidanceIssue`) | A result screen in the example app; photo capture into `VerificationResult` |

`getModelVersion()` is a native stub that returns `"0.1.0-dev"`.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference: CoreML on iOS, TFLite on Android.
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.2 (M2)**: JS frame-result handoff, smoothed capture guidance, and iOS and Android image-quality frame analysis
  are implemented.
- **v0.5**: a vehicle and prohibited-zone model with on-device inference, model-based capture guidance from camera
  frames (`NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, `GROUND_NOT_VISIBLE`), prohibited-zone rules (tactile paving, crosswalk, roadway, sidewalk block,
  parking zone), and geofence integration.
- **v1.0**: photo capture into `VerificationResult`, a rider-facing result screen in the example app, attestation support,
  and opt-in upload and server-side verification integration.

## Installation

```sh
npm install react-native-parking-guide
```

`react-native-vision-camera@^4.7.3` is an optional peer dependency. Install it in the app only when using its
camera/frame processors; the policy engine and JS guidance logic do not import or require it.

For capture guidance, install `react-native-worklets-core@1.6.3` and add
`react-native-worklets-core/plugin` to the app's Babel `plugins`. Worklets Core 1.6.3 requires
`@babel/plugin-proposal-optional-chaining@7.21.0` and
`@babel/plugin-proposal-nullish-coalescing-operator@7.18.6` as Babel development dependencies.
Declare `android.permission.CAMERA` in the app's manifest and request camera permission before mounting `Camera`.
Do not set `VisionCamera_enableFrameProcessors=false`. `android/build.gradle` includes the plugin only when
both camera and worklets projects are autolinked and frame processors are enabled; policy-only consumers need neither.

For iOS capture guidance, set `NSCameraUsageDescription` and
`NSMotionUsageDescription` in the app's `Info.plist`, and run `pod install`.
`ParkingGuide.podspec` enables the plugin only when both camera and worklets packages resolve from the app
and `$VCEnableFrameProcessors` is not `false`. Do not disable VisionCamera frame processors when using this API.

## API

The package implements policy validation and evaluation, model-output mapping, JS guidance state processing, and iOS
and Android image-quality frame analysis.
`VerificationResult` describes a planned photo-verification result; no photo verification is implemented.

### Runtime exports

- `evaluatePolicy(ruleResults: RuleResult[], policy: ParkingPolicy): { verdict: Verdict; score: number }`
  evaluates enabled rules and returns a verdict and score. See [Verdict rules](#verdict-rules).
- `validatePolicy(input: unknown): PolicyValidationResult` returns a `ParkingPolicy` when `input` is valid, and
  otherwise a non-empty `string[]` of error messages. It requires a finite `version`, a `passThreshold` in `[0, 1]`,
  and a `rules` object whose keys are `RuleId` values. Each rule requires a boolean `enabled`; an optional `weight`
  must be finite and greater than or equal to `0`, an optional `severity` must be a `Verdict`, and an optional
  `failBelow` must be in `[0, 1]`. Properties other than `version`, `passThreshold`, `rules`, and the four rule
  fields are not copied to the returned policy.
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
- `mapModelOutput(output: RawModelOutput, options?: MappingOptions): RuleResult[]` converts a complete scene prediction
  into eight rule results without executing a model. See [Model-output mapping](#model-output-mapping).
- `DEFAULT_MAPPING_THRESHOLDS` contains the immutable score thresholds listed below.
- `DEFAULT_PROXIMITY_THRESHOLD` (`1`) is the default `MappingOptions.proximityThreshold` described below.
- `mapGuidanceIssues(output: RawModelOutput, options?: GuidanceMappingOptions): GuidanceIssue[]` converts one frame's
  model output into model-based capture guidance issues. See [Model-based capture guidance](#model-based-capture-guidance).
- `DEFAULT_GUIDANCE_THRESHOLDS` contains the immutable guidance thresholds listed below.
- `evaluateGeofence(location: GeoLocation | undefined, zones: readonly GeofenceZone[], options?: GeofenceOptions): RuleResult`
  returns the `GEOFENCE` result for a caller-supplied location and zones. See [Geofence](#geofence).
- `DEFAULT_MAX_GEOFENCE_ACCURACY` (`50`) is the default `GeofenceOptions.maxAccuracy` in meters.
- `getParkingFeedback(input: FeedbackInput, options?: FeedbackOptions): ParkingFeedback[]` converts rule results and
  guidance issues into ordered rider-facing feedback entries. See [Rider feedback](#rider-feedback).
- `DEFAULT_FEEDBACK_TEXT` contains the immutable default English text for every feedback key listed below.

### Model-output mapping

`src/inference/mapping.ts` defines platform-neutral, serializable model output types. Model adapters must supply
a complete scene prediction: `detections` contains instances of `vehicle`, `tactile_paving`, `crosswalk`, `roadway`,
`sidewalk_block`, and `parking_zone`. An absent class means no detection, not an unexecuted model head.
`vehicle` includes only the shared personal mobility categories listed above, not cars. `sidewalk_block`
represents the model's predicted obstructed pedestrian passage, not every sidewalk surface.

Each `ModelDetection` has `classId`, `confidence`, and `box`. A `ModelBox` is
`[left, top, right, bottom]`, normalized to `[0, 1]` with the origin at the top-left of the upright image.
All boxes and masks must describe that same image after orientation correction. An optional `ModelMask` contains
positive integer `width` and `height` and row-major binary `data` (`0` or `1`) for the **entire image**, not a crop.
All masks in one output must have identical dimensions; data length must equal `width * height`.
Zero-area boxes and detections with empty masks are ignored.

Optional `upright: ModelAssessment` on each vehicle measures vehicle uprightness, not camera tilt.
Optional `imageQuality: ModelAssessment` on `RawModelOutput` measures image suitability; the mapper does not
derive it from capture-guidance issues. Each assessment has `score` (higher means more compliant) and `confidence`.
All input scores, confidences, coordinates, `minimumConfidence`, and `failBelow`/`passAt` thresholds must be finite
and in `[0, 1]`; `proximityThreshold` has its own range, described below.
Invalid numeric values, inverted boxes, malformed masks, mismatched mask grids, and `failBelow > passAt`
throw `RangeError`; the mapper never clamps invalid model input.

`minimumConfidence` defaults to `0.5`. Detections and assessments strictly below it are ignored.
Without `MappingOptions.guideFrame`, the mapper selects the accepted nonempty vehicle with the highest confidence,
retaining the first on ties. `guideFrame` is the capture guide frame as a `ModelBox` in the same image space; it must
have a positive area (`left < right`, `top < bottom`), otherwise the mapper throws `RangeError`. With `guideFrame`,
only vehicles whose **box** (not mask) intersects the frame with a positive area are candidates. The mapper selects
the candidate with the largest intersection area, rounded half up to 6 decimal places like zone scores, then the
highest confidence, then the first in `detections` order. If no vehicle intersects the frame, no vehicle is selected.
Only that vehicle's `upright` assessment is used. A returned vehicle `evidence.bbox` is a fresh normalized
`[left, top, right, bottom]` array.

For each zone class, overlap is `area(vehicle ∩ union(accepted zones)) / area(vehicle)`, not intersection-over-union.
Overlapping zone instances count only once. If the vehicle and **every accepted instance of that zone class**
have masks, overlap uses foreground pixels. Otherwise it uses the exact union of box intersections.
`PARKING_ZONE.score` is overlap; `TACTILE_PAVING`, `CROSSWALK`, `ROADWAY`, and `SIDEWALK_BLOCK` scores are
`1 - overlap`. With no accepted zone instances, these scores are respectively `0` and `1`.
Zone scores are rounded half up to 6 decimal places before the threshold comparison
(`Math.round(score * 1e6 + 1e-6) / 1e6`; the `1e-6` term rounds up a value up to `1e-12` below a halfway point).
Floating-point error in box arithmetic therefore cannot move a score across a threshold that has at most
6 decimal places: a 10% overlap yields exactly `0.9`, not `0.8999999999999999`. A threshold with more than
6 decimal places is compared with the rounded score, so it acts like the next 6-decimal value up: with
`failBelow: 0.9000001`, an exact score of `0.9000004` rounds to `0.9` and yields `FAIL`.
These are geometric compliance scores, not calibrated probabilities.

`VEHICLE_DETECTED.score` equals the selected vehicle's confidence. `UPRIGHT.score` and `IMAGE_QUALITY.score`
come directly from their assessments. Zone confidence is the minimum of the selected vehicle's confidence
and all accepted instances of that zone class; if none exist, it is the vehicle's confidence.
Assessment rules retain their assessment confidence. Confidence is diagnostic and does not weight the policy score.

| Rule | `failBelow` | `passAt` |
| --- | --- | --- |
| `VEHICLE_DETECTED`, `UPRIGHT`, `PARKING_ZONE`, `IMAGE_QUALITY` | `0.5` | `0.8` |
| `TACTILE_PAVING`, `CROSSWALK`, `ROADWAY` | `0.9` | `0.99` |
| `SIDEWALK_BLOCK` | `0.8` | `0.95` |

For an available rule, score strictly below `failBelow` gives `FAIL`; score greater than or equal to `passAt`
gives `PASS`; all other scores give `WARN`. Override individual pairs through `MappingOptions.thresholds`.
Without an accepted vehicle, `VEHICLE_DETECTED` is `FAIL` with score/confidence `0`; `UPRIGHT` and the five
zone rules are `WARN` with score/confidence `0`. Missing or ignored assessments are also `WARN` with
score/confidence `0`, so unknown evidence cannot increase the overall score.
`IMAGE_QUALITY` can still be evaluated without a vehicle.

Overlap alone reports nothing for a vehicle parked right beside tactile paving or a crosswalk. For `TACTILE_PAVING`
and `CROSSWALK` only, when a vehicle is selected and at least one accepted instance of the zone class exists,
the result has `evidence.proximity: ZoneProximity` with:

- `distance`: the smallest Euclidean gap between the vehicle **box** and an accepted zone **box** (`0` when they touch
  or overlap), divided by the longer side of the vehicle box, then rounded half up to 6 decimal places like zone
  scores. Boxes are used even when masks exist. The value is in normalized image coordinates, not meters, and does
  not correct for perspective or image aspect ratio.
- `near`: `true` when `distance` is less than or equal to `MappingOptions.proximityThreshold`, otherwise `false`.

`proximityThreshold` defaults to `DEFAULT_PROXIMITY_THRESHOLD` (`1`, one vehicle box longer side). It must be finite
and greater than or equal to `0`, otherwise the mapper throws `RangeError`; values above `1` are allowed.
Proximity never changes `score`, `verdict`, or `confidence`, and `evaluatePolicy` and `getParkingFeedback` ignore it.
The host app decides how to handle `near`, for example by warning the rider about a local rule such as a no-parking
distance from a crosswalk. Without a selected vehicle or an accepted zone instance of the class, `evidence` is absent.

Results always appear in this order: `VEHICLE_DETECTED`, `UPRIGHT`, `TACTILE_PAVING`, `CROSSWALK`, `ROADWAY`,
`SIDEWALK_BLOCK`, `PARKING_ZONE`, `IMAGE_QUALITY`. `GEOFENCE` is not inferred from image data.
The mapper is synchronous, deterministic, and does not mutate inputs, perform I/O, or access native APIs.
`evaluatePolicy` remains unchanged: its configured severity and `failBelow` can hard-fail a mapper `WARN`.

```ts
import { defaultPolicy, evaluatePolicy, mapModelOutput } from 'react-native-parking-guide';
import type { RawModelOutput } from 'react-native-parking-guide';

const output: RawModelOutput = {
  detections: [
    {
      classId: 'vehicle',
      confidence: 0.95,
      box: [0.2, 0.1, 0.8, 0.9],
      upright: { score: 0.95, confidence: 0.9 },
    },
    { classId: 'parking_zone', confidence: 0.9, box: [0, 0, 1, 1] },
  ],
  imageQuality: { score: 0.9, confidence: 0.95 },
};
const rules = mapModelOutput(output, {
  minimumConfidence: 0.5,
  thresholds: { CROSSWALK: { failBelow: 0.95, passAt: 0.99 } },
});
const result = evaluatePolicy(rules, defaultPolicy);
```

### Geofence

`evaluateGeofence(location, zones)` is pure and deterministic, does not mutate its input, and never reads device
location or fetches zone data; the caller supplies both. It returns one `RuleResult` with `id: 'GEOFENCE'`.

- `GeoPoint` has WGS 84 `lat` in `[-90, 90]` and `lng` in `[-180, 180]`, in degrees. `GeoLocation` adds `accuracy`,
  the horizontal accuracy radius in meters (finite and `>= 0`), so `VerificationResult.metadata.location` is a valid
  `GeoLocation`.
- `GeofenceZone` has `kind: 'allowed' | 'prohibited'` and `polygon: readonly GeoPoint[]` with at least 3 vertices.
  The ring closes implicitly (repeating the first vertex is allowed), and inside is decided by the even-odd rule.
- `GeofenceOptions.maxAccuracy` defaults to `DEFAULT_MAX_GEOFENCE_ACCURACY` (`50` m). It must not be `NaN` and must
  be `>= 0`; `Infinity` disables the limit.
- Invalid coordinates, accuracy, `maxAccuracy`, zone kinds, and polygons that are not arrays, have fewer than
  3 vertices, or contain a hole or a non-object vertex throw `RangeError`. Zones are validated even when `location` is
  `undefined`.

Each zone is classified relative to the location. The function projects the vertices onto a plane tangent at the
location (mean Earth radius `6371008.8` m) and computes the shortest distance from the location to the polygon
boundary. Longitudes are unwrapped along each ring, so a zone may cross the antimeridian, and each ring is placed at the
360° copy nearest the location, so a zone on the opposite side of the Earth stays far away. Edges are straight lines in
that projection, which is accurate for zones up to a few kilometers across that are near the location.

- `uncertain`: the boundary distance is less than or equal to `accuracy`.
- `inside` or `outside`: otherwise, by the even-odd rule.

The result is the first match in this list:

1. `location` is `undefined`, or `location.accuracy` is greater than `maxAccuracy`: `WARN` with `score: 0` and
   `confidence: 0` (unchecked, like an unevaluated mapper rule). A coarse fix, such as a reduced-precision location
   when the rider has turned off precise location, therefore cannot make every nearby boundary uncertain.
2. Any `prohibited` zone is `inside`, or at least one `allowed` zone exists and every `allowed` zone is `outside`:
   `FAIL` with `score: 0` and `confidence: 1`.
3. Any `prohibited` zone is `uncertain`, or at least one `allowed` zone exists and no `allowed` zone is `inside`:
   `WARN` with `score: 0.5` and `confidence: 1`.
4. Otherwise, including when `zones` is empty: `PASS` with `score: 1` and `confidence: 1`.

`defaultPolicy.rules.GEOFENCE` has `severity: 'FAIL'` and `failBelow: 0.5`, so rules 1 and 2 hard-fail
`evaluatePolicy`, and rule 3 (a boundary lies within an accuracy of at most `maxAccuracy`) does not: the rider cannot
correct GPS error at a zone boundary. A rule 3 `WARN` lowers the weighted score by at most `0.5 × 1 / 9` (about `0.056`)
with every other `defaultPolicy` rule passing, so the overall verdict can still be `PASS`; `getParkingFeedback` still
returns `rule.GEOFENCE.WARN`. To skip the geofence check, do not pass a `GEOFENCE` result to `evaluatePolicy`.

### Model-based capture guidance

`mapGuidanceIssues` is pure and deterministic: it does not execute a model, read the camera, or mutate its input.
It validates `output`, `minimumConfidence` (default `0.5`), and `guideFrame` exactly as `mapModelOutput` does and
selects the vehicle exactly as `mapModelOutput` does with the same `minimumConfidence` and `guideFrame`.

- If no vehicle is selected, it returns `['NO_VEHICLE']` and no other issue.
- Otherwise, let the frame be `guideFrame`, or `[0, 0, 1, 1]` when `guideFrame` is not set.
  - The fill ratio is the larger of (vehicle box width / frame width) and (vehicle box height / frame height).
    It uses the larger extent, not the area, so a tall, thin kickboard that spans the frame height is `TOO_CLOSE`.
    `TOO_FAR` is reported when the fill ratio is strictly below `tooFarBelow`; `TOO_CLOSE` when it is strictly above
    `tooCloseAbove`.
  - The ground gap is (frame bottom − vehicle box bottom) / frame height. It is negative when the vehicle box extends
    below the frame. `GROUND_NOT_VISIBLE` is reported when the ground gap is strictly below `groundMarginBelow`: the
    vehicle box bottom is then less than `groundMarginBelow` frame heights above the frame bottom, or below it, so too
    little ground below the vehicle is inside the frame.
  - Both ratios are rounded half up to 6 decimal places before comparison, like zone scores.
  - The result lists `TOO_FAR` or `TOO_CLOSE` (at most one) first, then `GROUND_NOT_VISIBLE`. An empty array means no
    model-based issue.

| Threshold | Default |
| --- | --- |
| `tooFarBelow` | `0.4` |
| `tooCloseAbove` | `0.95` |
| `groundMarginBelow` | `0.05` |

Override individual values through `GuidanceMappingOptions.thresholds`; an omitted or `undefined` value uses the
default. `tooFarBelow` and `tooCloseAbove` must be
finite with `0 <= tooFarBelow <= tooCloseAbove`; `groundMarginBelow` must be finite and in [0, 1]. Otherwise
`mapGuidanceIssues` throws `RangeError`. Ground visibility is geometric: the model taxonomy has no ground class.
Native frame analysis does not call `mapGuidanceIssues` yet, because on-device inference is not implemented.

### Rider feedback

`getParkingFeedback` is pure and deterministic and does not mutate its input. `FeedbackInput` has
`rules: readonly RuleResult[]` and optional `issues: readonly GuidanceIssue[]`; a `VerificationResult` is a valid input.

Rule entries have the shape `{ kind: 'rule', key: 'rule.<RuleId>.<FAIL|WARN|UNCHECKED>', ruleId, verdict, text }`.

1. A rule result whose `id` is not a `RuleId` is omitted.
2. When `FeedbackOptions.policy` is set, a rule result that `evaluatePolicy` ignores (no entry in `policy.rules`, or
   `enabled: false`) is omitted.
3. The effective verdict is the result's `verdict` if it is `FAIL` or `WARN`. When `FeedbackOptions.policy` is set and
   the result alone makes `evaluatePolicy` return `FAIL` (its rule has `severity: 'FAIL'` and the result's verdict is
   `FAIL` or its score is strictly less than `failBelow`), the effective verdict is `FAIL`, even for a `PASS` result.
   A result without an effective verdict is omitted.
4. The key suffix depends only on the result's own `verdict`, so policy escalation never makes the text more certain
   than the result: `FAIL` gives `FAIL`; `WARN` with `confidence` `0` gives `UNCHECKED`, which `mapModelOutput` emits
   when it could not evaluate the rule; any other `WARN` or an escalated `PASS` gives `WARN`. Exception: a
   `VEHICLE_DETECTED` `FAIL` with `evidence.bbox` gives `WARN`, because `mapModelOutput` sets `evidence.bbox` only when it
   located a vehicle, and then `FAIL` means that the detection confidence is below the `VEHICLE_DETECTED` threshold.
5. Each `RuleId` produces at most one entry. Among its results, an effective verdict of `FAIL` is preferred over `WARN`;
   with the same effective verdict, the suffix `FAIL` is preferred over `WARN` and `WARN` over `UNCHECKED`; the first
   result is preferred over later equal results.
6. If a non-omitted `VEHICLE_DETECTED` result has its own `verdict` `FAIL` and no `evidence.bbox`, entries for
   `UPRIGHT`, `TACTILE_PAVING`, `CROSSWALK`, `ROADWAY`, `SIDEWALK_BLOCK`, and `PARKING_ZONE` are omitted, because they
   describe a vehicle that was not found. A `VEHICLE_DETECTED` result that is `FAIL` only through policy escalation, or
   that has `evidence.bbox`, does not omit them.

Each distinct `GuidanceIssue` in `issues` produces `{ kind: 'guidance', key: 'guidance.<GuidanceIssue>', issue, text }`.
Guidance issues are not filtered by the policy. Values outside `GuidanceIssue` are omitted.

Order: rule entries with effective verdict `FAIL`, then rule entries with effective verdict `WARN`, each in `RuleId`
declaration order (`VEHICLE_DETECTED`, `UPRIGHT`, `TACTILE_PAVING`, `CROSSWALK`, `ROADWAY`, `SIDEWALK_BLOCK`,
`PARKING_ZONE`, `GEOFENCE`, `IMAGE_QUALITY`), then guidance entries in `GuidanceIssue` declaration order (`NO_VEHICLE`,
`TOO_CLOSE`, `TOO_FAR`, `TILTED`, `BLURRY`, `LOW_LIGHT`, `GROUND_NOT_VISIBLE`).

`text` is the default English text from `DEFAULT_FEEDBACK_TEXT`. Keys are stable; localize by `key` in the host app.

| Key | Default English text |
| --- | --- |
| `rule.VEHICLE_DETECTED.FAIL` | No vehicle found in the photo. Retake it with the whole vehicle in the frame. |
| `rule.VEHICLE_DETECTED.WARN` | The vehicle is hard to recognize. Retake the photo with the whole vehicle in the frame. |
| `rule.VEHICLE_DETECTED.UNCHECKED` | Could not check for a vehicle. Retake the photo with the whole vehicle in the frame. |
| `rule.UPRIGHT.FAIL` | The vehicle has fallen over. Stand it upright on its kickstand. |
| `rule.UPRIGHT.WARN` | The vehicle may not be upright. Make sure it stands on its kickstand. |
| `rule.UPRIGHT.UNCHECKED` | Could not check whether the vehicle is upright. Retake the photo with the whole vehicle in the frame. |
| `rule.TACTILE_PAVING.FAIL` | The vehicle is on tactile paving for visually impaired pedestrians. Move it off the paving. |
| `rule.TACTILE_PAVING.WARN` | The vehicle may be on tactile paving. Make sure it is clear of the paving. |
| `rule.TACTILE_PAVING.UNCHECKED` | Could not check for tactile paving. Retake the photo with the ground around the vehicle in the frame. |
| `rule.CROSSWALK.FAIL` | The vehicle is on a crosswalk. Move it off the crosswalk. |
| `rule.CROSSWALK.WARN` | The vehicle may be on a crosswalk. Make sure it is clear of the crosswalk. |
| `rule.CROSSWALK.UNCHECKED` | Could not check for a crosswalk. Retake the photo with the ground around the vehicle in the frame. |
| `rule.ROADWAY.FAIL` | The vehicle is on the road. Move it off the road. |
| `rule.ROADWAY.WARN` | The vehicle may be on the road. Make sure it is off the road. |
| `rule.ROADWAY.UNCHECKED` | Could not check whether the vehicle is on the road. Retake the photo with the ground around the vehicle in the frame. |
| `rule.SIDEWALK_BLOCK.FAIL` | The vehicle blocks the sidewalk. Move it to the edge so people can pass. |
| `rule.SIDEWALK_BLOCK.WARN` | The vehicle may block the sidewalk. Make sure people can pass. |
| `rule.SIDEWALK_BLOCK.UNCHECKED` | Could not check whether the vehicle blocks the sidewalk. Retake the photo with the ground around the vehicle in the frame. |
| `rule.PARKING_ZONE.FAIL` | The vehicle is outside the parking zone. Move it inside the marked zone. |
| `rule.PARKING_ZONE.WARN` | The vehicle may be outside the parking zone. Make sure it is fully inside the marked zone. |
| `rule.PARKING_ZONE.UNCHECKED` | Could not check the parking zone. Retake the photo with the ground around the vehicle in the frame. |
| `rule.GEOFENCE.FAIL` | Parking is not allowed here. Move the vehicle to an allowed parking area. |
| `rule.GEOFENCE.WARN` | Parking may not be allowed here. Check the map for allowed parking areas. |
| `rule.GEOFENCE.UNCHECKED` | Could not check the parking location. Turn on precise location access and try again. |
| `rule.IMAGE_QUALITY.FAIL` | The photo is too unclear to check. Retake it in better light and hold the phone steady. |
| `rule.IMAGE_QUALITY.WARN` | The photo may be too unclear to check. Retake it in better light and hold the phone steady. |
| `rule.IMAGE_QUALITY.UNCHECKED` | Could not check the photo quality. Retake the photo. |
| `guidance.NO_VEHICLE` | Point the camera at the vehicle. |
| `guidance.TOO_CLOSE` | Move back so the whole vehicle fits in the frame. |
| `guidance.TOO_FAR` | Move closer to the vehicle. |
| `guidance.TILTED` | Hold the phone upright and straight. |
| `guidance.BLURRY` | Hold the phone steady. |
| `guidance.LOW_LIGHT` | It is too dark. Move to a brighter spot. |
| `guidance.GROUND_NOT_VISIBLE` | Show the ground under the vehicle in the frame. |

### Capture guidance

`useParkingGuidance` manages JS state; `createParkingFrameAnalyzer` supplies iOS and Android native image-quality analysis.
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
active and unmount it when capture stops, as in `example/src/App.android.tsx` (Android) and `example/src/App.tsx` (iOS).

The Android implementation matches the algorithms and values in `cpp/CaptureMetrics.h` and
`ios/ParkingGuideFrameProcessor.mm`. `src/guidance/frameAnalyzer.ts` supplies all three thresholds:

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
ground visibility, parking compliance, or a `PASS` verdict. Native analysis does not produce model-based issues
(`NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, `GROUND_NOT_VISIBLE`); see [Model-based capture guidance](#model-based-capture-guidance).

#### Manual Android verification

Run `yarn example android` with an Android device or emulator providing a camera and rotation-vector sensor.
The Android example uses `example/src/App.android.tsx`. Allow camera access and select **Start capture**.
Use a well-lit textured scene with the phone upright, then check each condition for at least three analyzed frames:
cover the lens for `LOW_LIGHT`, defocus or shake for `BLURRY`, and lean or rotate more than `20` degrees from the
nearest upright pose for `TILTED`. Multiple issues may appear simultaneously. Check portrait and landscape poses,
stop capture for at least two seconds, and restart to confirm fresh motion samples and reset guidance history.
Background the app to confirm capture stops; returning to the app must require **Start capture** again.
Emulators without a rotation-vector sensor cannot report readiness.

Device behavior cannot be verified in a cloud session. CI builds the Android example with the plugin enabled and
runs `:react-native-parking-guide:testDebugUnitTest` for native metric and boundary tests.
`cpp/CaptureMetrics.h` samples the entire luma plane on a nearest-neighbor grid of at most `160 × 120` pixels,
excludes grid borders from Laplacian variance, respects row padding, and normalizes video-range YUV `[16, 235]`
to `[0, 255]`. Full-range YUV is used directly. These are image-quality heuristics, not calibrated guarantees
of sharpness or exposure.
CoreMotion gravity determines pitch deviation from vertical and roll deviation from the nearest upright portrait
or landscape pose. A device lying flat is tilted. Motion samples older than `0.5` seconds, missing sensors, and
unsupported pixel formats never produce `ready: true`. Missing motion does not fabricate a `TILTED` issue.
Progress is the fraction of the three quality checks that pass; unavailable motion counts as a check not passed.
An invalid or unsupported image produces `{ ready: false, issues: [], progress: 0 }`.
The iOS plugin stops CoreMotion updates when its one-second idle timer observes at least one second without frames,
and releases the timer and motion manager when the plugin is destroyed. No frame is captured by this timer.

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
| `VehicleType` | `'bicycle'`, `'ebike'`, `'kickboard'`, `'motorcycle'`, or `'auto'`. `'auto'` means detect the vehicle type automatically; it does not mean automobile. No exported function accepts `VehicleType` yet (not implemented). |
| `Verdict` | `'PASS'`, `'WARN'`, or `'FAIL'`. |
| `RuleId` | `'VEHICLE_DETECTED'`, `'UPRIGHT'`, `'TACTILE_PAVING'`, `'CROSSWALK'`, `'ROADWAY'`, `'SIDEWALK_BLOCK'`, `'PARKING_ZONE'`, `'GEOFENCE'`, or `'IMAGE_QUALITY'`. |
| `GuidanceIssue` | `'NO_VEHICLE'`, `'TOO_CLOSE'`, `'TOO_FAR'`, `'TILTED'`, `'BLURRY'`, `'LOW_LIGHT'`, or `'GROUND_NOT_VISIBLE'`. Native analysis produces only `'TILTED'`, `'BLURRY'`, and `'LOW_LIGHT'`; `mapGuidanceIssues` produces the other four from model output. |
| `GuidanceState` | Required `ready: boolean`, `issues: GuidanceIssue[]`, and `progress: number`. Guidance processing returns progress in `[0, 1]`; initial values are `false`, `[]`, and `0`. |
| `GuidanceFrameResult` | Required `ready: boolean`, `issues: readonly GuidanceIssue[]`, and `progress: number`. Serializable frame-processor output delivered on the JS thread. |
| `GuidanceOptions` | Optional `smoothingFactor: number` (default `0.25`) and `debounceFrames: number` (default `3`); constraints are specified in [Capture guidance](#capture-guidance). |
| `GuidanceReducerState` | Required `guidance: GuidanceState`, `candidate: { ready: boolean; issues: GuidanceIssue[] }`, and `consecutiveFrames: number`. Initialize with `createGuidanceState()`. |
| `ParkingGuidance` | Extends `GuidanceState` with `onFrameResult(result: GuidanceFrameResult): void` and `reset(): void`. |
| `ParkingFrameAnalyzer<Frame>` | `(frame: Frame) => GuidanceFrameResult`; `Frame` is inferred from the injected camera proxy. Invoke only inside a VisionCamera frame-processor worklet. |
| `RuleResult` | Required `id: RuleId`, `verdict: Verdict`, and `confidence: number`; optional `score: number`, `message: string`, and `evidence: { bbox?: number[]; maskUri?: string; proximity?: ZoneProximity }`. `evaluatePolicy` clamps a numeric `score` to `[0, 1]`; it does not use `confidence`. |
| `ZoneProximity` | Required `distance: number` (`>= 0`) and `near: boolean`. See [Model-output mapping](#model-output-mapping). |
| `RulePolicy` | Required `enabled: boolean`; optional `weight: number`, `severity: Verdict`, and `failBelow: number`. An omitted `weight` defaults to `1` in `evaluatePolicy`. |
| `ParkingPolicy` | Required `version: number`, `rules: Partial<Record<RuleId, RulePolicy>>`, and `passThreshold: number`. `evaluatePolicy` does not validate ranges; `validatePolicy` checks them as listed in [Runtime exports](#runtime-exports). |
| `PolicyValidationResult` | `ParkingPolicy \| string[]`. A `string[]` contains one message per validation error. |
| `FeedbackInput`, `FeedbackKey`, `FeedbackOptions`, `FeedbackVerdict`, `GuidanceFeedbackKey`, `ParkingFeedback`, `RuleFeedbackKey`, `RuleFeedbackStatus` | Rider feedback types. See [Rider feedback](#rider-feedback). |
| `GuidanceMappingOptions`, `GuidanceThresholds` | Model-based capture guidance types. See [Model-based capture guidance](#model-based-capture-guidance). |
| `GeoLocation`, `GeoPoint`, `GeofenceOptions`, `GeofenceZone`, `GeofenceZoneKind` | Geofence types. See [Geofence](#geofence). |
| `InferenceRuleId`, `MappingOptions`, `MappingThresholds`, `ModelAssessment`, `ModelBox`, `ModelClass`, `ModelDetection`, `ModelMask`, `RawModelOutput` | Model-output mapping types. See [Model-output mapping](#model-output-mapping). |
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
    "GEOFENCE": { "enabled": true, "weight": 1, "severity": "FAIL", "failBelow": 0.5 },
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
