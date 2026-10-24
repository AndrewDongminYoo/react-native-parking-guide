# Copilot Instructions — react-native-parking-guide

## 프로젝트 개요 / Overview

공유 퍼스널 모빌리티(자전거, 킥보드, 전기자전거, 모터사이클 등) 이용자가 반납 시 카메라로 주차 상태를 촬영하면,
촬영 가이드를 제공하고 올바르게 주차했는지 통과 여부(`PASS` / `WARN` / `FAIL`)를 판정하는 iOS/Android용 React Native 네이티브 패키지입니다.

A React Native native package (TurboModule, New Architecture) for iOS and Android that guides shared
personal-mobility users through a parking photo and verifies whether the vehicle is parked properly.

Planned architecture (see `README.md` roadmap):
- `react-native-vision-camera` frame processor for realtime capture guidance (`GuidanceState`, `GuidanceIssue`).
- On-device inference: CoreML (iOS) / TFLite (Android) producing per-rule `RuleResult`s.
- JSON-policy rule engine in TypeScript (`evaluatePolicy`) that produces the final verdict.

## 저장소 구조 / Layout

- `src/index.tsx` — public JS API. Every new public type/function must be exported here.
- `src/NativeParkingGuide.ts` — TurboModule codegen spec (`Spec`). Codegen config is in `package.json` → `codegenConfig` (`ParkingGuideSpec`, Android package `com.parkingguide`).
- `src/types.ts` — shared domain types (`VehicleType`, `Verdict`, `RuleId`, `RuleResult`, `ParkingPolicy`, `VerificationResult`, ...).
- `src/policy/defaultPolicy.ts` — default `ParkingPolicy` (weights, severities, `failBelow` thresholds, `passThreshold`).
- `src/policy/evaluate.ts` — `evaluatePolicy(ruleResults, policy)`; pure, platform-independent.
- `src/__tests__/` — Jest tests.
- `ios/ParkingGuide.{h,mm}` — Objective-C++ TurboModule implementation.
- `android/src/main/java/com/parkingguide/` — Kotlin TurboModule (`ParkingGuideModule`) and package (`ParkingGuidePackage`).
- `ParkingGuide.podspec`, `android/build.gradle` — native build configuration.
- `example/` — example app (Yarn workspace) used for manual and CI native builds.

## 판정 규칙 / Verdict semantics (`evaluatePolicy`)

- Rules not present in the policy or with `enabled: false` are ignored.
- Rule score = `score` (clamped to 0..1) if provided, otherwise `PASS=1`, `WARN=0.5`, `FAIL=0`.
- Final score = weighted mean (default weight `1`); `1` when no enabled rules.
- Any rule with `severity: 'FAIL'` whose verdict is `FAIL` or whose score is below `failBelow` → overall `FAIL` (hard fail).
- Otherwise `PASS` if score ≥ `passThreshold`, else `WARN`.

Keep the rule engine pure and deterministic; add/adjust tests in `src/__tests__/` when changing it.

## 네이티브 API 변경 시 / Changing the native API

When adding or changing a method on `Spec` in `src/NativeParkingGuide.ts`, update **all** of:
1. `ios/ParkingGuide.mm` (and header if needed),
2. `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`,
3. the JS wrapper/exports in `src/index.tsx`.

The native model version stub (`getModelVersion`) currently returns `"0.1.0-dev"` on both platforms; keep them in sync.

## 개발 명령 / Commands

Uses Yarn 4 (`packageManager: yarn@4.18.1`, Node version in `.nvmrc`).

```sh
yarn               # install (workspaces: root + example)
yarn typecheck     # tsc
yarn lint          # eslint "**/*.{js,ts,tsx}" (Prettier enforced via ESLint)
yarn test          # jest
yarn prepare       # build library with react-native-builder-bob → lib/
yarn example ios   # run example app on iOS
yarn example android
```

Always run `yarn typecheck`, `yarn lint`, and `yarn test` before finishing a change. CI (`.github/workflows/ci.yml`) runs these plus library, Android, and iOS builds.

## 코드 스타일 / Conventions

- TypeScript strict; Prettier: single quotes, 2-space indent, `trailingComma: es5`.
- Use `import type` for type-only imports.
- Commit messages follow Conventional Commits (commitlint + lefthook).
- Do not edit generated output in `lib/` or native build directories.
- Docs (README) are bilingual English/Korean; keep both in sync when updating.
