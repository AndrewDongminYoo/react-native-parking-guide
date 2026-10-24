# react-native-parking-guide

한국어: 공유 퍼스널 모빌리티(자전거, 킥보드, 전기자전거, 모터사이클) 사용자가 주차 사진을 촬영할 때 가이드를 제공하고, 규칙 기반으로 PASS/WARN/FAIL 주차 판정을 반환하는 React Native 라이브러리입니다.

English: A React Native library that guides shared personal mobility users (bicycle, kickboard, e-bike, motorcycle) while taking a parking photo and returns PASS/WARN/FAIL parking verification results.

## Planned Architecture

- `react-native-vision-camera` frame processor for real-time camera guidance
- On-device inference with CoreML (iOS) / TFLite (Android)
- JSON-driven policy rule engine in TypeScript for final verdict evaluation

## Roadmap

- **MVP v0.1**: type-safe API skeleton, TurboModule bridge, policy evaluator, default policy
- **v0.5**: camera/frame-processor integration, rule signal extraction, geofence and prohibited-area checks
- **v1.0**: production hardening (attestation hooks, model lifecycle, telemetry, documentation)

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
