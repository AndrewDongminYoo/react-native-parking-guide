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
| 1. Capture guidance | `useParkingGuidance`, `createParkingFrameAnalyzer`, iOS and Android image-quality analysis (`BLURRY`, `LOW_LIGHT`, `TILTED`), and `mapGuidanceIssues` (model output → `NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, `GROUND_NOT_VISIBLE`) | Producing model-based issues from camera frames (requires on-device inference) |
| 2. Parking judgment | `mapModelOutput` (model output → `RuleResult[]`, with target-vehicle selection by `MappingOptions.vehicleType` and inside `MappingOptions.guideFrame`, and a `TACTILE_PAVING`/`CROSSWALK` proximity flag in `evidence.proximity`), `runDetector` (native inference of a host-supplied CoreML or LiteRT/TFLite detector on a photo, see [Native detector inference](#native-detector-inference)), `decodeDetectorOutput` (detector output tensors → model output, see [Detector model contract](#detector-model-contract)), `evaluateGeofence` (caller-supplied location and zones → `GEOFENCE`), `evaluatePolicy`, `validatePolicy`, `defaultPolicy` | A published reference model (see [Model source](#model-source)) and an uprightness classifier; reading device location or fetching zone data |
| 3. Immediate feedback | `Verdict`, score, and `RuleResult[]` from `evaluatePolicy` and `mapModelOutput`; `getParkingFeedback` (feedback keys and default English text for failed, warned, or unchecked rules and for each `GuidanceIssue`); `verifyParking` (native photo SHA-256, caller-supplied rule results, and capture metadata → `VerificationResult`) | A result screen in the example app; producing rule results from the photo inside `verifyParking` (requires on-device inference) |

Outside the three goal steps, `uploadVerification` (an opt-in upload of a `VerificationResult` to a caller-owned
endpoint) is implemented; the package provides no server.

`getModelVersion()` is a native stub that returns `"0.1.0-dev"`. `getFileSha256(uri)` and `runDetector(photoUri, modelUri)`
are implemented natively on iOS and Android.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference of a host-supplied model: CoreML on iOS, TFLite on Android. See [Model source](#model-source).
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Model source

The package bundles no model weights. The host app supplies the model file, and the package defines the model
output contract: `RawModelOutput` in [Model-output mapping](#model-output-mapping), and the detector input and output
tensors in [Detector model contract](#detector-model-contract). The decision, including the class
list, input resolution, and licenses, is recorded in
[the #32 decision comment](https://github.com/donminzzi/react-native-parking-guide/issues/32#issuecomment-6390993023).

- Classes: a model adapter maps the model classes `kickboard`, `bicycle` (including e-bikes), and `motorcycle`
  (including mopeds) to `classId` `vehicle`, and maps `tactile_paving`, `crosswalk`, `roadway`, `sidewalk_block`, and
  `parking_zone` to the `classId` of the same name. The adapter reports the vehicle model class as
  `ModelDetection.vehicleType` (`'kickboard'`, `'bicycle'`, or `'motorcycle'`). Vehicle uprightness is reported as
  `ModelDetection.upright`.
- Input resolution of the reference model: 512 × 512 RGB.
- Licenses: the reference model uses only Apache-2.0, MIT, or BSD code and weights. Ultralytics YOLO (AGPL-3.0) and
  weights pretrained on non-commercial data are excluded.
- Reference model: RF-DETR-Seg (Apache-2.0), distributed separately from this package. Training and publishing it is
  tracked in [#56](https://github.com/donminzzi/react-native-parking-guide/issues/56); it is not published yet.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.2 (M2)**: JS frame-result handoff, smoothed capture guidance, and iOS and Android image-quality frame analysis
  are implemented.
- **v0.5**: on-device inference of a host-supplied vehicle and prohibited-zone model, a separately distributed
  reference model ([#56](https://github.com/donminzzi/react-native-parking-guide/issues/56)), model-based capture guidance from camera
  frames (`NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, `GROUND_NOT_VISIBLE`), prohibited-zone rules (tactile paving, crosswalk, roadway, sidewalk block,
  parking zone), and geofence integration.
- **v1.0**: photo capture into `VerificationResult` (`verifyParking` is implemented), a rider-facing result screen in the example app, attestation support,
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

On Android, `react-native-vision-camera` 4.7.3 depends on CameraX `1.5.0-alpha03`. On Android 17 (API level 37),
that CameraX version cannot convert dynamic range profile `8192`, VisionCamera fails to list camera devices
(`Dynamic range profile cannot be converted to a DynamicRange object: 8192`), and `useCameraDevice('back')` throws
`TypeError: Cannot read property 'CameraDevices' of undefined`.
Force CameraX `1.5.2`, which contains the fix, in the app's root `android/build.gradle`, as
`example/android/build.gradle` does:

```groovy
allprojects {
  configurations.configureEach {
    resolutionStrategy.eachDependency { details ->
      if (details.requested.group == "androidx.camera") {
        details.useVersion("1.5.2")
      }
    }
  }
}
```

Do not force CameraX `1.6.0` or later with VisionCamera 4.7.3: VisionCamera 4.7.3 casts to
`androidx.camera.camera2.internal.Camera2CameraInfoImpl`, which CameraX `1.6.0` removed.

## API

The package implements policy validation and evaluation, model-output mapping, JS guidance state processing, and iOS
and Android image-quality frame analysis.
`verifyParking` assembles a `VerificationResult` from a captured photo and caller-supplied rule results; it does not run
a model. See [Photo verification](#photo-verification).

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
- `decodeDetectorOutput(output: DetectorOutput): RawModelOutput` converts the post-processed output tensors of a
  host-supplied detector model. See [Detector model contract](#detector-model-contract).
- `DETECTOR_CLASSES` is the immutable detector class order that `DetectorOutput.classes` indexes.
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
- `uploadVerification<T>(result: VerificationResult, options: UploadOptions): Promise<UploadResult<T>>` posts `result`
  as JSON to a caller-owned `https://` endpoint, only when called. See [Opt-in upload](#opt-in-upload).
- `DEFAULT_UPLOAD_TIMEOUT_MS` (`10000`), `DEFAULT_UPLOAD_RETRIES` (`2`), and `DEFAULT_UPLOAD_RETRY_DELAY_MS` (`500`) are
  the `UploadOptions` defaults.
- `verifyParking(options: VerifyParkingOptions): Promise<VerificationResult>` hashes the photo and assembles a
  `VerificationResult`. See [Photo verification](#photo-verification).
- `getFileSha256(uri: string): Promise<string>` returns the lowercase hexadecimal SHA-256 of a file, computed natively
  off the JS thread. See [Photo verification](#photo-verification).
- `runDetector(photoUri: string, modelUri: string): Promise<DetectorOutput>` runs a host-supplied detector model on a
  photo natively. See [Native detector inference](#native-detector-inference).

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
Optional `vehicleType` on each vehicle is the type predicted by the model: `'bicycle'`, `'ebike'`, `'kickboard'`, or
`'motorcycle'` (not `'auto'`). Omit it when the model does not distinguish vehicle types. The mapper ignores
`vehicleType` on detections of other classes, but validates it on every detection.
Optional `imageQuality: ModelAssessment` on `RawModelOutput` measures image suitability; the mapper does not
derive it from capture-guidance issues. Each assessment has `score` (higher means more compliant) and `confidence`.
All input scores, confidences, coordinates, `minimumConfidence`, and `failBelow`/`passAt` thresholds must be finite
and in `[0, 1]`; `proximityThreshold` has its own range, described below.
Invalid numeric values, inverted boxes, malformed masks, mismatched mask grids, `failBelow > passAt`, a detection
`vehicleType` outside the four detected types, and a `MappingOptions.vehicleType` outside the five `VehicleType` values
throw `RangeError`; the mapper never clamps invalid model input.

`minimumConfidence` defaults to `0.5`. Detections and assessments strictly below it are ignored.
`MappingOptions.vehicleType` is the vehicle type of the rental and defaults to `'auto'`. When it is not `'auto'`, a
vehicle detection whose `vehicleType` is set and differs from it is not a candidate, except that `'bicycle'` and
`'ebike'` match each other because appearance rarely separates them. A vehicle detection without `vehicleType` remains
a candidate. The rules below select only among candidates; if every vehicle is excluded, no vehicle is selected.
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
      vehicleType: 'kickboard',
    },
    { classId: 'parking_zone', confidence: 0.9, box: [0, 0, 1, 1] },
  ],
  imageQuality: { score: 0.9, confidence: 0.95 },
};
const rules = mapModelOutput(output, {
  minimumConfidence: 0.5,
  thresholds: { CROSSWALK: { failBelow: 0.95, passAt: 0.99 } },
  vehicleType: 'kickboard',
});
const result = evaluatePolicy(rules, defaultPolicy);
```

### Detector model contract

This section defines what a host-supplied detector model must accept and produce.
`decodeDetectorOutput(output: DetectorOutput): RawModelOutput` converts the model output to the `RawModelOutput` that
`mapModelOutput` and `mapGuidanceIssues` accept.
`runDetector` runs the model natively; see [Native detector inference](#native-detector-inference).

Input:

- One RGB image of 512 × 512 pixels. The native layer resizes the orientation-corrected photo or frame to 512 × 512
  without preserving the aspect ratio (no letterbox), so normalized output coordinates apply directly to the original
  image.
- Pixel values in `[0, 1]`. The model applies its own mean and standard-deviation normalization.
- One float32 input tensor of shape `[1, 512, 512, 3]` (NHWC) or `[1, 3, 512, 512]` (NCHW), in RGB channel order.
  `runDetector` reads the shape from the model and fills the tensor in that layout on both platforms.

Output: three tensors for N detections. N can be a fixed, padded count.

| Tensor | Shape | Values |
| --- | --- | --- |
| `boxes` | N × 4 | Normalized `[left, top, right, bottom]`, each in `[0, 1]`, with `left <= right` and `top <= bottom`. |
| `scores` | N | Confidence in `[0, 1]`. |
| `classes` | N | Integer index into `DETECTOR_CLASSES` (table below). |

The output tensors must be named `boxes`, `scores`, and `classes` (TFLite signature output names; CoreML output
feature names). Any shape with the listed element count is accepted, for example `[1, N, 4]`; element types are
float32, int32, or int64 on Android and any CoreML multi-array type on iOS.

Post-processing is part of the exported model, not of this package: score activation, conversion to corner
coordinates, clamping to `[0, 1]`, and duplicate suppression.

| Index | Detector class | `classId` | `vehicleType` |
| --- | --- | --- | --- |
| 0 | `kickboard` | `vehicle` | `'kickboard'` |
| 1 | `bicycle` (includes e-bikes) | `vehicle` | `'bicycle'` |
| 2 | `motorcycle` (includes mopeds) | `vehicle` | `'motorcycle'` |
| 3 | `tactile_paving` | `tactile_paving` | – |
| 4 | `crosswalk` | `crosswalk` | – |
| 5 | `roadway` | `roadway` | – |
| 6 | `sidewalk_block` | `sidewalk_block` | – |
| 7 | `parking_zone` | `parking_zone` | – |

`DetectorOutput` holds the three tensors flattened row-major as `number[]`: `boxes` has `4 × N` values and row `i` is
`boxes[4i]` to `boxes[4i + 3]`.
`decodeDetectorOutput` is pure and deterministic. It keeps every row, including zero-score padding rows;
`mapModelOutput` and `mapGuidanceIssues` ignore rows below `minimumConfidence` and rows with a zero-area box.
Padding rows must still be valid rows: a class index in `[0, 7]`, a box in `[0, 1]` with `left <= right` and
`top <= bottom` (for example `[0, 0, 0, 0]`), and a score in `[0, 1]`. One invalid padding row makes the whole call
throw.
It throws `RangeError` when `boxes.length` is not `4 × scores.length`, when `classes.length` is not `scores.length`,
when a class index is not an integer in `[0, 7]`, and for any value that `mapModelOutput` rejects. It never clamps.

The contract does not cover masks (`ModelMask`), vehicle uprightness from the separate classifier
(`ModelDetection.upright`), or `imageQuality`. The decoded output contains none of them, so `mapModelOutput` reports
`UPRIGHT` and `IMAGE_QUALITY` as `WARN` with score/confidence `0`.
With `defaultPolicy`, `UPRIGHT` has `severity: 'FAIL'` and `failBelow: 0.7`, so `evaluatePolicy` returns `FAIL` for
every decoded output until a host merges an `upright` assessment into the vehicle detection. To evaluate decoded
output before that, pass a policy that disables `UPRIGHT` or sets its `severity` to `'WARN'`.

### Native detector inference

`runDetector(photoUri: string, modelUri: string): Promise<DetectorOutput>` runs a host-supplied detector that follows
the [Detector model contract](#detector-model-contract) on one photo, off the JS thread, and returns its output
tensors. Pass the result to `decodeDetectorOutput`. The package bundles no model; see [Model source](#model-source).

```ts
import { decodeDetectorOutput, mapModelOutput, runDetector } from 'react-native-parking-guide';

const tensors = await runDetector(photo.path, modelPath);
const ruleResults = mapModelOutput(decodeDetectorOutput(tensors), { vehicleType: 'kickboard' });
```

- `photoUri` accepts the same forms as `getFileSha256` (see [Photo verification](#photo-verification)): an absolute
  path or a `file:///` URI, and on Android also a `content://` URI. The photo is decoded, rotated by its EXIF
  orientation, and stretched to 512 × 512.
- `modelUri` accepts the same forms. On Android it is a LiteRT/TFLite flatbuffer (`.tflite`) with exactly one
  signature. On iOS it is a compiled `.mlmodelc` directory, or an `.mlmodel` or `.mlpackage` that is compiled on the
  first call; the path extension selects the form.
- Each platform caches the last loaded model and reuses it while `modelUri` stays the same string. A different
  `modelUri` releases the cached model first; module invalidation (for example a JS reload) releases it too.
- Calls run one at a time: on Android on the same single background thread as `getFileSha256`, on iOS on a serial
  background queue.

It rejects with these codes. Messages do not contain file paths.

| Code | Reason |
| --- | --- |
| `E_INVALID_URI` | `photoUri` or `modelUri` is not one of the accepted forms. |
| `E_MODEL_LOAD` | The model file cannot be read, compiled, or loaded, or its iOS extension is not `.mlmodelc`, `.mlmodel`, or `.mlpackage`. |
| `E_MODEL_CONTRACT` | The model does not have exactly one float32 input of shape `[1, 512, 512, 3]` or `[1, 3, 512, 512]`, or lacks a `boxes`, `scores`, or `classes` output (Android: of type float32, int32, or int64), or (Android) does not have exactly one signature. |
| `E_PHOTO_READ` | The photo cannot be opened or decoded. |
| `E_INFERENCE` | The inference call fails. |

On Android, the package depends on `com.google.ai.edge.litert:litert:1.4.2` (the LiteRT Interpreter API), which adds
native libraries for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64` to the app. LiteRT 2.x is not used: its Kotlin
metadata (version 2.3 and later) does not compile with the Kotlin 2.1 toolchain of React Native 0.86. On iOS, the pod
links the system `CoreML`, `ImageIO`, and `CoreGraphics` frameworks.

Synthetic fixtures in `fixtures/detector/` verify both platforms: `scripts/make-fixture-models.py` generates
NHWC and NCHW `.tflite` and `.mlpackage` models that return a mean-red score, a `.tflite` model whose detection count
depends on the photo, and the solid-color images `solid.png` and `dark.png`. They contain no trained weights and are
not part of the published package. See
[Development](#development) for the commands.

### Geofence

`evaluateGeofence(location, zones)` is pure and deterministic, does not mutate its input, and never reads device
location or fetches zone data; the caller supplies both. It returns one `RuleResult` with `id: 'GEOFENCE'`.

- `GeoPoint` has WGS 84 `lat` in `[-90, 90]` and `lng` in `[-180, 180]`, in degrees. `GeoLocation` adds `accuracy`,
  the horizontal accuracy radius in meters (finite and `>= 0`), so `VerificationResult.metadata.location` is a valid
  `GeoLocation`.
- `GeofenceZone` has `kind: 'allowed' | 'prohibited'` and `polygon: readonly GeoPoint[]` with at least 3 vertices.
  The ring closes implicitly (repeating the first vertex is allowed), and inside is decided by the even-odd rule.
- `GeofenceOptions.maxAccuracy` defaults to `DEFAULT_MAX_GEOFENCE_ACCURACY` (`50` m). It must be a number that is
  not `NaN` and is `>= 0`; `Infinity` disables the limit.
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
It validates `output`, `minimumConfidence` (default `0.5`), `guideFrame`, and `vehicleType` (default `'auto'`) exactly
as `mapModelOutput` does and selects the vehicle exactly as `mapModelOutput` does with the same `minimumConfidence`,
`guideFrame`, and `vehicleType`.

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
active and unmount it when capture stops, as in `example/src/CaptureScreen.tsx`, which both platforms use.

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
Select a vehicle type, for example **Kickboard**, on the home screen and allow camera access.
Use a well-lit textured scene with the phone upright, then check each condition for at least three analyzed frames:
cover the lens for `LOW_LIGHT`, defocus or shake for `BLURRY`, and lean or rotate more than `20` degrees from the
nearest upright pose for `TILTED`. Multiple issues may appear simultaneously. Check portrait and landscape poses,
select **Close** (or press the system back button) for at least two seconds, and select the vehicle again to confirm
fresh motion samples and reset guidance history. Background the app to confirm the camera stops and guidance resets;
returning to the app restarts the camera with empty guidance history.
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

Run `yarn example ios` with Xcode and a physical iOS device, select a vehicle type on the home screen, and allow
camera access.
Use a well-lit textured scene with the phone upright, then check each condition for at least three analyzed frames:
cover the lens for `LOW_LIGHT`, defocus or shake the camera for `BLURRY`, and rotate or lean the phone more than
`20` degrees away from an upright pose for `TILTED`. Conditions may produce multiple issues simultaneously.
Select **Close** and select the vehicle again to check that guidance history resets. Backgrounding the app must stop
the camera and reset guidance.
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

### Photo verification

`verifyParking(options)` turns one captured photo into a `VerificationResult`:

1. It validates `options`. An invalid value rejects with `RangeError` before the photo is read.
2. It computes `photo.sha256` with `getFileSha256(options.photo.uri)`.
3. It computes `verdict` and `score` with `evaluatePolicy(options.ruleResults, policy)`.
4. It fills `metadata`: `capturedAt`, `deviceTilt`, `modelVersion` from `getModelVersion()`, `platform` from
   `Platform.OS`, and `location`, `heading`, and `attestation` only when they are passed.

The package does not run a model yet, so the caller passes the rule results, for example
`[...mapModelOutput(output, mappingOptions), evaluateGeofence(location, zones)]`. `rules` in the result is a copy of
`options.ruleResults` in the same order, including rules that the policy ignores.

| Option | Default | Constraint | Meaning |
| --- | --- | --- | --- |
| `photo` | none (required) | `uri`: non-empty string; `width`, `height`: integers `> 0` | The captured photo, for example `{ uri: photo.path, width: photo.width, height: photo.height }` from VisionCamera `takePhoto()`. |
| `ruleResults` | none (required) | array; every item has `verdict` `'PASS'`, `'WARN'`, or `'FAIL'`; at least one item has an `id` whose policy entry has `enabled: true` | Rule results for this photo. An empty array, or one in which the policy ignores every item, rejects with `RangeError`: `evaluatePolicy` would score it `1` and return `PASS` for a photo that nothing evaluated. |
| `policy` | `defaultPolicy` | passes `validatePolicy` | Policy for `evaluatePolicy`. An invalid policy rejects with `RangeError` that lists the `validatePolicy` messages. |
| `deviceTilt` | none (required) | `pitch`, `roll`: finite radians in `[-π, π]` | Device tilt at capture time. |
| `heading` | omitted | finite degrees in `[0, 360)`, clockwise from true north | Device heading at capture time. |
| `location` | omitted | `GeoLocation`: `lat` in `[-90, 90]`, `lng` in `[-180, 180]`, `accuracy` finite and `>= 0` meters | Rider location. Pass it only after the rider consents; the package never reads the device location. |
| `capturedAt` | the time `verifyParking` is called | valid `Date` | Written as an ISO 8601 UTC string, for example `2026-10-25T01:02:03.004Z`. |
| `attestation` | omitted | string | Device attestation token, copied as-is. |

Other errors: `verifyParking` rejects with `Error` when `Platform.OS` is neither `'ios'` nor `'android'`, when
`getFileSha256` rejects, and when the native digest is not 64 lowercase hexadecimal digits.

`getFileSha256(uri)` reads the file in 64 KiB chunks on a background thread. It accepts these `uri` forms:

- On iOS and Android, an absolute path that starts with `/`. The path is used as-is, without percent-decoding.
- On iOS and Android, a `file:///` URI (empty host). The text after `file://` is percent-decoded as UTF-8: each `%XX`
  (two ASCII hexadecimal digits) becomes one byte, and every other character is kept literally. For example,
  `file:///data/a%20b.jpg` and `file:///data/a b.jpg` both read `/data/a b.jpg`.
- On Android only, a `content://` URI with at least one character after `content://`.

It rejects with code `E_INVALID_URI` for any other form, including `file://host/...` and `file://photo.jpg`, and for a
`file:///` URI that contains a malformed `%` sequence or decodes to invalid UTF-8. It rejects with `E_PHOTO_READ` when
the file cannot be opened or read. Error messages do not contain the path.

Privacy. `verifyParking` and `getFileSha256` log nothing and make no network call; the photo bytes stay on the device.

```ts
import {
  evaluateGeofence,
  mapModelOutput,
  verifyParking,
} from 'react-native-parking-guide';

const photo = await camera.current.takePhoto();
const result = await verifyParking({
  photo: { uri: photo.path, width: photo.width, height: photo.height },
  ruleResults: [
    ...mapModelOutput(modelOutput, { vehicleType: 'kickboard' }),
    evaluateGeofence(location, zones),
  ],
  deviceTilt: { pitch, roll },
  location,
});
```

### Opt-in upload

`uploadVerification(result, options)` sends one `VerificationResult` to a server that the app owns. It runs only when
the app calls it: the package never uploads automatically, has no default endpoint, and provides no server.

Request:

- `POST` to `options.endpoint`. The endpoint must be `https://` (case-insensitive), then a host, then an optional
  `:port` from `1` to `65535`, then an optional path, query, or fragment that starts with `/`, `?`, or `#` and contains
  no whitespace. The host must be one of:
  - a DNS name of at most 253 characters made of dot-separated labels; each label has 1 to 63 ASCII letters, digits,
    or hyphens and does not start or end with a hyphen. Write an internationalized name in its `xn--` form.
  - a dotted-decimal IPv4 address with four parts from `0` to `255` and no leading zeros.

  A host whose last label is numeric must be such an IPv4 address. Everything else is rejected, including `http://`
  and other schemes, an empty host, user information such as `user:password@`, percent-encoded hosts, IPv6 literals
  such as `[2001:db8::1]`, and a trailing dot.
- Body: `JSON.stringify(result)`. Headers: `Content-Type: application/json` and `Accept: application/json`, then
  `options.headers`. A caller header replaces a default header whose name matches case-insensitively.

Options (invalid values reject with `RangeError` before any request is sent; `options` must be an object and
`options.headers`, when present, a non-array object whose values are strings):

| Option | Default | Constraint | Meaning |
| --- | --- | --- | --- |
| `endpoint` | none (required) | `https://` URL as above | Upload target. |
| `headers` | `{}` | object of strings | Extra request headers, for example `Authorization`. |
| `timeoutMs` | `DEFAULT_UPLOAD_TIMEOUT_MS` (`10000`) | finite, `> 0` | Per-attempt limit for the request and for reading the response body. The request is aborted when it elapses. |
| `retries` | `DEFAULT_UPLOAD_RETRIES` (`2`) | integer, `>= 0` | Attempts after the first, so at most `retries + 1` requests. |
| `retryDelayMs` | `DEFAULT_UPLOAD_RETRY_DELAY_MS` (`500`) | finite, `>= 0` | Retry `n` (1-based) starts `retryDelayMs × 2^(n − 1)` ms after the previous attempt fails. |

Outcome. The returned promise resolves with an `UploadResult<T>` for every transport outcome:

| Attempt outcome | Result | Retried |
| --- | --- | --- |
| HTTP status `200`–`299`, empty body | `{ ok: true, status, body: undefined, attempts }` | — |
| HTTP status `200`–`299`, JSON body | `{ ok: true, status, body, attempts }`; `body` is `JSON.parse` output cast to `T` without validation | — |
| HTTP status `200`–`299`, body that is not valid JSON | `{ ok: false, error: 'invalid_response', status, attempts }` | No |
| HTTP status `200`–`299`, body read fails or exceeds `timeoutMs` | `{ ok: false, error: 'network' \| 'timeout', status, attempts }` | No (the server already accepted the request) |
| HTTP status `408`, `429`, or `500`–`599` | `{ ok: false, error: 'http', status, attempts }` | Yes |
| Any other HTTP status | `{ ok: false, error: 'http', status, attempts }` | No |
| `fetch` rejects | `{ ok: false, error: 'network', attempts }` | Yes |
| No response within `timeoutMs` | `{ ok: false, error: 'timeout', attempts }` | Yes |

`attempts` is the number of requests sent. When retries run out, the result of the last attempt is returned.
A timeout or network failure can occur after the server has received the request, so a retry can deliver the same
body more than once; the server should treat repeated uploads with the same `photo.sha256` as one submission.

Privacy. The package does not read or send the photo file. The JSON body contains every field of `result`, including
`photo.uri` (a path on the device), `photo.sha256`, `metadata.location` (latitude, longitude, and accuracy) when set,
`metadata.heading`, `metadata.deviceTilt`, `metadata.platform`, and `metadata.attestation` when set. The function does
not log any of these values. Before calling it, obtain the rider's consent for sending this data, and remove fields that
the server does not need from the object you pass.

```ts
import { uploadVerification } from 'react-native-parking-guide';

const upload = await uploadVerification<{ accepted: boolean }>(result, {
  endpoint: 'https://parking.example.com/verifications',
  headers: { Authorization: `Bearer ${token}` },
});
if (!upload.ok) {
  // upload.error is 'http', 'network', 'timeout', or 'invalid_response'.
}
```

### Exported types

These are the types exported by `src/index.tsx`. Numeric fields are TypeScript `number` values; unless a range is
stated below, this package does not validate a narrower range. No fields have implicit defaults unless explicitly
stated.

| Type | Values and fields |
| --- | --- |
| `VehicleType` | `'bicycle'`, `'ebike'`, `'kickboard'`, `'motorcycle'`, or `'auto'`. `'auto'` means detect the vehicle type automatically; it does not mean automobile. `MappingOptions.vehicleType` and `GuidanceMappingOptions.vehicleType` accept it; `ModelDetection.vehicleType` accepts every value except `'auto'`. |
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
| `UploadErrorKind`, `UploadOptions`, `UploadResult<T>` | Opt-in upload types. See [Opt-in upload](#opt-in-upload). |
| `DetectorOutput` | Required `boxes`, `scores`, and `classes` (`readonly number[]`). See [Detector model contract](#detector-model-contract). |
| `VerifyParkingOptions` | Photo verification options. See [Photo verification](#photo-verification). |
| `InferenceRuleId`, `MappingOptions`, `MappingThresholds`, `ModelAssessment`, `ModelBox`, `ModelClass`, `ModelDetection`, `ModelMask`, `RawModelOutput` | Model-output mapping types. See [Model-output mapping](#model-output-mapping). |
| `VerificationResult` | Required `verdict: Verdict`, `score: number`, `rules: RuleResult[]`, `photo: { uri: string; width: number; height: number; sha256: string }`, and `metadata: { capturedAt: string; location?: { lat: number; lng: number; accuracy: number }; heading?: number; deviceTilt: { pitch: number; roll: number }; modelVersion: string; platform: 'ios' \| 'android'; attestation?: string }`. The type defines no additional numeric ranges or defaults; `verifyParking` produces values in the ranges listed in [Photo verification](#photo-verification). |

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

Detector fixtures and native detector checks (see [Native detector inference](#native-detector-inference)):

```sh
uv run scripts/make-fixture-models.py   # regenerate fixtures/detector (Python 3.12, coremltools, tensorflow)
sh scripts/detector-harness/run.sh      # run ios/ParkingGuideDetector.mm on macOS against the fixtures
cd example/android && ./gradlew :react-native-parking-guide:connectedDebugAndroidTest   # needs a device or emulator
```

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
