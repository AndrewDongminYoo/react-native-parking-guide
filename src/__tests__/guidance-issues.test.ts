import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_GUIDANCE_THRESHOLDS,
  mapGuidanceIssues,
} from '../inference/guidance';
import type { GuidanceMappingOptions } from '../inference/guidance';
import type {
  ModelBox,
  ModelDetection,
  RawModelOutput,
} from '../inference/mapping';

const frame: ModelBox = [0.1, 0.1, 0.9, 0.9];

function vehicle(box: ModelBox, confidence = 0.9): ModelDetection {
  return { classId: 'vehicle', confidence, box };
}

function scene(...detections: ModelDetection[]): RawModelOutput {
  return { detections };
}

function issues(box: ModelBox, options: GuidanceMappingOptions = {}) {
  return mapGuidanceIssues(scene(vehicle(box)), {
    guideFrame: frame,
    ...options,
  });
}

describe('mapGuidanceIssues', () => {
  it('uses documented default thresholds', () => {
    expect(DEFAULT_GUIDANCE_THRESHOLDS).toEqual({
      tooFarBelow: 0.4,
      tooCloseAbove: 0.95,
      groundMarginBelow: 0.05,
    });
    expect(Object.isFrozen(DEFAULT_GUIDANCE_THRESHOLDS)).toBe(true);
  });

  it('reports no issue for a well-framed vehicle', () => {
    expect(issues([0.3, 0.2, 0.6, 0.8])).toEqual([]);
  });

  it('reports only NO_VEHICLE when no vehicle is selected', () => {
    expect(mapGuidanceIssues(scene())).toEqual(['NO_VEHICLE']);
    expect(
      mapGuidanceIssues(scene(vehicle([0.3, 0.2, 0.6, 0.8], 0.4)))
    ).toEqual(['NO_VEHICLE']);
    expect(
      mapGuidanceIssues(
        scene({
          classId: 'vehicle',
          confidence: 0.9,
          box: [0.3, 0.2, 0.6, 0.8],
          mask: { width: 1, height: 1, data: [0] },
        })
      )
    ).toEqual(['NO_VEHICLE']);
    expect(issues([0, 0, 0.1, 0.1])).toEqual(['NO_VEHICLE']);
    expect(
      mapGuidanceIssues(
        scene(
          { classId: 'crosswalk', confidence: 0.9, box: [0, 0, 1, 1] },
          vehicle([0.3, 0.2, 0.6, 0.8], 0.2)
        )
      )
    ).toEqual(['NO_VEHICLE']);
  });

  it('reports TOO_FAR when the larger box-to-frame extent is below tooFarBelow', () => {
    expect(issues([0.45, 0.5, 0.55, 0.7])).toEqual(['TOO_FAR']);
  });

  it('reports TOO_CLOSE for a thin vehicle that fills the frame height', () => {
    // Box area is only 25% of the frame area, but the box spans the full frame height.
    expect(issues([0.4, 0.05, 0.6, 0.85])).toEqual(['TOO_CLOSE']);
  });

  it('reports GROUND_NOT_VISIBLE when the vehicle bottom reaches the frame bottom margin', () => {
    expect(issues([0.3, 0.4, 0.6, 0.89])).toEqual(['GROUND_NOT_VISIBLE']);
    expect(issues([0.3, 0.4, 0.6, 1])).toEqual(['GROUND_NOT_VISIBLE']);
  });

  it('reports the distance issue before GROUND_NOT_VISIBLE', () => {
    expect(issues([0.1, 0.1, 0.9, 0.95])).toEqual([
      'TOO_CLOSE',
      'GROUND_NOT_VISIBLE',
    ]);
    expect(issues([0.45, 0.8, 0.55, 0.9])).toEqual([
      'TOO_FAR',
      'GROUND_NOT_VISIBLE',
    ]);
  });

  it('treats values equal to a threshold as compliant after 6-decimal rounding', () => {
    // 0.31999999999999995 / 0.8 = 0.39999999999999997 before rounding.
    expect(issues([0.1, 0.5, 0.42, 0.6])).toEqual([]);
    expect(mapGuidanceIssues(scene(vehicle([0, 0.5, 0.95, 0.95])))).toEqual([]);
    expect(mapGuidanceIssues(scene(vehicle([0, 0.5, 0.5, 0.96])))).toEqual([
      'GROUND_NOT_VISIBLE',
    ]);
    expect(mapGuidanceIssues(scene(vehicle([0, 0.5, 0.96, 0.9])))).toEqual([
      'TOO_CLOSE',
    ]);
    expect(mapGuidanceIssues(scene(vehicle([0, 0.6, 0.39, 0.9])))).toEqual([
      'TOO_FAR',
    ]);
  });

  it('uses the whole image as the frame when guideFrame is not set', () => {
    expect(mapGuidanceIssues(scene(vehicle([0.3, 0.2, 0.6, 0.8])))).toEqual([]);
  });

  it('selects the same vehicle as mapModelOutput', () => {
    const output = scene(
      vehicle([0.45, 0.5, 0.55, 0.7], 0.6),
      vehicle([0.9, 0, 1, 1], 0.99)
    );
    // The higher-confidence vehicle only touches the frame edge, so it is not a candidate.
    expect(mapGuidanceIssues(output, { guideFrame: frame })).toEqual([
      'TOO_FAR',
    ]);
    expect(mapGuidanceIssues(output)).toEqual([
      'TOO_CLOSE',
      'GROUND_NOT_VISIBLE',
    ]);
    expect(
      mapGuidanceIssues(
        scene(
          vehicle([0.3, 0.2, 0.6, 0.8], 0.6),
          vehicle([0.45, 0.5, 0.55, 0.7], 0.99)
        )
      )
    ).toEqual(['TOO_FAR']);
  });

  it('applies partial threshold overrides', () => {
    expect(
      issues([0.45, 0.5, 0.55, 0.7], { thresholds: { tooFarBelow: 0.2 } })
    ).toEqual([]);
    expect(
      issues([0.3, 0.2, 0.6, 0.8], { thresholds: { tooCloseAbove: 0.7 } })
    ).toEqual(['TOO_CLOSE']);
    expect(
      issues([0.3, 0.2, 0.6, 0.8], { thresholds: { groundMarginBelow: 0.2 } })
    ).toEqual(['GROUND_NOT_VISIBLE']);
    expect(
      issues([0.45, 0.5, 0.55, 0.7], {
        thresholds: {
          tooFarBelow: undefined,
          tooCloseAbove: undefined,
          groundMarginBelow: undefined,
        },
      })
    ).toEqual(['TOO_FAR']);
  });

  it('rejects invalid options and model output', () => {
    const output = scene(vehicle([0.3, 0.2, 0.6, 0.8]));
    for (const thresholds of [
      { tooFarBelow: Number.NaN },
      { tooFarBelow: -0.1 },
      { tooCloseAbove: Number.POSITIVE_INFINITY },
      { tooFarBelow: 0.6, tooCloseAbove: 0.5 },
      { groundMarginBelow: 1.5 },
      { groundMarginBelow: -0.01 },
    ]) {
      expect(() => mapGuidanceIssues(output, { thresholds })).toThrow(
        RangeError
      );
    }
    expect(() =>
      mapGuidanceIssues(output, { guideFrame: [0.5, 0, 0.5, 1] })
    ).toThrow(RangeError);
    expect(() => mapGuidanceIssues(output, { minimumConfidence: 2 })).toThrow(
      RangeError
    );
    expect(() =>
      mapGuidanceIssues(scene(vehicle([0.3, 0.2, 0.6, 0.8], 1.5)))
    ).toThrow(RangeError);
  });

  it('is pure and does not mutate its input', () => {
    const detection = Object.freeze(vehicle([0.3, 0.4, 0.6, 0.89]));
    const output = Object.freeze({ detections: Object.freeze([detection]) });
    const options = Object.freeze({
      guideFrame: frame,
      thresholds: Object.freeze({ tooFarBelow: 0.4 }),
    });
    const first = mapGuidanceIssues(output, options);
    const second = mapGuidanceIssues(output, options);
    expect(first).toEqual(['GROUND_NOT_VISIBLE']);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
