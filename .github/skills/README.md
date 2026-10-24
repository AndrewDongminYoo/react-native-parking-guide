# Agent skills / 에이전트 스킬

These skills are vendored from [AndrewDongminYoo/rn-agents-kit](https://github.com/AndrewDongminYoo/rn-agents-kit)
(commit `1090fd6a04b547ed4316742c98061f945f603c76`, plugin version `0.2.1`), licensed under Apache-2.0 —
see [`LICENSE-rn-agents-kit`](./LICENSE-rn-agents-kit). Bundled third-party code under
`rn-upgrade-pulse/vendor/` keeps its own license files.

이 디렉터리의 스킬은 [AndrewDongminYoo/rn-agents-kit](https://github.com/AndrewDongminYoo/rn-agents-kit)에서 가져온 것이며
Apache-2.0 라이선스를 따릅니다. 모든 스킬은 audit-first 방식으로, 먼저 점검·보고하고 명시적 동의 없이는 프로젝트를 변경하지 않습니다.

| Skill | Purpose |
| --- | --- |
| `rn-project-snapshot` | Read-only snapshot of RN version, New Architecture / Hermes flags, configs |
| `rn-asset-hygiene` | Find unused images / SVG / Lottie, consolidate `require()` paths |
| `rn-newarch-audit` | New Architecture readiness of dependencies and native modules |
| `rn-audit` | Evidence-based code audit (rendering, hooks, lists, native boundaries, effects) |
| `rn-device-capture` | Screenshot the running app on Android / iOS into `logs/` |
| `rn-metro-console` | Read the running app's `console.*` output via Metro CDP |
| `rn-device-qa` | Route runtime QA evidence (screenshots, logs, interactive QA) |
| `rn-ci-artifact-audit` | Inventory GitHub Actions artifact evidence |
| `rn-eas-profile-audit` | Resolve an EAS build profile and its `extends` chain |
| `rn-upgrade-pulse` | Record the upgrade surface before a React Native / Expo version bump |

Do not edit these files locally; update them by re-syncing from upstream.
로컬에서 직접 수정하지 말고, 업스트림에서 다시 동기화해 갱신하세요.
