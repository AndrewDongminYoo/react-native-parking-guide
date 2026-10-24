import type { RuleId, RuleResult } from '../types';

export type ModelClass =
  | 'vehicle'
  | 'tactile_paving'
  | 'crosswalk'
  | 'roadway'
  | 'sidewalk_block'
  | 'parking_zone';

/** Normalized [left, top, right, bottom] in the same upright image coordinate space. */
export type ModelBox = readonly [number, number, number, number];

/** Row-major binary mask of the entire image, not a cropped detection. */
export interface ModelMask {
  readonly width: number;
  readonly height: number;
  readonly data: readonly (0 | 1)[];
}

export interface ModelAssessment {
  /** Compliance score in [0, 1]; higher is better. */
  readonly score: number;
  readonly confidence: number;
}

export interface ModelDetection {
  readonly classId: ModelClass;
  readonly confidence: number;
  readonly box: ModelBox;
  readonly mask?: ModelMask;
  /** Vehicle uprightness, not camera tilt. Used only for classId: 'vehicle'. */
  readonly upright?: ModelAssessment;
}

/** A complete scene prediction; an absent detection means that class was not detected. */
export interface RawModelOutput {
  readonly detections: readonly ModelDetection[];
  readonly imageQuality?: ModelAssessment;
}

export type InferenceRuleId = Exclude<RuleId, 'GEOFENCE'>;

export interface MappingThresholds {
  /** FAIL below failBelow; PASS at or above passAt; WARN in between. */
  readonly failBelow: number;
  readonly passAt: number;
}

export interface MappingOptions {
  /** Detections and assessments below this confidence are ignored. Default: 0.5. */
  readonly minimumConfidence?: number;
  readonly thresholds?: Partial<Record<InferenceRuleId, MappingThresholds>>;
}

export const DEFAULT_MAPPING_THRESHOLDS: Readonly<
  Record<InferenceRuleId, MappingThresholds>
> = Object.freeze({
  VEHICLE_DETECTED: Object.freeze({ failBelow: 0.5, passAt: 0.8 }),
  UPRIGHT: Object.freeze({ failBelow: 0.5, passAt: 0.8 }),
  TACTILE_PAVING: Object.freeze({ failBelow: 0.9, passAt: 0.99 }),
  CROSSWALK: Object.freeze({ failBelow: 0.9, passAt: 0.99 }),
  ROADWAY: Object.freeze({ failBelow: 0.9, passAt: 0.99 }),
  SIDEWALK_BLOCK: Object.freeze({ failBelow: 0.8, passAt: 0.95 }),
  PARKING_ZONE: Object.freeze({ failBelow: 0.5, passAt: 0.8 }),
  IMAGE_QUALITY: Object.freeze({ failBelow: 0.5, passAt: 0.8 }),
});

const ZONE_RULES = [
  ['TACTILE_PAVING', 'tactile_paving'],
  ['CROSSWALK', 'crosswalk'],
  ['ROADWAY', 'roadway'],
  ['SIDEWALK_BLOCK', 'sidewalk_block'],
  ['PARKING_ZONE', 'parking_zone'],
] as const;

function validateUnit(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      'Model values and thresholds must be finite and in [0, 1].'
    );
  }
}

function validateAssessment(assessment: ModelAssessment | undefined): void {
  if (assessment) {
    validateUnit(assessment.score);
    validateUnit(assessment.confidence);
  }
}

function validateOutput(output: RawModelOutput): void {
  let grid: ModelMask | undefined;
  validateAssessment(output.imageQuality);
  for (const detection of output.detections) {
    validateUnit(detection.confidence);
    validateAssessment(detection.upright);
    const { box, mask } = detection;
    if (box.length !== 4) {
      throw new RangeError('Model boxes must have four coordinates.');
    }
    box.forEach(validateUnit);
    if (box[0] > box[2] || box[1] > box[3]) {
      throw new RangeError('Model box coordinates must not be inverted.');
    }
    if (!mask) {
      continue;
    }
    if (
      !Number.isSafeInteger(mask.width) ||
      !Number.isSafeInteger(mask.height) ||
      mask.width < 1 ||
      mask.height < 1 ||
      mask.data.length !== mask.width * mask.height ||
      !mask.data.every((value) => value === 0 || value === 1)
    ) {
      throw new RangeError(
        'Model masks must have positive dimensions and binary data.'
      );
    }
    if (grid && (mask.width !== grid.width || mask.height !== grid.height)) {
      throw new RangeError('All model masks must use the same image grid.');
    }
    grid = mask;
  }
}

function hasArea(detection: ModelDetection): boolean {
  return (
    detection.box[2] > detection.box[0] &&
    detection.box[3] > detection.box[1] &&
    (!detection.mask || detection.mask.data.includes(1))
  );
}

/** Exact union area of axis-aligned boxes; duplicate zones are not counted twice. */
function unionArea(boxes: readonly ModelBox[]): number {
  const edges = [...new Set(boxes.flatMap((box) => [box[0], box[2]]))].sort(
    (a, b) => a - b
  );
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1]!;
    const right = edges[i]!;
    const intervals = boxes
      .filter((box) => box[0] < right && box[2] > left)
      .map((box) => [box[1], box[3]] as const)
      .sort((a, b) => a[0] - b[0]);
    let bottom = 0;
    let height = 0;
    for (const [top, end] of intervals) {
      height += Math.max(0, end - Math.max(top, bottom));
      bottom = Math.max(bottom, end);
    }
    area += (right - left) * height;
  }
  return area;
}

function overlapRatio(
  vehicle: ModelDetection,
  zones: readonly ModelDetection[]
): number {
  if (zones.length === 0) {
    return 0;
  }
  const mask = vehicle.mask;
  if (mask && zones.every((zone) => zone.mask)) {
    let area = 0;
    let overlap = 0;
    mask.data.forEach((value, index) => {
      if (value === 1) {
        area++;
        if (zones.some((zone) => zone.mask!.data[index] === 1)) {
          overlap++;
        }
      }
    });
    return area === 0 ? 0 : overlap / area;
  }
  const [left, top, right, bottom] = vehicle.box;
  const area = (right - left) * (bottom - top);
  if (area === 0) {
    return 0;
  }
  const intersections = zones
    .map((zone): ModelBox => [
      Math.max(left, zone.box[0]),
      Math.max(top, zone.box[1]),
      Math.min(right, zone.box[2]),
      Math.min(bottom, zone.box[3]),
    ])
    .filter((box) => box[2] > box[0] && box[3] > box[1]);
  return Math.max(0, Math.min(1, unionArea(intersections) / area));
}

/** Pure, deterministic model-to-rule adapter. Does not execute a model or evaluate a policy. */
export function mapModelOutput(
  output: RawModelOutput,
  options: MappingOptions = {}
): RuleResult[] {
  const minimumConfidence = options.minimumConfidence ?? 0.5;
  validateUnit(minimumConfidence);
  const thresholds = { ...DEFAULT_MAPPING_THRESHOLDS };
  for (const id of Object.keys(thresholds) as InferenceRuleId[]) {
    const threshold = options.thresholds?.[id] ?? thresholds[id];
    thresholds[id] = threshold;
    validateUnit(threshold.failBelow);
    validateUnit(threshold.passAt);
    if (threshold.failBelow > threshold.passAt) {
      throw new RangeError('failBelow must be less than or equal to passAt.');
    }
  }
  validateOutput(output);

  function result(
    id: InferenceRuleId,
    score: number,
    confidence: number
  ): RuleResult {
    const threshold = thresholds[id];
    return {
      id,
      score,
      confidence,
      verdict:
        score >= threshold.passAt
          ? 'PASS'
          : score < threshold.failBelow
            ? 'FAIL'
            : 'WARN',
    };
  }

  function unknown(id: InferenceRuleId): RuleResult {
    return { id, verdict: 'WARN', score: 0, confidence: 0 };
  }

  function assessmentResult(
    id: InferenceRuleId,
    assessment: ModelAssessment | undefined
  ): RuleResult {
    return assessment && assessment.confidence >= minimumConfidence
      ? result(id, assessment.score, assessment.confidence)
      : unknown(id);
  }

  const detections = output.detections.filter(
    (detection) =>
      detection.confidence >= minimumConfidence && hasArea(detection)
  );
  const vehicle = detections
    .filter((detection) => detection.classId === 'vehicle')
    .reduce<ModelDetection | undefined>(
      (best, detection) =>
        !best || detection.confidence > best.confidence ? detection : best,
      undefined
    );
  const vehicleResult: RuleResult = vehicle
    ? {
        ...result('VEHICLE_DETECTED', vehicle.confidence, vehicle.confidence),
        evidence: { bbox: [...vehicle.box] },
      }
    : { id: 'VEHICLE_DETECTED', verdict: 'FAIL', score: 0, confidence: 0 };

  return [
    vehicleResult,
    assessmentResult('UPRIGHT', vehicle?.upright),
    ...ZONE_RULES.map(([id, classId]) => {
      if (!vehicle) {
        return unknown(id);
      }
      const zones = detections.filter(
        (detection) => detection.classId === classId
      );
      const ratio = overlapRatio(vehicle, zones);
      return result(
        id,
        id === 'PARKING_ZONE' ? ratio : 1 - ratio,
        zones.reduce(
          (lowest, zone) => Math.min(lowest, zone.confidence),
          vehicle.confidence
        )
      );
    }),
    assessmentResult('IMAGE_QUALITY', output.imageQuality),
  ];
}
