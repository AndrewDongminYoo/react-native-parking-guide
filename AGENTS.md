# AGENTS.md

Guidance for AI coding agents working in this repository.

## Working rules

- **Language**:
  - Write chat replies to the user in Korean.
  - Write everything else in English: code, identifiers, comments, documentation, commit messages,
    pull request titles and descriptions, and review comments. This applies to new and existing content;
    when you edit a file that contains non-English text, translate that text to English.
- **Wording**: write documentation in precise, unambiguous terms. Use exact names (files, symbols, commands,
  values) instead of vague references, state conditions and thresholds explicitly, and avoid wording that a
  reader could interpret in more than one way.
- **Pushing**: a push makes work visible outside this environment. Commit locally while working. Push the branch
  only after the task is complete and `yarn typecheck`, `yarn lint`, and `yarn test` all pass.
  Do not push work in progress.

## Project overview

`react-native-parking-guide` is a React Native native package (TurboModule, New Architecture) for iOS and Android.
It guides users of rentable shared personal mobility vehicles while they photograph their parked vehicle with
the device camera, and returns a parking verdict of `PASS`, `WARN`, or `FAIL`.

Scope: rentable shared personal mobility only — bicycles, e-bikes, kickboards (including electric kickboards), and
motorcycles or mopeds. Cars are out of scope. In `VehicleType`, `'auto'` means "detect the vehicle type
automatically", not "automobile"; see the TSDoc on `VehicleType` in `src/types.ts`.

Planned pipeline (see the `README.md` roadmap). Step 3, JS guidance state processing, Android image-quality
frame analysis, and the native `getModelVersion()` stub are implemented; iOS frame analysis and inference are not:

1. Realtime capture guidance via a `react-native-vision-camera` frame processor → `GuidanceState` / `GuidanceIssue`.
2. On-device inference (CoreML on iOS, TFLite on Android) → per-rule `RuleResult[]`.
3. Pure TypeScript JSON-policy rule engine (`evaluatePolicy`) → final `Verdict` and score.

## Setup and commands

- Node: version in `.nvmrc`. Package manager: Yarn 4 (`yarn@4.18.1`, via Corepack).
- Workspaces: root library + `example/` app.

```sh
yarn                 # install dependencies
yarn typecheck       # tsc
yarn lint            # eslint (Prettier enforced through ESLint); add --fix to auto-format
yarn test            # jest
yarn prepare         # build library into lib/ with react-native-builder-bob
yarn example ios     # run example app on iOS
yarn example android # run example app on Android
```

Before you finish any change, run `yarn typecheck`, `yarn lint`, and `yarn test`. All three must exit successfully.
CI (`.github/workflows/ci.yml`) also builds the library and the example app for Android and iOS.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.tsx` | Public JS API. Export every new public type/function here. |
| `src/NativeParkingGuide.ts` | TurboModule codegen spec (`Spec`). Codegen config in `package.json` → `codegenConfig`. |
| `src/types.ts` | Domain types: `VehicleType`, `Verdict`, `RuleId`, `RuleResult`, `GuidanceState`, `ParkingPolicy`, `VerificationResult`. |
| `src/policy/defaultPolicy.ts` | Default `ParkingPolicy` (weights, severities, `failBelow`, `passThreshold`). |
| `src/policy/evaluate.ts` | `evaluatePolicy(ruleResults, policy)` — pure, platform-independent. |
| `src/guidance/` | Pure frame-result reduction and `useParkingGuidance`; frame results must be delivered on the JS thread. |
| `src/__tests__/` | Jest tests. |
| `ios/ParkingGuide.{h,mm}` | Objective-C++ TurboModule implementation. |
| `android/src/main/java/com/parkingguide/` | Kotlin `ParkingGuideModule` / `ParkingGuidePackage`. |
| `android/src/visionCamera/java/com/parkingguide/` | Optional frame processor and rotation-vector sensor lifecycle. |
| `android/src/test/java/com/parkingguide/` | Capture metric JUnit tests (`:react-native-parking-guide:testDebugUnitTest`). |
| `ParkingGuide.podspec`, `android/build.gradle` | Native build configuration. |
| `example/` | Example app used for manual testing and CI native builds. |
| `.github/skills/` | React Native agent skills vendored from rn-agents-kit (Apache-2.0). Do not edit, except `README.md`. |
| `lib/` | Generated build output — never edit by hand. |

## Verdict rules (`evaluatePolicy`)

- A `RuleResult` is ignored if `policy.rules` has no entry for its `id`, or if that entry has `enabled: false`.
- Rule score: if `RuleResult.score` is a number, it is clamped to the range [0, 1]; otherwise the score is
  derived from `verdict`: `PASS` → 1, `WARN` → 0.5, `FAIL` → 0.
- Overall score: the weighted mean of the scores of non-ignored rules, using `RulePolicy.weight`
  (default `1`). If the sum of weights is 0 (including when every rule is ignored), the overall score is `1`.
- Hard fail: the overall verdict is `FAIL` if any non-ignored rule has `severity: 'FAIL'` and either its
  `verdict` is `FAIL` or its score is strictly less than `failBelow`.
- Otherwise the overall verdict is `PASS` if the overall score is greater than or equal to `passThreshold`,
  and `WARN` if it is less.

Keep the engine pure and deterministic, and add or update tests in `src/__tests__/` for any behavior change.

## Changing the native API

When adding or changing a method on `Spec` in `src/NativeParkingGuide.ts`, update all of these together:

1. `ios/ParkingGuide.mm` (and `ios/ParkingGuide.h` if needed)
2. `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`
3. JS wrapper and exports in `src/index.tsx`

`getModelVersion()` returns `"0.1.0-dev"` on both platforms — keep native values in sync.

## Agent skills

React Native maintenance skills from [AndrewDongminYoo/rn-agents-kit](https://github.com/AndrewDongminYoo/rn-agents-kit)
are vendored under `.github/skills/` (Apache-2.0). Each skill has a `SKILL.md` describing when and how to use it,
e.g. `rn-project-snapshot`, `rn-newarch-audit`, `rn-audit`, `rn-upgrade-pulse`, `rn-device-capture`, `rn-metro-console`.
They are audit-first: they inspect and report before changing anything. See `.github/skills/README.md` for the full list.
Do not edit the skill directories or `LICENSE-rn-agents-kit`; update them by re-syncing from upstream.
`.github/skills/README.md` is a repository-local index and may be edited. The whole directory is excluded from ESLint.

## Conventions

- TypeScript `strict`; use `import type` for type-only imports.
- Prettier: single quotes, 2-space indent, `trailingComma: es5`.
- Conventional Commits (enforced by commitlint via lefthook), e.g. `feat: ...`, `fix: ...`, `docs: ...`.
- All code, comments, and documentation are in English (see Working rules).
- `.github/copilot-instructions.md` contains only the code review checklist. Put project context in this file, not there.
