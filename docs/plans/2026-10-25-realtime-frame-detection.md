# Realtime Frame Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the host-supplied detector on live VisionCamera frames on iOS and Android and turn its output into `NO_VEHICLE`, `TOO_CLOSE`, `TOO_FAR`, and `GROUND_NOT_VISIBLE` guidance in `useParkingGuidance`, with an opt-in auto-capture signal and example-app wiring.

**Architecture:** A new frame processor plugin `parkingDetector` converts each throttled frame to the same 512 × 512 RGB tensor as `runDetector` and runs the shared, per-URI cached detector. JS calls it inside `runAsync`, hands the raw tensors to the JS thread, and pure functions decode, map, and merge them into the existing guidance reducer.

**Tech Stack:** TypeScript (Jest), Objective-C++ with CoreML, Core Image, and CoreVideo, Kotlin with LiteRT 1.4.2, react-native-vision-camera 4.7.3 frame processors, react-native-worklets-core 1.6.3.

**Spec:** `docs/specs/2026-10-25-realtime-frame-detection-design.md`

## Global Constraints

- Detector input: 512 × 512 RGB, values in `[0, 1]`, float32, layout read from the model shape (`[1, 512, 512, 3]` NHWC or `[1, 3, 512, 512]` NCHW), upright and unmirrored, stretched without letterbox (README "Detector model contract").
- Error codes: reuse `E_INVALID_URI`, `E_MODEL_LOAD`, `E_MODEL_CONTRACT`, `E_PHOTO_READ`, `E_INFERENCE`; messages contain no file paths.
- One shared detector per model URI between the frame plugin and `runDetector`; calls are serialized (Andrew's decision in the spec).
- Defaults: detection target rate 2 per second (example app), `staleAfterMs` 1500 (provisional), auto-capture `holdMs` 800.
- Fail closed: missing, stale, or failed detection keeps `ready` false; only a successful detection yields `NO_VEHICLE`; failures surface as `detectorError`.
- Without a configured detector, guidance behaves exactly as today.
- Code, comments, and docs in English; Conventional Commits; `yarn typecheck`, `yarn lint`, `yarn test` pass before every commit (AGENTS.md).
- After any local Gradle run, delete `android/build/reports` before `yarn lint` (project memory `lint-after-gradle-reports`).
- No new dependencies.

## Review Focus

1. A detector result that arrives after `reset()` must be ignored, not merged into the next session (Task 3 test, through the session `generation`).
2. Invalid model output (NaN, wrong lengths) or a native `{ error }` must become `detectorError` and never throw on the JS thread (Task 1 test).
3. An invalid `detection` option (bad thresholds or guide frame) must throw when the hook is configured, not later as a per-frame `detectorError` that hides a programming error (Task 1 and Task 3 tests on the validators the hook calls during render).
4. Auto-capture must fire once per continuous `ready` period: acknowledging, or staying ready, must not fire again until `ready` drops (Task 2 test).
5. Device rotation changes the upright frame size; `screenRectToFrameBox` must use the frame size reported with each result, and a portrait and a landscape frame must map the same on-screen rectangle differently (Task 2 test).

---

### Task 1: Pure detection snapshot and merge

**Files:**
- Create: `src/guidance/detection.ts`
- Test: `src/__tests__/detection.test.ts`

**Interfaces:**
- Consumes: `decodeDetectorOutput` (`src/inference/detector.ts`), `mapGuidanceIssues`, `GuidanceMappingOptions` (`src/inference/guidance.ts`), `GuidanceFrameResult` (`src/guidance/reducer.ts`).
- Produces:
  - `type DetectorFrameResult = { boxes: number[]; scores: number[]; classes: number[]; frameWidth: number; frameHeight: number } | { error: string }`
  - `interface DetectionOptions extends GuidanceMappingOptions { staleAfterMs?: number }`
  - `interface DetectionSnapshot { issues: GuidanceIssue[]; error: string | null; at: number }`
  - `const DEFAULT_DETECTION_STALE_MS = 1500`
  - `function validateDetectionOptions(options: DetectionOptions): void` (throws `RangeError`)
  - `function toDetectionSnapshot(result: DetectorFrameResult, at: number, options: DetectionOptions): DetectionSnapshot`
  - `function mergeDetection(frame: GuidanceFrameResult, snapshot: DetectionSnapshot | null, now: number, staleAfterMs: number): { frame: GuidanceFrameResult; detectorError: string | null }`

- [ ] **Step 1: Write the failing tests**

```ts
const VEHICLE = { boxes: [0.2, 0.3, 0.8, 0.9], scores: [0.9], classes: [0], frameWidth: 480, frameHeight: 640 };
const EMPTY = { boxes: [], scores: [], classes: [], frameWidth: 480, frameHeight: 640 };
const QUALITY = { ready: true, issues: [], progress: 1 };

it('maps a vehicle detection to model issues', () => {
  expect(toDetectionSnapshot(VEHICLE, 10, {}).issues).toEqual([]); // fills 0.6 of the whole frame: no issue
  expect(toDetectionSnapshot(EMPTY, 10, {})).toEqual({ issues: ['NO_VEHICLE'], error: null, at: 10 });
});
it('turns a native error into a snapshot error', () => {
  expect(toDetectionSnapshot({ error: 'E_MODEL_LOAD' }, 10, {})).toEqual({ issues: [], error: 'E_MODEL_LOAD', at: 10 });
});
it('turns invalid model output into E_MODEL_CONTRACT without throwing', () => {
  expect(toDetectionSnapshot({ ...VEHICLE, scores: [Number.NaN] }, 10, {}).error).toBe('E_MODEL_CONTRACT');
  expect(toDetectionSnapshot({ ...VEHICLE, classes: [] }, 10, {}).error).toBe('E_MODEL_CONTRACT');
});
it('merges fresh issues and keeps ready only without model issues', () => {
  const noVehicle = { issues: ['NO_VEHICLE'], error: null, at: 0 } as const;
  expect(mergeDetection(QUALITY, noVehicle, 100, 1500)).toEqual({ frame: { ready: false, issues: ['NO_VEHICLE'], progress: 1 }, detectorError: null });
  expect(mergeDetection(QUALITY, { issues: [], error: null, at: 0 }, 100, 1500).frame.ready).toBe(true);
});
it('fails closed on a missing, stale, or failed detection without NO_VEHICLE', () => {
  expect(mergeDetection(QUALITY, null, 100, 1500)).toEqual({ frame: { ready: false, issues: [], progress: 1 }, detectorError: null });
  expect(mergeDetection(QUALITY, { issues: [], error: null, at: 0 }, 1501, 1500).frame.ready).toBe(false);
  expect(mergeDetection(QUALITY, { issues: [], error: 'E_INFERENCE', at: 0 }, 100, 1500)).toEqual({ frame: { ready: false, issues: [], progress: 1 }, detectorError: 'E_INFERENCE' });
});
it('rejects invalid detection options', () => {
  expect(() => validateDetectionOptions({ staleAfterMs: 0 })).toThrow(RangeError);
  expect(() => validateDetectionOptions({ thresholds: { tooFarBelow: 2, tooCloseAbove: 1 } })).toThrow(RangeError);
  expect(() => validateDetectionOptions({ guideFrame: [0.5, 0, 0.4, 1] })).toThrow(RangeError);
});
```

- [ ] **Step 2: Run `npx jest src/__tests__/detection.test.ts`** — expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/guidance/detection.ts`.** `toDetectionSnapshot` catches only `RangeError` from `decodeDetectorOutput`/`mapGuidanceIssues` and maps it to `E_MODEL_CONTRACT`; option errors are excluded because callers validate options first with `validateDetectionOptions` (which runs `mapGuidanceIssues({ detections: [] }, options)` and checks `staleAfterMs` is a finite number > 0). `mergeDetection` treats `now - at > staleAfterMs` or `now < at` as stale; it appends model issues to `frame.issues` (the reducer deduplicates and sorts).
- [ ] **Step 4: Run the test again** — expected: PASS.
- [ ] **Step 5: Commit** `feat: add pure detection snapshot and merge for frame guidance`.

### Task 2: Auto-capture reducer and screen-to-frame mapping

**Files:**
- Create: `src/guidance/autoCapture.ts`, `src/guidance/screenRect.ts`
- Test: `src/__tests__/auto-capture.test.ts`, `src/__tests__/screen-rect.test.ts`

**Interfaces:**
- Produces:
  - `const DEFAULT_AUTO_CAPTURE_HOLD_MS = 800`
  - `interface AutoCaptureState { readySince: number | null; fired: boolean; due: boolean }`
  - `function createAutoCaptureState(): AutoCaptureState` → `{ readySince: null, fired: false, due: false }`
  - `function reduceAutoCapture(state: AutoCaptureState, input: { ready: boolean; now: number }, holdMs: number): AutoCaptureState`
  - `function acknowledgeAutoCapture(state: AutoCaptureState): AutoCaptureState` (sets `due: false`, keeps `fired`)
  - `interface ScreenRect { x: number; y: number; width: number; height: number }`, `interface Size { width: number; height: number }`
  - `function screenRectToFrameBox(rect: ScreenRect, view: Size, frame: Size): ModelBox` for a `resizeMode="cover"` preview; `frame` is the upright frame size.

- [ ] **Step 1: Write the failing tests**

```ts
it('fires once after holdMs of continuous ready and re-arms after ready drops', () => {
  let s = createAutoCaptureState();
  s = reduceAutoCapture(s, { ready: true, now: 0 }, 800);
  s = reduceAutoCapture(s, { ready: true, now: 799 }, 800);
  expect(s.due).toBe(false);
  s = reduceAutoCapture(s, { ready: true, now: 800 }, 800);
  expect(s.due).toBe(true);
  s = acknowledgeAutoCapture(s);
  s = reduceAutoCapture(s, { ready: true, now: 5000 }, 800);
  expect(s.due).toBe(false);
  s = reduceAutoCapture(s, { ready: false, now: 5001 }, 800);
  s = reduceAutoCapture(s, { ready: true, now: 5002 }, 800);
  s = reduceAutoCapture(s, { ready: true, now: 5802 }, 800);
  expect(s.due).toBe(true);
});
it('rejects a negative or non-finite hold', () => {
  expect(() => reduceAutoCapture(createAutoCaptureState(), { ready: true, now: 0 }, -1)).toThrow(RangeError);
});
it('maps a centered rect through the cover crop', () => {
  // A 480 x 640 portrait frame shown in a 390 x 844 view: scale 1.31875, frame shown 633 x 844, 121.5 px cropped each side.
  expect(screenRectToFrameBox({ x: 0, y: 0, width: 390, height: 844 }, { width: 390, height: 844 }, { width: 480, height: 640 }))
    .toEqual([expect.closeTo(0.19194, 4), 0, expect.closeTo(0.80806, 4), 1]);
});
it('maps the same rect differently for a landscape frame', () => {
  const rect = { x: 45, y: 300, width: 300, height: 225 };
  const view = { width: 390, height: 844 };
  expect(screenRectToFrameBox(rect, view, { width: 640, height: 480 })).not.toEqual(screenRectToFrameBox(rect, view, { width: 480, height: 640 }));
});
it('clamps to [0, 1] and rejects empty sizes', () => {
  expect(screenRectToFrameBox({ x: -10, y: -10, width: 1000, height: 2000 }, { width: 390, height: 844 }, { width: 480, height: 640 })).toEqual([0, 0, 1, 1]);
  expect(() => screenRectToFrameBox({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 1 }, { width: 1, height: 1 })).toThrow(RangeError);
});
```

- [ ] **Step 2: Run `npx jest src/__tests__/auto-capture.test.ts src/__tests__/screen-rect.test.ts`** — expected: FAIL, modules not found.
- [ ] **Step 3: Implement both modules.** Cover mapping: `scale = max(view.width / frame.width, view.height / frame.height)`, shown size `frame * scale`, offset `(shown - view) / 2`, box `[(x + offX) / shownW, (y + offY) / shownH, (x + width + offX) / shownW, (y + height + offY) / shownH]`, each clamped to `[0, 1]`; non-finite or non-positive sizes throw `RangeError`.
- [ ] **Step 4: Run the tests again** — expected: PASS.
- [ ] **Step 5: Commit** `feat: add auto-capture reducer and screen-to-frame box mapping`.

### Task 3: Guidance session reducer, hook wiring, plugin factory, exports

The repository has no React renderer in its test dependencies (the example tests mock hooks), and no new dependency is allowed, so the hook's behavior lives in a pure session reducer that is tested directly; the hook only holds its state.

**Files:**
- Create: `src/guidance/session.ts`
- Modify: `src/guidance/useParkingGuidance.ts`, `src/guidance/frameAnalyzer.ts`, `src/index.tsx`
- Test: `src/__tests__/guidance-session.test.ts` (create), `src/__tests__/guidance-api.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 and Task 2 exports, `createGuidanceState`/`reduceGuidance` (`src/guidance/reducer.ts`).
- Produces:
  - `interface GuidanceSessionOptions extends GuidanceOptions { detection?: DetectionOptions; autoCapture?: { holdMs?: number } }`
  - `interface GuidanceSessionState { guidance: GuidanceReducerState; snapshot: DetectionSnapshot | null; detectorError: string | null; autoCapture: AutoCaptureState; generation: number }`
  - `type GuidanceSessionEvent = { type: 'frame'; frame: GuidanceFrameResult; now: number } | { type: 'detection'; result: DetectorFrameResult; generation: number; now: number } | { type: 'reset' } | { type: 'acknowledgeAutoCapture' }`
  - `function validateGuidanceSessionOptions(options: GuidanceSessionOptions): void` (throws `RangeError`; checks `detection` with `validateDetectionOptions` and `autoCapture.holdMs`)
  - `function createGuidanceSession(): GuidanceSessionState`
  - `function reduceGuidanceSession(state: GuidanceSessionState, event: GuidanceSessionEvent, options: GuidanceSessionOptions): GuidanceSessionState`
  - `createParkingDetector<Frame>(proxy: { initFrameProcessorPlugin(name: string, options: Record<string, string | number>): { call(frame: Frame): unknown } | undefined }, options: { modelUri: string }): (frame: Frame) => DetectorFrameResult` — plugin name `parkingDetector`; throws the same "unavailable" error shape as `createParkingFrameAnalyzer` when the plugin is missing; returns `{ error: 'E_INFERENCE' }` when the call returns nothing.
  - `useParkingGuidance(options?: GuidanceSessionOptions)` returning `ParkingGuidance` extended with `onDetectorResult(result: DetectorFrameResult): void`, `detectorError: string | null`, `autoCaptureDue: boolean`, `acknowledgeAutoCapture(): void`.
  - Exports from `src/index.tsx`: `createParkingDetector`, `screenRectToFrameBox`, `DEFAULT_DETECTION_STALE_MS`, `DEFAULT_AUTO_CAPTURE_HOLD_MS`, `createGuidanceSession`, `reduceGuidanceSession`, and the types `DetectorFrameResult`, `DetectionOptions`, `GuidanceSessionOptions`, `GuidanceSessionState`, `GuidanceSessionEvent`, `ScreenRect`, `Size`.

- [ ] **Step 1: Write the failing tests** in `guidance-session.test.ts` (helper `frame(now)` dispatches `{ type: 'frame', frame: { ready: true, issues: [], progress: 1 }, now }`; `debounceFrames: 1` keeps assertions short):
  - `it('stays not ready until a fresh detection arrives when detection is configured')`: frame at 0 → `guidance.guidance.ready === false`; detection `VEHICLE` (generation 0) at 10, frame at 20 → `ready === true`; frame at 1600 → `ready === false` (stale).
  - `it('shows NO_VEHICLE for an empty detection and detectorError for a failure')`: empty result → issues contain `'NO_VEHICLE'`, `detectorError === null`; `{ error: 'E_MODEL_LOAD' }` → issues do not contain `'NO_VEHICLE'`, `detectorError === 'E_MODEL_LOAD'`, `ready === false`.
  - `it('ignores a detection from before a reset')`: `reset` increments `generation` to 1; a detection event with `generation: 0` leaves `snapshot === null`.
  - `it('raises autoCaptureDue once after holdMs of ready')`: with `autoCapture: { holdMs: 800 }`, a fresh detection and ready frames at 0 and 800 → `autoCapture.due === true`; `acknowledgeAutoCapture` then a frame at 2000 → `false`.
  - `it('behaves as before without detection')`: same frames without `detection` give the same `guidance` as `reduceGuidance` and `detectorError === null`.
  - `it('rejects invalid session options')`: `validateGuidanceSessionOptions({ detection: { staleAfterMs: -1 } })` and `({ autoCapture: { holdMs: Number.NaN } })` throw `RangeError`.
  - In `guidance-api.test.ts`: `createParkingDetector` with a fake proxy calls `initFrameProcessorPlugin('parkingDetector', { modelUri: '/m.tflite' })` and returns the plugin result; a proxy returning `undefined` throws; a plugin returning `undefined` yields `{ error: 'E_INFERENCE' }`.
- [ ] **Step 2: Run `npx jest src/__tests__/guidance-session.test.ts src/__tests__/guidance-api.test.ts`** — expected: FAIL.
- [ ] **Step 3: Implement.** `reduceGuidanceSession` merges with `mergeDetection(..., now, detection.staleAfterMs ?? DEFAULT_DETECTION_STALE_MS)` only when `detection` is set, then `reduceGuidance`, then `reduceAutoCapture` on the reduced `ready` when `autoCapture` is set. The hook calls `validateGuidanceSessionOptions` in the render body (so invalid options throw during render), keeps the session in `useState`, passes `Date.now()` as `now`, and creates `onDetectorResult` with `useCallback` over the current `generation` so a callback captured before `reset()` carries the old generation.
- [ ] **Step 4: Run the tests again and the full suite `yarn test`** — expected: PASS.
- [ ] **Step 5: Commit** `feat: add detector results and auto-capture to useParkingGuidance`.

### Task 4: Android YUV frame to upright ARGB pixels

**Files:**
- Create: `android/src/main/java/com/parkingguide/FramePixels.kt`
- Test: `android/src/test/java/com/parkingguide/FramePixelsTest.kt`

**Interfaces:**
- Produces:
  - `object FramePixels { fun uprightSize(width: Int, height: Int, rotationDegrees: Int): Pair<Int, Int>; fun toArgb(y: ByteBuffer, u: ByteBuffer, v: ByteBuffer, width: Int, height: Int, yRowStride: Int, uvRowStride: Int, uvPixelStride: Int, rotationDegrees: Int, mirrored: Boolean, videoRange: Boolean): IntArray }`
  - `toArgb` returns `DetectorTensors.INPUT_SIZE²` opaque ARGB pixels of the frame rotated clockwise by `rotationDegrees` (0, 90, 180, 270; `ImageInfo.rotationDegrees` semantics), mirrored horizontally after rotation when `mirrored`, sampled nearest-neighbor, with BT.601 YUV→RGB for video or full range.

- [ ] **Step 1: Write the failing tests**
  - `uprightSize(640, 480, 90) == Pair(480, 640)`, `uprightSize(640, 480, 180) == Pair(640, 480)`.
  - A solid frame (Y=128, U=V=128, full range) gives every pixel `0xff808080` within ±1 per channel.
  - A 4 × 2 frame whose left half has Y=255 and right half Y=0 (U=V=128, full range): rotation 0 gives white in output column 0 and black in column 511; rotation 90 gives white in row 0 and black in row 511; rotation 180 swaps columns; rotation 270 swaps rows; `mirrored = true` at rotation 0 swaps columns.
  - Row stride larger than width (padding bytes set to 0) and `uvPixelStride = 2` (interleaved) give the same output as packed planes.
  - `rotationDegrees = 45` throws `IllegalArgumentException`.
- [ ] **Step 2: Run** `cd example/android && ./gradlew :react-native-parking-guide:testDebugUnitTest --tests com.parkingguide.FramePixelsTest` — expected: FAIL (unresolved reference).
- [ ] **Step 3: Implement `FramePixels`.** For each output pixel, map to the upright source coordinate, undo the rotation to the sensor coordinate, read Y at `row * yRowStride + col` and U/V at `(row / 2) * uvRowStride + (col / 2) * uvPixelStride`, convert, and clamp.
- [ ] **Step 4: Run the test again** — expected: PASS (delete `android/build/reports` afterwards).
- [ ] **Step 5: Commit** `feat: convert Android camera frames to upright detector pixels`.

### Task 5: Android shared detector and `parkingDetector` plugin

**Files:**
- Modify: `android/src/main/java/com/parkingguide/ParkingDetector.kt`, `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`, `android/src/visionCamera/java/com/parkingguide/ParkingGuideFrameProcessors.kt`
- Create: `android/src/main/java/com/parkingguide/ParkingDetectors.kt`
- Test: `android/src/androidTest/java/com/parkingguide/ParkingDetectorTest.kt` (extend)

**Interfaces:**
- Consumes: `FramePixels` (Task 4).
- Produces:
  - `ParkingDetector.runPixels(pixels: IntArray, model: PhotoSource): Map<String, DoubleArray>` (synchronized; `run(photo, model)` becomes `runPixels(readPixels(photo), model)`).
  - `object ParkingDetectors { fun forContext(context: ReactApplicationContext): ParkingDetector; fun close(context: ReactApplicationContext) }` — one instance per context, using an opener that reads files with `FileInputStream` and `content://` with the context's `ContentResolver` (move `openPhoto` here as `openSource(context, source)` and use it for hashing too).
  - Plugin `parkingDetector` (registered next to `parkingGuide`): options `{ modelUri: String }` resolved with `FileSha256.resolve` (invalid → every call returns `{ error: "E_INVALID_URI" }`); `callback(frame)` checks it is not on the main or JS thread, reads `frame.image` (`YUV_420_888` only, else `{ error: "E_PHOTO_READ" }`), `frame.imageProxy.imageInfo.rotationDegrees`, `frame.isMirrored`, converts with `FramePixels.toArgb`, calls `ParkingDetectors.forContext(proxy.context).runPixels`, and returns `mapOf("boxes" to List<Double>, "scores" to ..., "classes" to ..., "frameWidth" to uprightWidth, "frameHeight" to uprightHeight)` or `mapOf("error" to failure.code)`.
  - `ParkingGuideModule` uses `ParkingDetectors.forContext(reactApplicationContext)` and calls `ParkingDetectors.close` in `invalidate`.

- [ ] **Step 1: Write the failing instrumented test** `runsAFramePixelPathWithTheSharedFixture`: build a solid YUV frame equivalent to `solid.png` (RGB 204, 102, 51 converted to full-range Y/U/V), convert with `FramePixels.toArgb(..., rotationDegrees = 90, mirrored = false, videoRange = false)`, run `runPixels` on `detector-nhwc.tflite`, and assert the row-0 score is 0.8 within 2e-2 (YUV rounding) and `boxes` equals the fixture box.
- [ ] **Step 2: Build** `./gradlew :react-native-parking-guide:assembleDebugAndroidTest` — expected: FAIL to compile (`runPixels` missing).
- [ ] **Step 3: Implement the refactor, `ParkingDetectors`, and the plugin.** Existing `ParkingDetectorTest` cases must keep passing unchanged.
- [ ] **Step 4: Build the test APK and run unit tests** (`assembleDebugAndroidTest`, `testDebugUnitTest`) — expected: BUILD SUCCESSFUL. Running `connectedDebugAndroidTest` needs a device; record it as Andrew's step in the PR.
- [ ] **Step 5: Commit** `feat: run the shared detector on Android camera frames`.

### Task 6: iOS pixel-buffer path, shared detector, `parkingDetector` plugin

**Files:**
- Modify: `ios/ParkingGuideDetector.h`, `ios/ParkingGuideDetector.mm`, `ios/ParkingGuide.mm`, `ParkingGuide.podspec`, `scripts/detector-harness/main.mm`, `scripts/detector-harness/run.sh`
- Create: `ios/ParkingGuideDetectorFrameProcessor.mm`

**Interfaces:**
- Produces:
  - `+ (ParkingGuideDetector *)shared` and `+ (dispatch_queue_t)sharedQueue` (serial); `ParkingGuide.mm` uses both instead of its own instance and queue, and `invalidate` resets the shared detector on the shared queue.
  - `- (nullable NSDictionary<NSString *, id> *)runWithPixelBuffer:(CVPixelBufferRef)buffer orientation:(CGImagePropertyOrientation)orientation modelURL:(NSURL *)modelURL errorCode:(NSString **)errorCode message:(NSString **)message;` returning the photo path's three arrays plus `frameWidth` and `frameHeight` (upright extent). Photo and pixel-buffer paths share one private method that takes the 512 × 512 RGBX buffer.
  - Pixel path: `CIImage imageWithCVPixelBuffer:` → `imageByApplyingCGOrientation:` → scale to 512 × 512 → render with one reused `CIContext` into RGBX (`kCIFormatRGBA8`, sRGB).
  - Plugin `parkingDetector` (`VISION_EXPORT_FRAME_PROCESSOR`, guarded like `ParkingGuideFrameProcessor.mm`): options `{ modelUri }` resolved with the same rule as `ParkingGuideFileURL` (invalid → `@{ @"error": @"E_INVALID_URI" }`); `callback` maps `frame.orientation` (`UIImageOrientation`) and `frame.isMirrored` to the matching `CGImagePropertyOrientation` (mirrored variants when `isMirrored`), runs `dispatch_sync([ParkingGuideDetector sharedQueue], ...)`, and returns the dictionary or `@{ @"error": code }`.
  - Podspec: add `ios/ParkingGuideDetectorFrameProcessor.mm` to `exclude_files` in the no-camera branch, and add `CoreImage` to both `frameworks` lists.
  - Harness: `main.mm` accepts `--pixel-buffer <r> <g> <b> <orientation>` to build a 640 × 480 `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange` buffer of that color and run `runWithPixelBuffer`.

- [ ] **Step 1: Extend `run.sh` first** with checks: for NHWC and NCHW fixtures and orientations `1` (up), `6` (right), `5` (left-mirrored), a solid (204, 102, 51) pixel buffer gives row-0 score 0.8 within 2e-2 and `frameWidth`/`frameHeight` of 640/480 for orientation 1 and 480/640 for 6 and 5.
- [ ] **Step 2: Run `sh scripts/detector-harness/run.sh`** — expected: FAIL (unknown option or missing method).
- [ ] **Step 3: Implement the refactor, shared accessors, the plugin, and the podspec change.** The existing harness checks (photo path, `.mlmodelc`, unsupported model) must keep passing.
- [ ] **Step 4: Run the harness again** — expected: all PASS. The iOS module and plugin wiring compile first in CI `build-ios`.
- [ ] **Step 5: Commit** `feat: run the shared detector on iOS camera frames`.

### Task 7: Example app and documentation

**Files:**
- Create: `example/src/detectorModel.ts`
- Modify: `example/src/CaptureScreen.tsx`, `example/src/__tests__/CaptureScreen.test.ts`, `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: Task 3 exports.
- Produces: `export const DETECTOR_MODEL_URI: string | undefined = undefined;` with a comment pointing to the README device smoke test.

- [ ] **Step 1: Write the failing example test** `it('disables the shutter and explains a detector failure')`: render `CameraCapture` with a mocked `useParkingGuidance` returning `{ ready: false, issues: [], detectorError: 'E_MODEL_LOAD' }` → shutter `disabled`, and a message "The parking model could not run." is shown instead of the no-vehicle text; and `it('shows an auto capture switch only when a detector model is configured')`.
- [ ] **Step 2: Run `npx jest example`** — expected: FAIL.
- [ ] **Step 3: Implement.** When `DETECTOR_MODEL_URI` is set: create `createParkingDetector(VisionCameraProxy, { modelUri })`, call it with `runAtTargetFps(2, () => runAsync(frame, () => deliverDetection(detect(frame))))` in the existing frame processor, pass `detection: { guideFrame, vehicleType }` where `guideFrame` comes from `screenRectToFrameBox` on the measured guide-frame and camera-view layouts and the latest result's `frameWidth`/`frameHeight` (until the first result, pass no `guideFrame`), show the `detectorError` message, add an "Auto capture" `Switch` that sets `autoCapture: { holdMs: DEFAULT_AUTO_CAPTURE_HOLD_MS }`, and call the existing `capturePhoto` then `acknowledgeAutoCapture()` when `autoCaptureDue` turns true.
- [ ] **Step 4: Run `yarn typecheck && yarn lint && yarn test`** — expected: all pass.
- [ ] **Step 5: Document.** README: `createParkingDetector`, the `detection` and `autoCapture` hook options, `detectorError`, `screenRectToFrameBox`, the new exports, the fail-closed rule, the provisional `staleAfterMs`, the shared-model serialization, and the device smoke test steps copied from the spec; update implementation status step 1. AGENTS.md: pipeline step 1 and the layout table rows for the new files.
- [ ] **Step 6: Commit** `feat(example): show live detector guidance and auto capture` and `docs: document realtime frame detection`.

## Reconciliation (2026-10-25, after execution)

The shipped code on `feat/realtime-frame-detection` is the authority where it differs from the steps above.

- Task 2: the clamp test uses `x: -200`; the planned `x: -10` lies inside the cover-cropped frame and cannot produce `[0, 0, 1, 1]`.
- Task 3: the `createParkingDetector` tests live in `src/__tests__/frame-analyzer.test.ts`, and the hook reads options through a ref so its callbacks stay stable.
- Task 5: CameraX's `ImageProxy` is not on the library classpath, so the Android plugin derives the clockwise rotation from VisionCamera's `Frame.orientation` (the reverse of `rotationDegrees`).
- Task 6: `ParkingGuideFileURL` moved to `ios/ParkingGuideDetector.{h,mm}`. The final review found that VisionCamera's iOS `Frame.orientation` is the frame's own orientation, so the planned straight `UIImageOrientation` → `CGImagePropertyOrientation` mapping turned portrait frames upside down; `ParkingGuideUprightOrientation` swaps Left and Right, and the harness now checks the table and a two-tone frame's content.
- Task 7: the example tests cover new pure helpers (`captureMessages`, `captureDisclaimer`, `frameSizeChange`, `usableGuideBox`) because the example test harness renders no hook-using component.
- Final review fixes: detector results carry `capturedAt` (taken before inference) and freshness is measured from it; auto-capture state resets while auto capture is off; the example drops a result whose frame size changed; Android reports a frame conversion error as `E_PHOTO_READ`.

## Reconciliation (2026-10-26, demo detector fixture)

The shipped code on `feat/demo-detector` is the authority for the example model setting in Task 7.
`example/src/detectorModel.ts` now exports `DETECTOR_MODEL` instead of `DETECTOR_MODEL_URI`, and `detectorModelUri` resolves a bare file name inside the app's files directory, which the native example app passes as the `filesDirectory` initial property.
The reason: on an iOS device the absolute path of the app's data container changes between installs, so an absolute `DETECTOR_MODEL_URI` could not point at a model copied into `Documents`.
The device smoke test now uses `fixtures/detector/detector-demo.*`, because the fixed box of `detector-nhwc` lies outside the guide frame and kept the shutter disabled.
Tests: `example/src/__tests__/demoDetector.test.ts`.
