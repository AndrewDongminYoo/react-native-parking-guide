import { describe, expect, it, jest } from '@jest/globals';
import type { RuleId } from 'react-native-parking-guide';

import {
  DEMO_POLICY,
  judgeParking,
  resultReasons,
  resultTitle,
} from '../parkingResult';

jest.mock(
  'react-native-parking-guide',
  () => ({
    ...jest.requireActual<object>('../../../src/feedback/feedback'),
    ...jest.requireActual<object>('../../../src/inference/detector'),
    ...jest.requireActual<object>('../../../src/inference/mapping'),
    ...jest.requireActual<object>('../../../src/policy/defaultPolicy'),
    ...jest.requireActual<object>('../../../src/policy/evaluate'),
    runDetector: jest.fn(),
  }),
  { virtual: true }
);

const PHOTO = { path: '/tmp/photo.jpg', guideFrame: undefined };

/** One kickboard (class index 0) with the given score and box, as flattened detector tensors. */
function tensors(score: number, box: number[] = [0.2, 0.2, 0.8, 0.9]) {
  return { boxes: box, scores: [score], classes: [0] };
}

describe('judgeParking', () => {
  it('reports no result when no detector model is configured', async () => {
    const detect = jest.fn<() => Promise<never>>();
    await expect(
      judgeParking(PHOTO, 'kickboard', undefined, detect)
    ).resolves.toEqual({ kind: 'noModel' });
    expect(detect).not.toHaveBeenCalled();
  });

  it('runs the detector on the photo and the configured model', async () => {
    const detect = jest.fn(async () => tensors(0.9));
    await judgeParking(PHOTO, 'kickboard', '/models/detector.tflite', detect);
    expect(detect).toHaveBeenCalledWith(
      '/tmp/photo.jpg',
      '/models/detector.tflite'
    );
  });

  it('passes a clearly detected vehicle under the demo policy', async () => {
    const judgment = await judgeParking(
      PHOTO,
      'kickboard',
      '/models/detector.tflite',
      async () => tensors(0.95)
    );
    expect(judgment).toMatchObject({ kind: 'verdict', verdict: 'PASS' });
  });

  it('fails when no vehicle is found and explains why', async () => {
    const judgment = await judgeParking(
      PHOTO,
      'kickboard',
      '/models/detector.tflite',
      async () => ({ boxes: [], scores: [], classes: [] })
    );
    expect(judgment).toMatchObject({ kind: 'verdict', verdict: 'FAIL' });
    expect(judgment.kind === 'verdict' && judgment.reasons).toEqual([
      'No vehicle found in the photo. Retake it with the whole vehicle in the frame.',
    ]);
  });

  it('judges only a vehicle that overlaps the guide frame', async () => {
    const detect = async () => tensors(0.95, [0.0, 0.0, 0.2, 0.2]);
    const inside = await judgeParking(
      { path: '/tmp/photo.jpg', guideFrame: [0.1, 0.1, 0.9, 0.9] },
      'kickboard',
      '/models/detector.tflite',
      detect
    );
    const outside = await judgeParking(
      { path: '/tmp/photo.jpg', guideFrame: [0.5, 0.5, 0.9, 0.9] },
      'kickboard',
      '/models/detector.tflite',
      detect
    );
    expect(inside).toMatchObject({ kind: 'verdict', verdict: 'PASS' });
    expect(outside).toMatchObject({ kind: 'verdict', verdict: 'FAIL' });
  });

  it('returns the native error code when the detector rejects', async () => {
    const judgment = await judgeParking(
      PHOTO,
      'kickboard',
      '/models/detector.tflite',
      async () => {
        throw Object.assign(new Error('Could not load the model.'), {
          code: 'E_MODEL_LOAD',
        });
      }
    );
    expect(judgment).toEqual({ kind: 'error', code: 'E_MODEL_LOAD' });
  });

  it('reports a detector output that breaks the contract as E_MODEL_CONTRACT', async () => {
    const judgment = await judgeParking(
      PHOTO,
      'kickboard',
      '/models/detector.tflite',
      async () => ({ boxes: [0.1], scores: [0.9], classes: [0] })
    );
    expect(judgment).toEqual({ kind: 'error', code: 'E_MODEL_CONTRACT' });
  });
});

describe('demo policy', () => {
  it('disables only the rules that the detector cannot evaluate', () => {
    const disabled = (Object.keys(DEMO_POLICY.rules) as RuleId[])
      .filter((id) => DEMO_POLICY.rules[id]?.enabled === false)
      .sort();
    expect(disabled).toEqual(['IMAGE_QUALITY', 'UPRIGHT']);
  });
});

describe('result copy', () => {
  it('titles each verdict', () => {
    expect(resultTitle('PASS')).toBe('Parked correctly');
    expect(resultTitle('WARN')).toBe('Check your parking');
    expect(resultTitle('FAIL')).toBe('Park again');
  });

  it('says so when nothing needs fixing', () => {
    expect(resultReasons([])).toEqual(['No problems found.']);
    expect(resultReasons(['Move it.'])).toEqual(['Move it.']);
  });
});
