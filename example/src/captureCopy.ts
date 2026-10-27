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

/** Guidance messages, preceded by a model-failure message when the detector failed (instead of "no vehicle"). */
export function captureMessages(
  issues: readonly GuidanceIssue[],
  detectorError: string | null
): string[] {
  const messages = guidanceMessages(issues);
  return detectorError === null
    ? messages
    : ['The parking model could not run.', ...messages];
}

/** The guidance lines that the capture screen shows: the messages, or one status line when there is no message. */
export function guidanceLines(
  messages: readonly string[],
  ready: boolean
): string[] {
  if (messages.length > 0) {
    return [...messages];
  }
  return [
    ready
      ? 'Ready. Take the photo.'
      : 'Checking the image. Hold the phone steady.',
  ];
}

/** The screen reader hint of the shutter button, or undefined while the shutter is enabled. */
export function shutterHint(
  canCapture: boolean,
  capturing: boolean
): string | undefined {
  if (canCapture) {
    return undefined;
  }
  return capturing
    ? 'Taking the photo.'
    : 'Available when the guidance says Ready.';
}

/** What the capture screen checks, depending on whether a detector model is configured. */
export function captureDisclaimer(detectorConfigured: boolean): string {
  return detectorConfigured
    ? 'Checks image quality and vehicle placement with the configured model, then shows a parking result for the photo.'
    : 'Checks image quality only. Vehicle detection and the parking result need a detector model.';
}
