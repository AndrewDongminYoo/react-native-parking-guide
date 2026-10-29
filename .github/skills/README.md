# Agent skills

These skills are vendored from [AndrewDongminYoo/rn-agents-kit](https://github.com/AndrewDongminYoo/rn-agents-kit)
(commit `1090fd6a04b547ed4316742c98061f945f603c76`, plugin version `0.2.1`), licensed under Apache-2.0 —
see [`LICENSE-rn-agents-kit`](./LICENSE-rn-agents-kit). Bundled third-party code under
`rn-upgrade-pulse/vendor/` keeps its own license files.

All skills are audit-first: they inspect and report first, and do not modify the project without explicit approval.

| Skill                  | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `rn-project-snapshot`  | Read-only snapshot of RN version, New Architecture / Hermes flags, configs      |
| `rn-asset-hygiene`     | Find unused images / SVG / Lottie, consolidate `require()` paths                |
| `rn-newarch-audit`     | New Architecture readiness of dependencies and native modules                   |
| `rn-audit`             | Evidence-based code audit (rendering, hooks, lists, native boundaries, effects) |
| `rn-device-capture`    | Screenshot the running app on Android / iOS into `logs/`                        |
| `rn-metro-console`     | Read the running app's `console.*` output via Metro CDP                         |
| `rn-device-qa`         | Route runtime QA evidence (screenshots, logs, interactive QA)                   |
| `rn-ci-artifact-audit` | Inventory GitHub Actions artifact evidence                                      |
| `rn-eas-profile-audit` | Resolve an EAS build profile and its `extends` chain                            |
| `rn-upgrade-pulse`     | Record the upgrade surface before a React Native / Expo version bump            |

Do not edit the vendored skill directories or `LICENSE-rn-agents-kit` locally; update them by re-syncing from upstream.
This `README.md` is a repository-local index and may be edited.
