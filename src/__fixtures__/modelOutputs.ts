import type { RawModelOutput } from '../inference/mapping';

export const compliantScene: RawModelOutput = {
  detections: [
    {
      classId: 'vehicle',
      confidence: 0.95,
      box: [0, 0, 0.5, 1],
      upright: { score: 0.9, confidence: 0.85 },
    },
    {
      classId: 'parking_zone',
      confidence: 0.9,
      box: [0, 0, 1, 1],
    },
    {
      classId: 'roadway',
      confidence: 0.9,
      box: [0.5, 0, 1, 1],
    },
  ],
  imageQuality: { score: 0.9, confidence: 0.95 },
};

export const prohibitedScene: RawModelOutput = {
  detections: [
    {
      classId: 'vehicle',
      confidence: 1,
      box: [0, 0, 1, 1],
      upright: { score: 0.2, confidence: 0.9 },
    },
    { classId: 'tactile_paving', confidence: 0.9, box: [0, 0, 1, 1] },
    { classId: 'crosswalk', confidence: 0.8, box: [0, 0, 0.5, 1] },
    { classId: 'roadway', confidence: 0.7, box: [0, 0, 0.5, 1] },
    { classId: 'sidewalk_block', confidence: 0.6, box: [0, 0, 0.5, 1] },
  ],
  imageQuality: { score: 0.1, confidence: 0.8 },
};

export const maskedScene: RawModelOutput = {
  detections: [
    {
      classId: 'vehicle',
      confidence: 1,
      box: [0, 0, 1, 1],
      mask: { width: 2, height: 2, data: [1, 1, 0, 0] },
    },
    {
      classId: 'crosswalk',
      confidence: 0.8,
      box: [0, 0, 1, 1],
      mask: { width: 2, height: 2, data: [1, 0, 1, 1] },
    },
    {
      classId: 'parking_zone',
      confidence: 0.9,
      box: [0, 0, 1, 1],
      mask: { width: 2, height: 2, data: [1, 1, 0, 0] },
    },
  ],
};
