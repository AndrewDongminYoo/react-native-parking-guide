import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  getModelVersion(): string;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ParkingGuide');
