# Copilot code review instructions

Project context, layout, and commands are in `AGENTS.md`; do not restate them in review comments.
Write review comments in English. Focus on the risks below. Comment only on concrete problems; do not comment on formatting that ESLint or Prettier already enforces.

## Rule engine (`src/policy/`)

- `evaluatePolicy` must stay pure and deterministic: no I/O, `Date`, `Math.random`, platform checks, or input mutation.
- Flag changes that alter verdict semantics (score clamping, `PASS=1`/`WARN=0.5`/`FAIL=0` defaults, weighted mean, `failBelow` hard-fail for `severity: 'FAIL'`, `passThreshold`) without matching tests in `src/__tests__/`.
- Watch for division by zero, `NaN` scores, and disabled/unknown rules leaking into the score.
- `defaultPolicy` changes affect every consumer's verdicts — require a clear justification and test updates.

## Native API / TurboModule

- A change to `Spec` in `src/NativeParkingGuide.ts` must be mirrored in `ios/ParkingGuide.mm`, `android/src/main/java/com/parkingguide/ParkingGuideModule.kt`, and `src/index.tsx`. Flag any missing side.
- Types must be codegen-compatible (no unions of objects, generics, or `any` in `Spec`).
- iOS and Android must return identical values/shapes (e.g. `runDetector()`).
- Flag blocking work on the JS thread or main thread (camera frames, model inference) and leaked native resources.

## Public API & types

- New public types/functions must be exported from `src/index.tsx`; flag accidental removals or renames (breaking change).
- Changes to `RuleId`, `Verdict`, `VerificationResult`, or `ParkingPolicy` are breaking — expect a `feat!`/`BREAKING CHANGE` commit.
- Use `import type` for type-only imports.

## Privacy & security

- Photos, location, and device data are sensitive: flag logging of them, uploads without explicit opt-in, or new network calls.
- No secrets, keys, or hardcoded endpoints in source.

## Out of scope

- Do not review `lib/` (generated output), native build directories, or the vendored skill directories under `.github/skills/` (they are re-synced from rn-agents-kit upstream). `.github/skills/README.md` is repository-local and is reviewed normally.

## Language and wording

- Flag any code, comment, documentation, commit message, or pull request text that is not in English.
- Flag documentation wording that is ambiguous, for example vague references instead of exact file/symbol names, or conditions without explicit thresholds.
