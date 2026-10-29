import { describe, expect, it } from '@jest/globals';

import {
  DETECTOR_CLASSES,
  decodeDetectorOutput,
  type DetectorOutput,
} from '../inference/detector';
import { mapModelOutput } from '../inference/mapping';
import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';

describe('decodeDetectorOutput', () => {
  it('maps every detector class to its classId and vehicleType', () => {
    const output: DetectorOutput = {
      boxes: DETECTOR_CLASSES.flatMap(() => [0.1, 0.2, 0.3, 0.4]),
      scores: DETECTOR_CLASSES.map(() => 0.9),
      classes: DETECTOR_CLASSES.map((_, index) => index),
    };

    expect(
      decodeDetectorOutput(output).detections.map(
        ({ classId, vehicleType }) => [classId, vehicleType],
      ),
    ).toEqual([
      ['vehicle', 'kickboard'],
      ['vehicle', 'bicycle'],
      ['vehicle', 'motorcycle'],
      ['tactile_paving', undefined],
      ['crosswalk', undefined],
      ['roadway', undefined],
      ['sidewalk_block', undefined],
      ['parking_zone', undefined],
    ]);
  });

  it('copies boxes and scores row by row and omits vehicleType on zones', () => {
    const result = decodeDetectorOutput({
      boxes: [0.1, 0.2, 0.5, 0.9, 0, 0.6, 1, 1],
      scores: [0.8, 0.4],
      classes: [0, 4],
    });

    expect(result).toEqual({
      detections: [
        {
          classId: 'vehicle',
          vehicleType: 'kickboard',
          confidence: 0.8,
          box: [0.1, 0.2, 0.5, 0.9],
        },
        { classId: 'crosswalk', confidence: 0.4, box: [0, 0.6, 1, 1] },
      ],
    });
    expect(Object.keys(result.detections[1] ?? {})).not.toContain(
      'vehicleType',
    );
  });

  it('keeps zero-score padding rows for the mapper to ignore', () => {
    const result = decodeDetectorOutput({
      boxes: [0.2, 0.2, 0.8, 0.9, 0, 0, 0, 0],
      scores: [0.9, 0],
      classes: [1, 0],
    });

    expect(result.detections).toHaveLength(2);
    const rules = mapModelOutput(result);
    expect(rules.find((rule) => rule.id === 'VEHICLE_DETECTED')).toMatchObject({
      verdict: 'PASS',
      evidence: { bbox: [0.2, 0.2, 0.8, 0.9] },
    });
    // The contract carries no upright or imageQuality assessment.
    expect(
      rules.filter((rule) => ['UPRIGHT', 'IMAGE_QUALITY'].includes(rule.id)),
    ).toEqual([
      { id: 'UPRIGHT', verdict: 'WARN', score: 0, confidence: 0 },
      { id: 'IMAGE_QUALITY', verdict: 'WARN', score: 0, confidence: 0 },
    ]);
  });

  it('fails defaultPolicy on UPRIGHT alone when no upright assessment is merged', () => {
    const rules = mapModelOutput(
      decodeDetectorOutput({
        boxes: [0.2, 0.2, 0.8, 0.9],
        scores: [0.99],
        classes: [0],
      }),
    );

    expect(evaluatePolicy(rules, defaultPolicy).verdict).toBe('FAIL');
    expect(
      evaluatePolicy(rules, {
        ...defaultPolicy,
        rules: {
          ...defaultPolicy.rules,
          UPRIGHT: { ...defaultPolicy.rules.UPRIGHT!, severity: 'WARN' },
        },
      }).verdict,
    ).not.toBe('FAIL');
  });

  it('decodes an empty output', () => {
    expect(
      decodeDetectorOutput({ boxes: [], scores: [], classes: [] }),
    ).toEqual({ detections: [] });
  });

  it.each<[string, DetectorOutput]>([
    ['boxes not four per row', { boxes: [0, 0, 1], scores: [1], classes: [0] }],
    [
      'classes shorter than scores',
      { boxes: [0, 0, 1, 1, 0, 0, 1, 1], scores: [1, 1], classes: [0] },
    ],
    [
      'class index out of range',
      { boxes: [0, 0, 1, 1], scores: [1], classes: [8] },
    ],
    [
      'negative class index',
      { boxes: [0, 0, 1, 1], scores: [1], classes: [-1] },
    ],
    [
      'fractional class index',
      { boxes: [0, 0, 1, 1], scores: [1], classes: [0.5] },
    ],
    [
      'sparse classes',
      { boxes: [0, 0, 1, 1], scores: [1], classes: new Array(1) },
    ],
    [
      'box outside [0, 1]',
      { boxes: [-0.01, 0, 1, 1], scores: [1], classes: [3] },
    ],
    ['inverted box', { boxes: [0.5, 0, 0.4, 1], scores: [1], classes: [3] }],
    ['score above 1', { boxes: [0, 0, 1, 1], scores: [1.5], classes: [3] }],
    [
      'NaN box coordinate',
      { boxes: [0, Number.NaN, 1, 1], scores: [1], classes: [3] },
    ],
    [
      'missing scores',
      { boxes: [0, 0, 1, 1], classes: [3] } as unknown as DetectorOutput,
    ],
  ])('throws RangeError: %s', (_, output) => {
    expect(() => decodeDetectorOutput(output)).toThrow(RangeError);
  });
});
