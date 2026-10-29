# Realtime frame detection design (#37, #38)

Status: approved by Andrew, 2026-10-25.
Issues: #37 (iOS), #38 (Android), parent #35.
Builds on: #61 (detector contract), #64 (`runDetector`), #66 (host-supplied `modelVersion`).

## Intent

Andrew's scenario, in his words: when the rider points the camera at an empty road, the shutter is disabled or the screen shows that no vehicle is detected; when the rider points the camera at the kickboard, the app checks that the kickboard is inside the frame and lets the capture proceed; with an option, the app captures automatically, like a document scanner.

So the camera preview must run the host-supplied detector on live frames and turn its output into the model-based guidance issues `NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, and `GROUND_NOT_VISIBLE`.
These issues join the existing image-quality issues (`BLURRY`, `LOW_LIGHT`, `TILTED`) in `useParkingGuidance`, so `ready` is false until a vehicle sits inside the guide frame.

## Goals

- Run the detector from #64 on camera frames in the VisionCamera frame processor on iOS and Android, throttled, without blocking the camera pipeline or the JS thread.
- Feed the detector output through the existing pure TypeScript path: `decodeDetectorOutput` → `mapGuidanceIssues` (with the guide frame and vehicle type) → `useParkingGuidance`.
- Make `ready` require a fresh detection with no model-based issue whenever a detector is configured.
- Provide an opt-in auto-capture signal: `ready` held continuously for a hold time fires once, then re-arms only after `ready` drops.
- Wire all of this into the example capture screen: shutter disabled and a "no vehicle" message without a vehicle, and an auto-capture toggle.

## Non-goals

- Training or shipping a model (#56). Without a host model, guidance behaves exactly as it does today.
- Running the full parking judgment (`mapModelOutput`, `evaluatePolicy`) on live frames. Judgment stays on the captured photo through `runDetector` and `verifyParking`.
- Masks, uprightness, or `imageQuality` from the model.
- A result screen (#44) or calling `verifyParking` from the example.

## Anti-goals

- Dropping camera frames or freezing the preview because inference is slow.
- Enabling the shutter while detection is stale or failing. A detector error must read as "not ready", never as "ready".
- Telling the rider "no vehicle" when the real cause is a model failure. `NO_VEHICLE` means a successful detection found no vehicle; a failure is reported separately.
- A second, divergent preprocessing path: frames and photos must reach the model as the same 512 × 512 RGB `[0, 1]` tensor in the model's layout.

## Design

### Native: a second frame processor plugin, `parkingDetector`

- A new plugin named `parkingDetector`, separate from the existing `parkingGuide` quality plugin, so the quality checks keep running at their own rate and a missing model costs nothing.
- Initialized from JS with `{ modelUri }` (same URI forms as `runDetector`). The model loads lazily on the first call, on the calling worklet thread, and stays cached for the plugin's lifetime.
- Its `callback(frame)` converts the frame to the detector input, runs the model, and returns `{ boxes, scores, classes }` (the `DetectorOutput` shape), or `{ error: <code> }` with the `runDetector` error codes when the model cannot load or run.
- iOS: refactor `ParkingGuideDetector` so model loading, the contract check, tensor filling, prediction, and output flattening take either a photo URL (existing path) or a `CVPixelBuffer` plus orientation. The frame path converts the YUV buffer with Core Image (`CIImage` from the pixel buffer, oriented by the frame orientation, scaled to 512 × 512, rendered into the same RGBX buffer the photo path uses) with one reused `CIContext`.
- Android: refactor `ParkingDetector` the same way. The frame path converts the `YUV_420_888` `Image` straight into 512 × 512 ARGB pixels, applying the frame rotation, in a pure Kotlin function (`FramePixels`) that is JVM-testable; the result goes through the existing `DetectorTensors.fillInput`.
- Both paths use the shared refactored core, so preprocessing cannot drift, and they share one loaded model per URI (see "Decided by Andrew").
- The plugin handles `frame.orientation` and `frame.isMirrored` so that the tensor is the upright, unmirrored scene.

### JS: throttled async call, decode on the JS thread

- `createParkingDetector(VisionCameraProxy, { modelUri })` (new, next to `createParkingFrameAnalyzer`) creates the plugin and returns a worklet `(frame) => DetectorFrameResult`. Its proxy type accepts string options, unlike the existing `Record<string, number>` in `createParkingFrameAnalyzer`.
- The app calls it inside `runAsync(frame, ...)` at a low target rate (default 2 per second) and hands the raw result to the JS thread with `Worklets.createRunOnJS`, as the example already does for quality results. `runAsync` runs one call at a time and drops frames while busy, so slow inference cannot back up the camera.
- On the JS thread, `useParkingGuidance` gains `onDetectorResult(result)` and a `detection` option `{ guideFrame, vehicleType, thresholds, minimumConfidence, staleAfterMs }`. It decodes with `decodeDetectorOutput`, maps with `mapGuidanceIssues`, and stores the issues with a timestamp.
- Each quality frame then merges the latest model issues into its `issues`. When `detection` is set:
  - a fresh successful detection contributes its issues (`NO_VEHICLE` when it found no vehicle);
  - a missing or stale detection (older than `staleAfterMs`, default 1500 ms) adds no issue but forces `ready` to false;
  - a detector error adds no issue, forces `ready` to false, and sets `detectorError` (the error code) on the hook result, so the host can show a model problem instead of "no vehicle".
    The existing reducer's debounce and smoothing then apply to the merged result unchanged.
- The `staleAfterMs` default is provisional: a first `.mlpackage` compile or a slow CPU-only LiteRT run can exceed 1500 ms, so the value is revisited once the reference model's latency is measured.
- The merge is a pure function next to `reduceGuidance` so it is unit-tested without React.

### Guide frame mapping

`mapGuidanceIssues` needs the guide frame in normalized, upright frame coordinates, but the example draws the guide frame in screen points over a preview that uses `resizeMode="cover"`, which crops the frame.
A pure helper `screenRectToFrameBox(rect, viewSize, frameSize)` (in the library, so hosts reuse it) converts the on-screen guide rectangle to the normalized box in the upright frame, accounting for the cover crop.
The frame size comes from the camera format; the plugin also returns the upright frame size it saw so the app can use the real value.

### Auto-capture

- A pure reducer `reduceAutoCapture(state, { ready, now }, { holdMs })` and a hook option `autoCapture: { holdMs }` (default hold 800 ms) expose `autoCaptureDue: boolean` that becomes true once per continuous `ready` period after `holdMs`. The app calls `takePhoto` when it turns true and calls `acknowledgeAutoCapture()`.
- It is off unless the host passes the option. The library never takes the photo itself, because the camera ref belongs to the app.

### Example app

- The capture screen creates the detector when a model URI is configured in `example/src/detectorModel.ts` (`undefined` by default, because the package bundles no model; a developer can point it at a model file on the device, for example a fixture pushed with `adb` or placed in the simulator container).
- Shutter: enabled only when `ready` (already the rule). `NO_VEHICLE` shows its default feedback text.
- An "Auto capture" switch on the capture screen turns on `autoCapture`.

## Verification

- Jest: merge function (fresh with and without a vehicle, stale, error with `detectorError` and without `NO_VEHICLE`, no detector configured), `reduceAutoCapture` (hold, fire once, re-arm), `screenRectToFrameBox` (cover crop in portrait and landscape), the hook wiring with a mocked plugin.
- Android JVM: `FramePixels` YUV → ARGB conversion with row and pixel strides and all four rotations, on synthetic planes.
- Android instrumented: the refactored `ParkingDetector` still passes the existing fixture tests; a frame-path test feeds an ARGB conversion of a synthetic YUV image.
- iOS macOS harness: the `CVPixelBuffer` path on a synthetic solid-color YUV buffer gives the same mean-red score (0.8 within 1e-3) as the photo path, for NHWC and NCHW fixtures and each orientation.
- CI builds both example apps.
- Device smoke test before #56, with the fixture model (its row-0 score is the scene's mean red, its box is fixed at `[0.1, 0.2, 0.6, 0.9]`):
  - Android: `adb push fixtures/detector/detector-nhwc.tflite /data/local/tmp/` then `adb shell run-as parkingguide.example cp /data/local/tmp/detector-nhwc.tflite files/`, and set `detectorModel.ts` to `/data/user/0/parkingguide.example/files/detector-nhwc.tflite`.
  - iOS: copy `detector-nhwc.mlpackage` into the app's Documents directory (`xcrun simctl get_app_container booted parkingguide.example data` on a simulator, or the Files app on a device) and set the path accordingly.
  - Expected: a strongly red scene (score above `minimumConfidence` 0.5) yields a detection at the fixed box, so guidance reports a distance or ground issue relative to the guide frame; any other scene yields `NO_VEHICLE` and a disabled shutter. Removing the model file yields `detectorError` and a disabled shutter without the "no vehicle" text.
- Device acceptance (#37/#38 "Done when") needs the reference model (#56) and stays open; the PR uses `Refs #37 #38`.

## Decided by me (Claude), to be checked

- Separate `parkingDetector` plugin instead of extending `parkingGuide`.
- Decode and mapping on the JS thread instead of inside the worklet.
- Defaults: 2 detections per second, `staleAfterMs` 1500, auto-capture hold 800 ms.
- `screenRectToFrameBox` lives in the library.
- Stale or failed detection keeps `ready` false (fail closed); only a successful detection can produce `NO_VEHICLE`, and a failure is exposed as `detectorError`.

## Decided by Andrew

- Model memory during capture: **one shared detector per model URI.** The frame plugin and `runDetector` use the same loaded model for the same URI, with calls serialized (Android: the synchronized `ParkingDetector`; iOS: one serial queue), so frame detection pauses briefly while a photo is analyzed. Only one copy of the model is in memory.
- Model version comes from the host (#66), so neither path reads a version from the model.

## Left to the builder

- Exact Core Image and Android sampling code, and whether nearest-neighbor or bilinear sampling is used for frames (photos already use high-quality interpolation; frames may use nearest-neighbor for speed if the fixture check still holds).
- File names for the new modules within `src/guidance/` and `src/inference/`.
- README and AGENTS.md wording, following the existing sections.
