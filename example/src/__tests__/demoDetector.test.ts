import { describe, expect, it, jest } from '@jest/globals';
import {
  decodeDetectorOutput,
  mapGuidanceIssues,
  screenRectToFrameBox,
} from 'react-native-parking-guide';
import type { DetectorOutput } from 'react-native-parking-guide';

import { detectorModelUri } from '../detectorModel';
import {
  fitGuideFrameWidth,
  GUIDE_FRAME_ASPECT_RATIO,
  GUIDE_FRAME_HINT_GAP,
} from '../guideFrameLayout';
import { judgeParking } from '../parkingResult';

jest.mock(
  'react-native-parking-guide',
  () => ({
    ...jest.requireActual<object>('../../../src/feedback/feedback'),
    ...jest.requireActual<object>('../../../src/guidance/screenRect'),
    ...jest.requireActual<object>('../../../src/inference/detector'),
    ...jest.requireActual<object>('../../../src/inference/guidance'),
    ...jest.requireActual<object>('../../../src/inference/mapping'),
    ...jest.requireActual<object>('../../../src/policy/defaultPolicy'),
    ...jest.requireActual<object>('../../../src/policy/evaluate'),
    runDetector: jest.fn(),
  }),
  { virtual: true }
);

/**
 * The output of `fixtures/detector/detector-demo.{tflite,mlpackage}` (see `scripts/make-fixture-models.py`): rows for
 * a kickboard, a crosswalk, a sidewalk block, and a parking zone, each scored 0.9 when its color gate passes.
 */
function demoOutput(
  vehicle: boolean,
  scene: 'neutral' | 'green' | 'blue'
): DetectorOutput {
  const score = (on: boolean) => (on ? 0.9 : 0);
  return {
    boxes: [0.375, 0.3125, 0.625, 0.5, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    scores: [
      score(vehicle),
      score(scene === 'green'),
      score(scene === 'blue'),
      score(scene === 'neutral'),
    ],
    classes: [0, 4, 6, 7],
  };
}

const PHOTO = { path: '/tmp/photo.jpg', guideFrame: undefined };
const MODEL = '/models/detector-demo.tflite';

describe('detectorModelUri', () => {
  it('keeps no model, absolute paths, and URIs as they are', () => {
    expect(detectorModelUri(undefined, '/files')).toBeUndefined();
    expect(detectorModelUri('/models/a.tflite', '/files')).toBe(
      '/models/a.tflite'
    );
    expect(detectorModelUri('file:///models/a.tflite', '/files')).toBe(
      'file:///models/a.tflite'
    );
    expect(detectorModelUri('content://models/a', '/files')).toBe(
      'content://models/a'
    );
  });

  it('resolves a file name inside the files directory', () => {
    expect(detectorModelUri('a.mlpackage', '/app/Documents')).toBe(
      '/app/Documents/a.mlpackage'
    );
    expect(detectorModelUri('a.mlpackage', '/app/Documents/')).toBe(
      '/app/Documents/a.mlpackage'
    );
  });

  it('keeps a file name when the native app passes no files directory', () => {
    expect(detectorModelUri('a.tflite', undefined)).toBe('a.tflite');
  });
});

describe('demo detector verdicts under the demo policy', () => {
  it.each([
    { scene: 'neutral', verdict: 'PASS', reasons: 0 },
    { scene: 'blue', verdict: 'WARN', reasons: 2 },
    { scene: 'green', verdict: 'FAIL', reasons: 2 },
  ] as const)(
    'judges a red vehicle on a $scene scene as $verdict',
    async ({ scene, verdict, reasons }) => {
      const judgment = await judgeParking(PHOTO, 'kickboard', MODEL, async () =>
        demoOutput(true, scene)
      );
      expect(judgment).toMatchObject({ kind: 'verdict', verdict });
      expect(judgment.kind === 'verdict' && judgment.reasons).toHaveLength(
        reasons
      );
    }
  );

  it('fails a scene without a red vehicle', async () => {
    const judgment = await judgeParking(PHOTO, 'kickboard', MODEL, async () =>
      demoOutput(false, 'neutral')
    );
    expect(judgment).toMatchObject({ kind: 'verdict', verdict: 'FAIL' });
  });
});

/**
 * Approximate capture layouts: the screen size, and the frame area between the header and the footer, in points.
 * The values are estimates from the `CaptureScreen` styles, not measurements.
 */
const LAYOUTS = [
  {
    name: 'iPhone 16 Pro',
    view: { width: 402, height: 874 },
    area: { y: 160, height: 463 },
  },
  {
    name: 'iPhone 16 Pro, taller header and footer',
    view: { width: 402, height: 874 },
    area: { y: 200, height: 380 },
  },
  {
    name: 'iPhone SE',
    view: { width: 375, height: 667 },
    area: { y: 119, height: 328 },
  },
  {
    name: 'Pixel 9',
    view: { width: 412, height: 923 },
    area: { y: 120, height: 520 },
  },
];
const HINT_HEIGHT = 40;
const FRAME_SIZES = [
  { width: 1080, height: 1920 },
  { width: 1440, height: 1920 },
];

describe('demo detector box in the example guide frame', () => {
  it.each(
    LAYOUTS.flatMap((layout) =>
      FRAME_SIZES.map((frame) => ({
        ...layout,
        frame,
        label: `${frame.width}x${frame.height}`,
      }))
    )
  )(
    'has no guidance issue on $name with a $label frame',
    ({ view, area, frame }) => {
      const width = fitGuideFrameWidth(
        { width: view.width, height: area.height },
        HINT_HEIGHT
      );
      const height = width / GUIDE_FRAME_ASPECT_RATIO;
      const guideFrame = screenRectToFrameBox(
        {
          x: (view.width - width) / 2,
          y:
            area.y +
            (area.height - (height + GUIDE_FRAME_HINT_GAP + HINT_HEIGHT)) / 2,
          width,
          height,
        },
        view,
        frame
      );
      expect(
        mapGuidanceIssues(decodeDetectorOutput(demoOutput(true, 'neutral')), {
          guideFrame,
          vehicleType: 'kickboard',
        })
      ).toEqual([]);
    }
  );
});
