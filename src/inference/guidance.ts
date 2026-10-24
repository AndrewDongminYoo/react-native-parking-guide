import type { GuidanceIssue } from '../types';
import {
  acceptedDetections,
  roundGeometricScore,
  selectVehicle,
  validateGuideFrame,
  validateOutput,
  validateUnit,
} from './mapping';
import type { ModelBox, RawModelOutput } from './mapping';

export interface GuidanceThresholds {
  /**
   * `TOO_FAR` when the fill ratio is strictly below this value. The fill ratio is the larger of
   * vehicle box width / guide frame width and vehicle box height / guide frame height.
   */
  readonly tooFarBelow: number;
  /** `TOO_CLOSE` when the fill ratio is strictly above this value. */
  readonly tooCloseAbove: number;
  /**
   * `GROUND_NOT_VISIBLE` when (guide frame bottom - vehicle box bottom) / guide frame height is
   * strictly below this value.
   */
  readonly groundMarginBelow: number;
}

export interface GuidanceMappingOptions {
  /** Detections below this confidence are ignored. Default: 0.5. */
  readonly minimumConfidence?: number;
  /**
   * Capture guide frame in the same normalized, upright image space as detections. Selects the
   * vehicle exactly as `MappingOptions.guideFrame` does. Ratios use `[0, 0, 1, 1]` when it is unset.
   */
  readonly guideFrame?: ModelBox;
  readonly thresholds?: Partial<GuidanceThresholds>;
}

export const DEFAULT_GUIDANCE_THRESHOLDS: Readonly<GuidanceThresholds> =
  Object.freeze({
    tooFarBelow: 0.4,
    tooCloseAbove: 0.95,
    groundMarginBelow: 0.05,
  });

const WHOLE_IMAGE: ModelBox = [0, 0, 1, 1];

function validateThresholds(thresholds: GuidanceThresholds): void {
  const { tooFarBelow, tooCloseAbove, groundMarginBelow } = thresholds;
  if (
    !Number.isFinite(tooFarBelow) ||
    !Number.isFinite(tooCloseAbove) ||
    tooFarBelow < 0 ||
    tooFarBelow > tooCloseAbove
  ) {
    throw new RangeError(
      'tooFarBelow and tooCloseAbove must be finite with 0 <= tooFarBelow <= tooCloseAbove.'
    );
  }
  validateUnit(groundMarginBelow);
}

/**
 * Pure, deterministic mapping from one frame's model output to model-based capture guidance.
 * Returns `['NO_VEHICLE']` when no vehicle is selected; otherwise at most one of `TOO_FAR` or
 * `TOO_CLOSE`, followed by `GROUND_NOT_VISIBLE` when it applies.
 */
export function mapGuidanceIssues(
  output: RawModelOutput,
  options: GuidanceMappingOptions = {}
): GuidanceIssue[] {
  const minimumConfidence = options.minimumConfidence ?? 0.5;
  validateUnit(minimumConfidence);
  const thresholds: GuidanceThresholds = {
    tooFarBelow:
      options.thresholds?.tooFarBelow ??
      DEFAULT_GUIDANCE_THRESHOLDS.tooFarBelow,
    tooCloseAbove:
      options.thresholds?.tooCloseAbove ??
      DEFAULT_GUIDANCE_THRESHOLDS.tooCloseAbove,
    groundMarginBelow:
      options.thresholds?.groundMarginBelow ??
      DEFAULT_GUIDANCE_THRESHOLDS.groundMarginBelow,
  };
  validateThresholds(thresholds);
  validateOutput(output);
  validateGuideFrame(options.guideFrame);

  const vehicle = selectVehicle(
    acceptedDetections(output, minimumConfidence),
    options.guideFrame
  );
  if (!vehicle) {
    return ['NO_VEHICLE'];
  }

  const [frameLeft, frameTop, frameRight, frameBottom] =
    options.guideFrame ?? WHOLE_IMAGE;
  const frameWidth = frameRight - frameLeft;
  const frameHeight = frameBottom - frameTop;
  const [left, top, right, bottom] = vehicle.box;
  const fill = roundGeometricScore(
    Math.max((right - left) / frameWidth, (bottom - top) / frameHeight)
  );
  const groundGap = roundGeometricScore((frameBottom - bottom) / frameHeight);

  const issues: GuidanceIssue[] = [];
  if (fill < thresholds.tooFarBelow) {
    issues.push('TOO_FAR');
  } else if (fill > thresholds.tooCloseAbove) {
    issues.push('TOO_CLOSE');
  }
  if (groundGap < thresholds.groundMarginBelow) {
    issues.push('GROUND_NOT_VISIBLE');
  }
  return issues;
}
