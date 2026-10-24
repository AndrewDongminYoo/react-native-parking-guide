import type { GuidanceIssue } from '../../src/types';

export const GUIDANCE_ISSUE_MESSAGES: Record<GuidanceIssue, string> = {
  NO_VEHICLE: 'Move the vehicle into the frame.',
  TOO_CLOSE: 'Move farther away from the vehicle.',
  TOO_FAR: 'Move closer to the vehicle.',
  TILTED: 'Hold the camera level.',
  BLURRY: 'Hold the camera steady.',
  LOW_LIGHT: 'Move to a brighter area.',
  GROUND_NOT_VISIBLE: 'Include the ground around the vehicle.',
};
