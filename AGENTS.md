# AGENTS.md

Guidance for AI coding agents working in this repository.
이 저장소에서 작업하는 AI 코딩 에이전트를 위한 가이드입니다.

## Project overview / 프로젝트 개요

`react-native-parking-guide` is a React Native native package (TurboModule, New Architecture) for iOS and Android.
It guides shared personal-mobility users (bicycle, kickboard, e-bike, motorcycle, ...) while they photograph their
parked vehicle with the camera, and decides whether the vehicle is parked properly: `PASS` / `WARN` / `FAIL`.

공유 퍼스널 모빌리티(자전거, 킥보드, 전기자전거, 모터사이클 등) 이용자가 카메라로 주차 상태를 촬영할 때 가이드를 제공하고,
올바르게 주차했는지 통과 여부(`PASS` / `WARN` / `FAIL`)를 판정하는 iOS/Android용 React Native 네이티브 패키지입니다.

Planned pipeline (see `README.md` roadmap; not all implemented yet):

1. Realtime capture guidance via a `react-native-vision-camera` frame processor → `GuidanceState` / `GuidanceIssue`.
2. On-device inference (CoreML on iOS, TFLite on Android) → per-rule `RuleResult[]`.
3. Pure TypeScript JSON-policy rule engine (`evaluatePolicy`) → final `Verdict` and score.

## Setup and commands / 개발 명령

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

Before finishing any change, run `yarn typecheck`, `yarn lint`, and `yarn test` — all must pass.
CI (`.github/workflows/ci.yml`) also builds the library and the example app for Android and iOS.

## Repository layout / 저장소 구조

| Path | Purpose |
| --- | --- |
| `src/index.tsx` | Public JS API. Export every new public type/function here. |
| `src/NativeParkingGuide.ts` | TurboModule codegen spec (`Spec`). Codegen config in `package.json` → `codegenConfig`. |
| `src/types.ts` | Domain types: `VehicleType`, `Verdict`, `RuleId`, `RuleResult`, `GuidanceState`, `ParkingPolicy`, `VerificationResult`. |
| `src/policy/defaultPolicy.ts` | Default `ParkingPolicy` (weights, severities, `failBelow`, `passThreshold`). |
| `src/policy/evaluate.ts` | `evaluatePolicy(ruleResults, policy)` — pure, platform-independent. |
| `src/__tests__/` | Jest tests. |
| `ios/ParkingGuide.{h,mm}` | Objective-C++ TurboModule implementation. |
| `android/src/main/java/com/parkingguide/` | Kotlin `ParkingGuideModule` / `ParkingGuidePackage`. |
| `ParkingGuide.podspec`, `android/build.gradle` | Native build configuration. |
| `example/` | Example app used for manual testing and CI native builds. |
| `.github/skills/` | Vendored React Native agent skills (rn-agents-kit, Apache-2.0). Do not edit. |
| `lib/` | Generated build output — never edit by hand. |

## Verdict rules / 판정 규칙 (`evaluatePolicy`)

- Rules missing from the policy or with `enabled: false` are ignored.
- Rule score: `score` clamped to 0..1 if present, otherwise `PASS=1`, `WARN=0.5`, `FAIL=0`.
- Overall score: weighted mean (default weight `1`); `1` if no enabled rules.
- Hard fail: a rule with `severity: 'FAIL'` whose verdict is `FAIL` or whose score is below `failBelow` → `FAIL`.
- Otherwise `PASS` if score ≥ `passThreshold`, else `WARN`.

Keep the engine pure and deterministic, and add or update tests in `src/__tests__/` for any behavior change.

## Changing the native API / 네이티브 API 변경

When adding or changing a method on `Spec` in `src/NativeParkingGuide.ts`, update all of these together:

1. `ios/ParkingGuide.mm` (and `ios/ParkingGuide.h` if needed)
2. `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`
3. JS wrapper and exports in `src/index.tsx`

`getModelVersion()` returns `"0.1.0-dev"` on both platforms — keep native values in sync.

## Agent skills / 에이전트 스킬

React Native maintenance skills from [AndrewDongminYoo/rn-agents-kit](https://github.com/AndrewDongminYoo/rn-agents-kit)
are vendored under `.github/skills/` (Apache-2.0). Each skill has a `SKILL.md` describing when and how to use it,
e.g. `rn-project-snapshot`, `rn-newarch-audit`, `rn-audit`, `rn-upgrade-pulse`, `rn-device-capture`, `rn-metro-console`.
They are audit-first: inspect and report before changing anything. See `.github/skills/README.md` for the full list.
Do not edit vendored skill files; they are excluded from ESLint.

`.github/skills/`에 rn-agents-kit의 React Native 유지보수 스킬이 포함되어 있습니다. 각 `SKILL.md`를 참고하세요.

## Conventions / 코드 스타일

- TypeScript `strict`; use `import type` for type-only imports.
- Prettier: single quotes, 2-space indent, `trailingComma: es5`.
- Conventional Commits (enforced by commitlint via lefthook), e.g. `feat: ...`, `fix: ...`, `docs: ...`.
- Docs are bilingual (English/Korean); keep both languages in sync when editing `README.md` or this file.
- Keep `.github/copilot-instructions.md` consistent with this file when project guidance changes.
