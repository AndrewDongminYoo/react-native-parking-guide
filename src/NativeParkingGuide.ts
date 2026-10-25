import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  getModelVersion(): string;
  /**
   * Lowercase hexadecimal SHA-256 of the file bytes. Accepts an absolute path or a `file:///` URI, and on Android
   * also a `content://` URI. Rejects with code `E_INVALID_URI` or `E_PHOTO_READ`.
   */
  getFileSha256(uri: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ParkingGuide');
