# react-native-parking-guide

A React Native TurboModule library for iOS and Android. It guides users of shared personal mobility vehicles
(bicycles, kickboards, e-bikes, and motorcycles) while they photograph their parked vehicle with the device camera,
and returns a parking verdict of `PASS`, `WARN`, or `FAIL`.

> **Status:** early scaffold (v0.1). Only the policy evaluation engine (`evaluatePolicy`) and a native
> `getModelVersion()` stub are implemented. Camera guidance and on-device inference are planned, not implemented.

## Planned architecture

- Realtime capture guidance: a `react-native-vision-camera` frame processor.
- On-device inference: CoreML on iOS, TFLite on Android.
- Final verdict: a TypeScript rule engine (`evaluatePolicy`) driven by a JSON policy.

## Roadmap

- **v0.1 (MVP)**: TurboModule scaffold, typed API skeleton, policy evaluation engine, native model-version stub.
- **v0.5**: prohibited-zone rules (tactile paving, crosswalk, roadway), geofence integration, additional guidance signals.
- **v1.0**: production on-device model pipeline, attestation support, upload and server-side verification integration.

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
