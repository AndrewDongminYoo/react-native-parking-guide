import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { getFileSha256, verifyParking as publicVerifyParking } from '../index';
import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';
import type { ParkingPolicy, RuleResult } from '../types';
import { verifyParking, type VerifyParkingOptions } from '../verification';

const HASH = 'a'.repeat(64);

const mockGetFileSha256 = jest.fn<(uri: string) => Promise<string>>();
const mockGetModelVersion = jest.fn<() => string>();

jest.mock('../NativeParkingGuide', () => ({
  __esModule: true,
  default: {
    getFileSha256: (uri: string) => mockGetFileSha256(uri),
    getModelVersion: () => mockGetModelVersion(),
  },
}));

const RULES: RuleResult[] = [
  { id: 'VEHICLE_DETECTED', verdict: 'PASS', confidence: 0.95 },
  { id: 'UPRIGHT', verdict: 'PASS', confidence: 0.9 },
  { id: 'TACTILE_PAVING', verdict: 'WARN', confidence: 0.8, score: 0.6 },
];

function options(
  overrides: Partial<VerifyParkingOptions> = {}
): VerifyParkingOptions {
  return {
    photo: { uri: '/tmp/photo.jpg', width: 1920, height: 1080 },
    ruleResults: RULES,
    deviceTilt: { pitch: 0.1, roll: -0.2 },
    capturedAt: new Date('2026-10-25T01:02:03.004Z'),
    ...overrides,
  };
}

function invalid(value: unknown): VerifyParkingOptions {
  return value as VerifyParkingOptions;
}

beforeEach(() => {
  mockGetFileSha256.mockReset();
  mockGetFileSha256.mockResolvedValue(HASH);
  mockGetModelVersion.mockReset();
  mockGetModelVersion.mockReturnValue('0.1.0-dev');
});

describe('verifyParking', () => {
  it('assembles a VerificationResult from the photo, rules, and metadata', async () => {
    const result = await verifyParking(options());

    expect(mockGetFileSha256).toHaveBeenCalledTimes(1);
    expect(mockGetFileSha256).toHaveBeenCalledWith('/tmp/photo.jpg');
    expect(result).toEqual({
      ...evaluatePolicy(RULES, defaultPolicy),
      rules: RULES,
      photo: {
        uri: '/tmp/photo.jpg',
        width: 1920,
        height: 1080,
        sha256: HASH,
      },
      metadata: {
        capturedAt: '2026-10-25T01:02:03.004Z',
        deviceTilt: { pitch: 0.1, roll: -0.2 },
        modelVersion: '0.1.0-dev',
        platform: 'ios',
      },
    });
    expect(Object.keys(result.metadata)).not.toEqual(
      expect.arrayContaining(['location'])
    );
    expect(Object.keys(result.metadata)).not.toEqual(
      expect.arrayContaining(['heading'])
    );
    expect(Object.keys(result.metadata)).not.toEqual(
      expect.arrayContaining(['attestation'])
    );
  });

  it('uses the caller policy for the verdict and score', async () => {
    const policy: ParkingPolicy = {
      version: 2,
      passThreshold: 0.99,
      rules: { TACTILE_PAVING: { enabled: true, severity: 'WARN' } },
    };

    const result = await verifyParking(options({ policy }));

    expect(result.verdict).toBe('WARN');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('includes location, heading, and attestation only when passed', async () => {
    const location = { lat: 37.5665, lng: 126.978, accuracy: 8 };

    const result = await verifyParking(
      options({ location, heading: 359.5, attestation: 'token' })
    );

    expect(result.metadata.location).toEqual(location);
    expect(result.metadata.location).not.toBe(location);
    expect(result.metadata.heading).toBe(359.5);
    expect(result.metadata.attestation).toBe('token');
  });

  it('copies inputs instead of returning caller-owned objects', async () => {
    const opts = options();

    const result = await verifyParking(opts);

    expect(result.rules).not.toBe(opts.ruleResults);
    expect(result.metadata.deviceTilt).not.toBe(opts.deviceTilt);
    expect(result.photo).not.toBe(opts.photo);
  });

  it('defaults capturedAt to the time of the call', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-02T03:04:05.000Z') });
    try {
      const result = await verifyParking(options({ capturedAt: undefined }));

      expect(result.metadata.capturedAt).toBe('2026-01-02T03:04:05.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports the Android platform', async () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const result = await verifyParking(options());

      expect(result.metadata.platform).toBe('android');
    } finally {
      restore.restore();
    }
  });

  it('rejects on a platform other than iOS or Android', async () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await expect(verifyParking(options())).rejects.toThrow(
        'verifyParking supports only iOS and Android.'
      );
      expect(mockGetFileSha256).not.toHaveBeenCalled();
    } finally {
      restore.restore();
    }
  });

  it('rejects a native hash that is not 64 lowercase hex digits', async () => {
    mockGetFileSha256.mockResolvedValue('A'.repeat(64));

    await expect(verifyParking(options())).rejects.toThrow(
      'getFileSha256 returned an invalid SHA-256 digest.'
    );
  });

  it('propagates a native read failure', async () => {
    mockGetFileSha256.mockRejectedValue(new Error('read failed'));

    await expect(verifyParking(options())).rejects.toThrow('read failed');
  });

  it.each<[string, VerifyParkingOptions]>([
    ['options is not an object', invalid(null)],
    ['empty photo uri', options({ photo: { uri: '', width: 1, height: 1 } })],
    ['zero width', options({ photo: { uri: '/p.jpg', width: 0, height: 1 } })],
    [
      'fractional height',
      options({ photo: { uri: '/p.jpg', width: 1, height: 1.5 } }),
    ],
    ['missing photo', invalid({ ...options(), photo: undefined })],
    ['rules not an array', invalid({ ...options(), ruleResults: {} })],
    [
      'rule with an unknown verdict',
      options({
        ruleResults: [
          invalid({ id: 'UPRIGHT', verdict: 'OK', confidence: 1 }),
        ] as never,
      }),
    ],
    ['invalid policy', options({ policy: invalid({ version: 1 }) as never })],
    [
      'pitch above pi',
      options({ deviceTilt: { pitch: Math.PI + 0.01, roll: 0 } }),
    ],
    ['NaN roll', options({ deviceTilt: { pitch: 0, roll: Number.NaN } })],
    ['missing deviceTilt', invalid({ ...options(), deviceTilt: undefined })],
    ['heading of 360', options({ heading: 360 })],
    ['negative heading', options({ heading: -1 })],
    [
      'latitude above 90',
      options({ location: { lat: 91, lng: 0, accuracy: 1 } }),
    ],
    [
      'negative accuracy',
      options({ location: { lat: 0, lng: 0, accuracy: -1 } }),
    ],
    ['invalid capturedAt', options({ capturedAt: new Date(Number.NaN) })],
    ['capturedAt string', invalid({ ...options(), capturedAt: '2026' })],
    ['non-string attestation', invalid({ ...options(), attestation: 1 })],
  ])('rejects with RangeError before hashing: %s', async (_, input) => {
    await expect(verifyParking(input)).rejects.toBeInstanceOf(RangeError);
    expect(mockGetFileSha256).not.toHaveBeenCalled();
  });

  it('accepts the tilt and heading range boundaries', async () => {
    const result = await verifyParking(
      options({ deviceTilt: { pitch: -Math.PI, roll: Math.PI }, heading: 0 })
    );

    expect(result.metadata.deviceTilt).toEqual({
      pitch: -Math.PI,
      roll: Math.PI,
    });
    expect(result.metadata.heading).toBe(0);
  });
});

describe('public API', () => {
  it('exports verifyParking and forwards getFileSha256 to the native module', async () => {
    expect(publicVerifyParking).toBe(verifyParking);
    await expect(getFileSha256('file:///tmp/a.jpg')).resolves.toBe(HASH);
    expect(mockGetFileSha256).toHaveBeenCalledWith('file:///tmp/a.jpg');
  });
});
