import { describe, expect, it } from '@jest/globals';

import {
  compliantScene,
  maskedScene,
  prohibitedScene,
} from '../__fixtures__/modelOutputs';
import {
  DEFAULT_MAPPING_THRESHOLDS,
  mapModelOutput,
} from '../inference/mapping';
import type {
  MappingOptions,
  ModelBox,
  ModelDetection,
  RawModelOutput,
} from '../inference/mapping';
import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type { RuleId, Verdict } from '../types';

function rule(output: RawModelOutput, id: RuleId, options?: MappingOptions) {
  return mapModelOutput(output, options).find((result) => result.id === id)!;
}

function boxesScene(boxes: readonly ModelBox[]): RawModelOutput {
  return {
    detections: [
      { classId: 'vehicle', confidence: 1, box: [0, 0, 1, 1] },
      ...boxes.map((box): ModelDetection => ({
        classId: 'crosswalk',
        confidence: 0.8,
        box,
      })),
    ],
  };
}

describe('mapModelOutput', () => {
  it('maps a compliant scene to all eight rules in stable order', () => {
    const results = mapModelOutput(compliantScene);
    expect(results.map(({ id }) => id)).toEqual([
      'VEHICLE_DETECTED',
      'UPRIGHT',
      'TACTILE_PAVING',
      'CROSSWALK',
      'ROADWAY',
      'SIDEWALK_BLOCK',
      'PARKING_ZONE',
      'IMAGE_QUALITY',
    ]);
    expect(results.every(({ verdict }) => verdict === 'PASS')).toBe(true);
    expect(results[0]).toEqual({
      id: 'VEHICLE_DETECTED',
      verdict: 'PASS',
      score: 0.95,
      confidence: 0.95,
      evidence: { bbox: [0, 0, 0.5, 1] },
    });
    expect(rule(compliantScene, 'UPRIGHT')).toMatchObject({
      score: 0.9,
      confidence: 0.85,
    });
    expect(rule(compliantScene, 'PARKING_ZONE')).toMatchObject({
      score: 1,
      confidence: 0.9,
    });
    expect(evaluatePolicy(results, defaultPolicy).verdict).toBe('PASS');
  });

  it('maps prohibited zones, uprightness and image quality to failures', () => {
    const results = mapModelOutput(prohibitedScene);
    expect(results.slice(1).every(({ verdict }) => verdict === 'FAIL')).toBe(
      true
    );
    expect(rule(prohibitedScene, 'TACTILE_PAVING').score).toBe(0);
    for (const id of ['CROSSWALK', 'ROADWAY', 'SIDEWALK_BLOCK'] as const) {
      expect(rule(prohibitedScene, id).score).toBe(0.5);
    }
    expect(rule(prohibitedScene, 'PARKING_ZONE').score).toBe(0);
    expect(rule(prohibitedScene, 'IMAGE_QUALITY')).toMatchObject({
      score: 0.1,
      confidence: 0.8,
    });
    expect(evaluatePolicy(results, defaultPolicy).verdict).toBe('FAIL');
  });

  it.each([
    [0, 'FAIL'],
    [0.49, 'FAIL'],
    [0.5, 'WARN'],
    [0.79, 'WARN'],
    [0.8, 'PASS'],
    [1, 'PASS'],
  ] as [number, Verdict][])(
    'maps score %s to %s with inclusive boundaries',
    (score, verdict) => {
      expect(
        rule(
          { detections: [], imageQuality: { score, confidence: 1 } },
          'IMAGE_QUALITY'
        ).verdict
      ).toBe(verdict);
    }
  );

  it('allows per-rule thresholds and ignores undefined overrides', () => {
    const options: MappingOptions = {
      thresholds: {
        CROSSWALK: { failBelow: 0.4, passAt: 0.5 },
        IMAGE_QUALITY: { failBelow: 0.1, passAt: 0.2 },
        UPRIGHT: undefined,
      },
    };
    expect(rule(prohibitedScene, 'CROSSWALK', options).verdict).toBe('PASS');
    expect(rule(prohibitedScene, 'IMAGE_QUALITY', options).verdict).toBe(
      'WARN'
    );
    expect(rule(prohibitedScene, 'ROADWAY', options).verdict).toBe('FAIL');
    expect(Object.isFrozen(DEFAULT_MAPPING_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MAPPING_THRESHOLDS.CROSSWALK)).toBe(true);
  });

  it('fails vehicle detection and marks dependent rules unknown without a vehicle', () => {
    const results = mapModelOutput({ detections: [] });
    expect(results[0]).toEqual({
      id: 'VEHICLE_DETECTED',
      verdict: 'FAIL',
      score: 0,
      confidence: 0,
    });
    expect(
      results
        .slice(1)
        .every(
          (result) =>
            result.verdict === 'WARN' &&
            result.score === 0 &&
            result.confidence === 0
        )
    ).toBe(true);
    expect(evaluatePolicy(results, defaultPolicy).verdict).toBe('FAIL');
  });

  it('selects the highest-confidence vehicle, retaining the first on ties', () => {
    const first: ModelDetection = {
      classId: 'vehicle',
      confidence: 1,
      box: [0.5, 0, 1, 1],
      upright: { score: 0, confidence: 1 },
    };
    const output = {
      detections: [
        ...compliantScene.detections,
        first,
        { ...first, upright: { score: 1, confidence: 1 } },
      ],
    };
    expect(rule(output, 'UPRIGHT').score).toBe(0);
    expect(rule(output, 'ROADWAY').score).toBe(0);
    expect(rule(output, 'VEHICLE_DETECTED').evidence?.bbox).toEqual(first.box);
  });

  it('filters low-confidence predictions and accepts the exact confidence cutoff', () => {
    const output: RawModelOutput = {
      detections: [
        {
          classId: 'vehicle',
          confidence: 0.5,
          box: [0, 0, 1, 1],
          upright: { score: 1, confidence: 0.49 },
        },
        { classId: 'roadway', confidence: 0.49, box: [0, 0, 1, 1] },
      ],
      imageQuality: { score: 1, confidence: 0.49 },
    };
    expect(rule(output, 'VEHICLE_DETECTED').verdict).toBe('WARN');
    expect(rule(output, 'ROADWAY').score).toBe(1);
    expect(rule(output, 'UPRIGHT').confidence).toBe(0);
    expect(rule(output, 'IMAGE_QUALITY').confidence).toBe(0);
    expect(rule(output, 'ROADWAY', { minimumConfidence: 0.49 }).score).toBe(0);
    expect(
      rule(output, 'VEHICLE_DETECTED', { minimumConfidence: 0.51 }).verdict
    ).toBe('FAIL');
  });

  it.each([
    [[], 1],
    [[[0, 0, 0, 1]], 1],
    [[[0, 0, 1, 1]], 0],
    [[[0, 0, 0.25, 1]], 0.75],
    [
      [
        [0, 0, 0.5, 1],
        [0, 0, 0.5, 1],
      ],
      0.5,
    ],
    [
      [
        [0, 0, 0.25, 1],
        [0.75, 0, 1, 1],
      ],
      0.5,
    ],
    [
      [
        [0, 0, 0.75, 1],
        [0.25, 0, 1, 1],
      ],
      0,
    ],
    [
      [
        [0, 0, 0.5, 0.5],
        [0.25, 0.25, 0.75, 0.75],
      ],
      0.5625,
    ],
  ] as [ModelBox[], number][])(
    'computes the box union for %j',
    (boxes, score) => {
      expect(rule(boxesScene(boxes), 'CROSSWALK').score).toBeCloseTo(score);
    }
  );

  it.each([
    ['CROSSWALK', [0.2, 0, 0.8, 1], [0.74, 0, 0.8, 1], 0.9, 'WARN'],
    ['CROSSWALK', [0.3, 0, 0.6, 1], [0.57, 0, 0.6, 1], 0.9, 'WARN'],
    ['PARKING_ZONE', [0.1, 0, 0.4, 1], [0.1, 0, 0.34, 1], 0.8, 'PASS'],
  ] as [RuleId, ModelBox, ModelBox, number, Verdict][])(
    'rounds %s decimal-coordinate boundary scores to exact thresholds',
    (id, vehicleBox, zoneBox, score, verdict) => {
      const classId = id === 'CROSSWALK' ? 'crosswalk' : 'parking_zone';
      const output: RawModelOutput = {
        detections: [
          { classId: 'vehicle', confidence: 1, box: vehicleBox },
          { classId, confidence: 1, box: zoneBox },
        ],
      };
      const result = rule(output, id);
      expect(result.score).toBe(score);
      expect(result.verdict).toBe(verdict);
      expect(evaluatePolicy([result], defaultPolicy).verdict).toBe('PASS');
    }
  );

  it('divides intersection by vehicle area, not union area or zone area', () => {
    expect(rule(compliantScene, 'PARKING_ZONE').score).toBe(1);
    expect(rule(compliantScene, 'ROADWAY').score).toBe(1);
  });

  it('uses binary mask overlap instead of boxes and unions duplicate masks', () => {
    expect(rule(maskedScene, 'CROSSWALK').score).toBe(0.5);
    expect(rule(maskedScene, 'PARKING_ZONE').score).toBe(1);
    expect(
      rule(
        {
          detections: [...maskedScene.detections, maskedScene.detections[1]!],
        },
        'CROSSWALK'
      ).score
    ).toBe(0.5);
  });

  it('unions distinct masks and handles disjoint mask foregrounds', () => {
    const vehicle = maskedScene.detections[0]!;
    const firstZone = maskedScene.detections[1]!;
    const secondZone: ModelDetection = {
      ...firstZone,
      confidence: 0.7,
      mask: { width: 2, height: 2, data: [0, 1, 0, 0] },
    };
    expect(
      rule({ detections: [vehicle, firstZone, secondZone] }, 'CROSSWALK')
    ).toMatchObject({ score: 0, confidence: 0.7 });
    expect(
      rule(
        {
          detections: [
            vehicle,
            {
              ...firstZone,
              mask: { width: 2, height: 2, data: [0, 0, 1, 1] },
            },
          ],
        },
        'CROSSWALK'
      ).score
    ).toBe(1);
  });

  it('clips zone boxes to a smaller vehicle box before computing overlap', () => {
    const output: RawModelOutput = {
      detections: [
        { classId: 'vehicle', confidence: 1, box: [0.25, 0.25, 0.75, 0.75] },
        { classId: 'crosswalk', confidence: 0.8, box: [0, 0, 0.5, 1] },
      ],
    };
    expect(rule(output, 'CROSSWALK').score).toBe(0.5);
  });

  it('falls back to boxes if any participating region has no mask', () => {
    const output: RawModelOutput = {
      detections: [
        maskedScene.detections[0]!,
        { classId: 'crosswalk', confidence: 1, box: [0, 0, 1, 1] },
      ],
    };
    expect(rule(output, 'CROSSWALK').score).toBe(0);
  });

  it('ignores zero-area boxes and empty masks without NaN or division by zero', () => {
    for (const detection of [
      { classId: 'vehicle', confidence: 1, box: [0, 0, 0, 1] },
      {
        classId: 'vehicle',
        confidence: 1,
        box: [0, 0, 1, 1],
        mask: { width: 1, height: 1, data: [0] },
      },
    ] as const) {
      const results = mapModelOutput({ detections: [detection] });
      expect(results[0]?.verdict).toBe('FAIL');
      expect(
        results.every(
          ({ score, confidence }) =>
            Number.isFinite(score) && Number.isFinite(confidence)
        )
      ).toBe(true);
    }
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
    'rejects out-of-range numeric input %s',
    (invalid) => {
      expect(() =>
        mapModelOutput({
          detections: [
            { classId: 'vehicle', confidence: invalid, box: [0, 0, 1, 1] },
          ],
        })
      ).toThrow(RangeError);
      expect(() =>
        mapModelOutput({
          detections: [],
          imageQuality: { score: invalid, confidence: 1 },
        })
      ).toThrow(RangeError);
      expect(() => mapModelOutput(boxesScene([[0, 0, invalid, 1]]))).toThrow(
        RangeError
      );
      expect(() =>
        mapModelOutput(compliantScene, { minimumConfidence: invalid })
      ).toThrow(RangeError);
      expect(() =>
        mapModelOutput(compliantScene, {
          thresholds: { UPRIGHT: { failBelow: 0, passAt: invalid } },
        })
      ).toThrow(RangeError);
    }
  );

  it('rejects inverted boxes, malformed masks and inverted thresholds', () => {
    expect(() => mapModelOutput(boxesScene([[1, 0, 0, 1]]))).toThrow(
      RangeError
    );
    for (const mask of [
      { width: 0, height: 1, data: [] },
      { width: 1.5, height: 2, data: [1, 1, 1] },
      { width: 2, height: 2, data: [1] },
      { width: 1, height: 1, data: [0.5] },
    ]) {
      expect(() =>
        mapModelOutput({
          detections: [{ ...maskedScene.detections[0]!, mask }],
        } as RawModelOutput)
      ).toThrow(RangeError);
    }
    expect(() =>
      mapModelOutput({
        detections: [
          ...maskedScene.detections,
          {
            classId: 'roadway',
            confidence: 1,
            box: [0, 0, 1, 1],
            mask: { width: 1, height: 1, data: [1] },
          },
        ],
      })
    ).toThrow(RangeError);
    expect(() =>
      mapModelOutput(compliantScene, {
        thresholds: { UPRIGHT: { failBelow: 0.9, passAt: 0.8 } },
      })
    ).toThrow(RangeError);
  });

  it('does not mutate frozen inputs or share evidence arrays across calls', () => {
    const vehicle: ModelDetection = Object.freeze({
      classId: 'vehicle',
      confidence: 1,
      box: Object.freeze([0, 0, 1, 1] as const),
      mask: Object.freeze({
        width: 1,
        height: 1,
        data: Object.freeze([1] as const),
      }),
      upright: Object.freeze({ score: 1, confidence: 1 }),
    });
    const output = Object.freeze({ detections: Object.freeze([vehicle]) });
    const options = Object.freeze({
      thresholds: Object.freeze({
        UPRIGHT: Object.freeze({ failBelow: 0.4, passAt: 0.9 }),
      }),
    });
    const first = mapModelOutput(output, options);
    expect(mapModelOutput(output, options)).toEqual(first);
    first[0]!.evidence!.bbox![0] = 1;
    expect(mapModelOutput(output, options)[0]?.evidence?.bbox?.[0]).toBe(0);
    for (const scene of [compliantScene, prohibitedScene, maskedScene]) {
      for (const { score, confidence } of mapModelOutput(scene)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
