# react-native-parking-guide

React Native library scaffold for guiding shared personal mobility users (bicycle, kickboard, e-bike, motorcycle, auto) to take parking photos and verify parking outcomes (`PASS` / `WARN` / `FAIL`) on iOS and Android.

공유 퍼스널 모빌리티(자전거, 킥보드, 전기자전거, 모터사이클, 자동차) 주차 사진 촬영 가이드와 주차 판정(`PASS` / `WARN` / `FAIL`)을 iOS/Android에서 제공하기 위한 React Native 라이브러리입니다.

## Planned Architecture / 계획 아키텍처

- `react-native-vision-camera` frame processor for realtime guidance.
- On-device inference with CoreML (iOS) / TFLite (Android).
- JSON policy-driven rule engine in TypeScript (`evaluatePolicy`) for final verdict.

- `react-native-vision-camera` 프레임 프로세서 기반 실시간 촬영 가이드.
- CoreML(iOS) / TFLite(Android) 온디바이스 추론.
- TypeScript JSON 정책(rule) 엔진(`evaluatePolicy`)으로 최종 판정.

## Roadmap / 로드맵

- **MVP v0.1**: Turbo Module scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.5**: prohibited-zone rules (tactile paving/crosswalk/roadway), geofence integration, richer guidance signals.
- **v1.0**: production on-device model pipeline, attestation support, upload/verification integration.

- **MVP v0.1**: 터보 모듈 스캐폴드, 타입 API 스켈레톤, 정책 엔진, 네이티브 모델 버전 스텁.
- **v0.5**: 금지구역 규칙 고도화(점자블록/횡단보도/차도), 지오펜스 연동, 가이드 신호 확장.
- **v1.0**: 운영용 온디바이스 추론 파이프라인, 무결성(attestation), 업로드/검증 연동.

## Installation

```sh
npm install react-native-parking-guide
```

## Development

```sh
yarn
yarn typecheck
yarn lint
yarn test
yarn example ios
yarn example android
```

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
