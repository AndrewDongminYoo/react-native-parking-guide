import { getParkingFeedback } from 'react-native-parking-guide';
import type { GuidanceIssue, VehicleType } from 'react-native-parking-guide';

/** Vehicle types offered on the example home screen. `'auto'` is omitted because no API detects the type yet. */
export const CAPTURE_VEHICLE_TYPES = [
  'kickboard',
  'bicycle',
  'ebike',
  'motorcycle',
] as const satisfies readonly VehicleType[];

const VEHICLE_NAMES: Record<VehicleType, string> = {
  kickboard: 'kickboard',
  bicycle: 'bicycle',
  ebike: 'e-bike',
  motorcycle: 'motorcycle',
  auto: 'vehicle',
};

export function vehicleLabel(vehicleType: VehicleType): string {
  const name = VEHICLE_NAMES[vehicleType];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function captureTitle(vehicleType: VehicleType): string {
  return `Take a photo of the ${VEHICLE_NAMES[vehicleType]}`;
}

/** Default library text for each current issue, in `getParkingFeedback` order. */
export function guidanceMessages(issues: readonly GuidanceIssue[]): string[] {
  return getParkingFeedback({ rules: [], issues }).map(
    (feedback) => feedback.text
  );
}
