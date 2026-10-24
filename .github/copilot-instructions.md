# Copilot code review instructions

Project context, layout, and commands live in `AGENTS.md` — do not repeat them in review comments.
Write review comments in Korean. Focus reviews on the risks below. Comment only on concrete problems; skip style that ESLint/Prettier already enforce.

## Rule engine (`src/policy/`)

- `evaluatePolicy` must stay pure and deterministic: no I/O, `Date`, `Math.random`, platform checks, or input mutation.
- Flag changes that alter verdict semantics (score clamping, `PASS=1`/`WARN=0.5`/`FAIL=0` defaults, weighted mean, `failBelow` hard-fail for `severity: 'FAIL'`, `passThreshold`) without matching tests in `src/__tests__/`.
- Watch for division by zero, `NaN` scores, and disabled/unknown rules leaking into the score.
- `defaultPolicy` changes affect every consumer's verdicts — require a clear justification and test updates.

## Native API / TurboModule

- A change to `Spec` in `src/NativeParkingGuide.ts` must be mirrored in `ios/ParkingGuide.mm`, `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`, and `src/index.tsx`. Flag any missing side.
- Types must be codegen-compatible (no unions of objects, generics, or `any` in `Spec`).
- iOS and Android must return identical values/shapes (e.g. `getModelVersion()`).
- Flag blocking work on the JS thread or main thread (camera frames, model inference) and leaked native resources.

## Public API & types

- New public types/functions must be exported from `src/index.tsx`; flag accidental removals or renames (breaking change).
- Changes to `RuleId`, `Verdict`, `VerificationResult`, or `ParkingPolicy` are breaking — expect a `feat!`/`BREAKING CHANGE` commit.
- Use `import type` for type-only imports.

## Privacy & security

- Photos, location, and device data are sensitive: flag logging of them, uploads without explicit opt-in, or new network calls.
- No secrets, keys, or hardcoded endpoints in source.

## Do not review / do not edit

- `lib/` (generated), native build dirs, and `.github/skills/` (vendored from rn-agents-kit; re-sync upstream instead of editing).
- Flag new code, comments, or docs that are not written in English.
