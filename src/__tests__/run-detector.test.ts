import { describe, expect, it, jest } from '@jest/globals';

import { decodeDetectorOutput, runDetector } from '../index';
import type { DetectorOutput } from '../index';

// The output that fixtures/detector/detector-*.{tflite,mlpackage} return for fixtures/detector/solid.png.
const FIXTURE_OUTPUT: DetectorOutput = {
  boxes: [0.1, 0.2, 0.6, 0.9, 0, 0, 0, 0],
  scores: [0.79999, 0],
  classes: [0, 3],
};

const mockRunDetector =
  jest.fn<(photoUri: string, modelUri: string) => Promise<DetectorOutput>>();

jest.mock('../NativeParkingGuide', () => ({
  __esModule: true,
  default: {
    runDetector: (photoUri: string, modelUri: string) =>
      mockRunDetector(photoUri, modelUri),
  },
}));

describe('runDetector', () => {
  it('forwards both URIs to the native module and returns decodable tensors', async () => {
    mockRunDetector.mockResolvedValueOnce(FIXTURE_OUTPUT);

    const output = await runDetector(
      'file:///tmp/photo.jpg',
      '/data/model.tflite'
    );

    expect(mockRunDetector).toHaveBeenCalledWith(
      'file:///tmp/photo.jpg',
      '/data/model.tflite'
    );
    expect(decodeDetectorOutput(output).detections).toEqual([
      {
        classId: 'vehicle',
        confidence: 0.79999,
        box: [0.1, 0.2, 0.6, 0.9],
        vehicleType: 'kickboard',
      },
      { classId: 'tactile_paving', confidence: 0, box: [0, 0, 0, 0] },
    ]);
  });

  it('propagates a native rejection', async () => {
    const error = Object.assign(new Error('Could not load the model.'), {
      code: 'E_MODEL_LOAD',
    });
    mockRunDetector.mockRejectedValueOnce(error);

    await expect(runDetector('/a.jpg', '/missing.tflite')).rejects.toBe(error);
  });
});
