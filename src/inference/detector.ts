import type { VehicleType } from '../types';
import { validateOutput } from './mapping';
import type { ModelClass, ModelDetection, RawModelOutput } from './mapping';

/** Detector class order; `DetectorOutput.classes` holds indices into this list. */
export const DETECTOR_CLASSES = Object.freeze([
  'kickboard',
  'bicycle',
  'motorcycle',
  'tactile_paving',
  'crosswalk',
  'roadway',
  'sidewalk_block',
  'parking_zone',
] as const);

/**
 * Post-processed output tensors of a host-supplied detector for N detections, flattened row-major.
 * See the README section "Detector model contract".
 */
export interface DetectorOutput {
  /** N × 4 normalized `[left, top, right, bottom]` values in `[0, 1]`. */
  readonly boxes: readonly number[];
  /** N confidences in `[0, 1]`. */
  readonly scores: readonly number[];
  /** N integer indices into `DETECTOR_CLASSES`. */
  readonly classes: readonly number[];
}

const VEHICLE_TYPES: ReadonlySet<string> = new Set<
  Exclude<VehicleType, 'auto' | 'ebike'>
>(['kickboard', 'bicycle', 'motorcycle']);

/**
 * Converts detector output tensors to a `RawModelOutput`. Pure and deterministic; does not filter by confidence,
 * clamp values, or execute a model. Throws `RangeError` for a tensor that is not an array, mismatched lengths, an
 * invalid class index, or any value that `mapModelOutput` rejects.
 */
export function decodeDetectorOutput(output: DetectorOutput): RawModelOutput {
  const { boxes, scores, classes } = output;
  if (![boxes, scores, classes].every(Array.isArray)) {
    throw new RangeError(
      'Detector output boxes, scores, and classes must be arrays.'
    );
  }
  const count = scores.length;
  if (classes.length !== count || boxes.length !== count * 4) {
    throw new RangeError(
      'Detector output must have N scores, N classes, and N × 4 box values.'
    );
  }
  const detections: ModelDetection[] = [];
  // Index loop so sparse array holes are rejected instead of skipped.
  for (let index = 0; index < count; index++) {
    const name = DETECTOR_CLASSES[classes[index] as number];
    if (!Number.isInteger(classes[index]) || name === undefined) {
      throw new RangeError(
        `Detector class indices must be integers in [0, ${DETECTOR_CLASSES.length - 1}].`
      );
    }
    const isVehicle = VEHICLE_TYPES.has(name);
    detections.push({
      classId: isVehicle ? 'vehicle' : (name as ModelClass),
      ...(isVehicle
        ? { vehicleType: name as Exclude<VehicleType, 'auto'> }
        : {}),
      confidence: scores[index] as number,
      box: [
        boxes[index * 4] as number,
        boxes[index * 4 + 1] as number,
        boxes[index * 4 + 2] as number,
        boxes[index * 4 + 3] as number,
      ],
    });
  }
  const result = { detections };
  validateOutput(result);
  return result;
}
