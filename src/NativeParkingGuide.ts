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
  /**
   * Requests a device attestation token (App Attest on iOS, Play Integrity on Android) bound to the SHA-256 of the
   * UTF-8 bytes of `photoSha256 + ':' + challenge`, and resolves with the token as a JSON string. Android uses
   * `cloudProjectNumber`; iOS ignores it. Rejects with code `E_ATTESTATION_UNSUPPORTED` or `E_ATTESTATION_FAILED`.
   */
  requestAttestation(
    photoSha256: string,
    challenge: string,
    cloudProjectNumber: number
  ): Promise<string>;
  /**
   * iOS: deletes the stored App Attest key ID, so that the next `requestAttestation` call generates and attests a new
   * key. Rejects with code `E_ATTESTATION_FAILED` when the Keychain delete fails. Android: resolves without an action.
   */
  resetAttestationKey(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ParkingGuide');
