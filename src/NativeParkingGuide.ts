import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Lowercase hexadecimal SHA-256 of the file bytes. Accepts an absolute path or a `file:///` URI, and on Android
   * also a `content://` URI. Rejects with code `E_INVALID_URI` or `E_PHOTO_READ`.
   */
  getFileSha256(uri: string): Promise<string>;
  /**
   * Runs the host-supplied detector at `modelUri` (CoreML on iOS, LiteRT/TFLite on Android) on the photo at
   * `photoUri` and returns its `boxes`, `scores`, and `classes` output tensors flattened row-major. Rejects with
   * code `E_INVALID_URI`, `E_MODEL_LOAD`, `E_MODEL_CONTRACT`, `E_PHOTO_READ`, or `E_INFERENCE`.
   */
  runDetector(
    photoUri: string,
    modelUri: string
  ): Promise<{ boxes: number[]; scores: number[]; classes: number[] }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ParkingGuide');
