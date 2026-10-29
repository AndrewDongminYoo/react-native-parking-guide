import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { requestAttestation, resetAttestationKey } from '../index';
import type { AttestationOptions } from '../index';

const HASH = 'a'.repeat(64);
const TOKEN = JSON.stringify({
  platform: 'ios',
  type: 'attestation',
  keyId: 'a2V5',
  data: 'ZGF0YQ==',
  requestHash: 'b'.repeat(64),
});

const mockRequestAttestation =
  jest.fn<
    (
      photoSha256: string,
      challenge: string,
      cloudProjectNumber: number,
    ) => Promise<string>
  >();
const mockResetAttestationKey = jest.fn<() => Promise<void>>();

jest.mock('../NativeParkingGuide', () => ({
  __esModule: true,
  default: {
    requestAttestation: (
      photoSha256: string,
      challenge: string,
      cloudProjectNumber: number,
    ) => mockRequestAttestation(photoSha256, challenge, cloudProjectNumber),
    resetAttestationKey: () => mockResetAttestationKey(),
  },
}));

function invalid(value: unknown): AttestationOptions {
  return value as AttestationOptions;
}

beforeEach(() => {
  mockRequestAttestation.mockReset();
  mockRequestAttestation.mockResolvedValue(TOKEN);
  mockResetAttestationKey.mockReset();
  mockResetAttestationKey.mockResolvedValue(undefined);
});

describe('requestAttestation', () => {
  it('forwards the options to the native module and returns its token', async () => {
    await expect(
      requestAttestation({ photoSha256: HASH, challenge: 'nonce-1' }),
    ).resolves.toBe(TOKEN);

    expect(mockRequestAttestation).toHaveBeenCalledTimes(1);
    expect(mockRequestAttestation).toHaveBeenCalledWith(HASH, 'nonce-1', 0);
  });

  it('passes the cloud project number when set', async () => {
    await requestAttestation({
      photoSha256: HASH,
      challenge: 'nonce-1',
      cloudProjectNumber: 123456789012,
    });

    expect(mockRequestAttestation).toHaveBeenCalledWith(
      HASH,
      'nonce-1',
      123456789012,
    );
  });

  it('accepts a challenge with a valid surrogate pair', async () => {
    await requestAttestation({
      photoSha256: HASH,
      challenge: '\u{1F6F4}\uD55C',
    });

    expect(mockRequestAttestation).toHaveBeenCalledWith(
      HASH,
      '\u{1F6F4}\uD55C',
      0,
    );
  });

  it('requires the cloud project number on Android', async () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      await expect(
        requestAttestation({ photoSha256: HASH, challenge: 'nonce-1' }),
      ).rejects.toThrow(
        new RangeError('cloudProjectNumber is required on Android.'),
      );
      await expect(
        requestAttestation({
          photoSha256: HASH,
          challenge: 'nonce-1',
          cloudProjectNumber: 42,
        }),
      ).resolves.toBe(TOKEN);
      expect(mockRequestAttestation).toHaveBeenCalledTimes(1);
      expect(mockRequestAttestation).toHaveBeenCalledWith(HASH, 'nonce-1', 42);
    } finally {
      restore.restore();
    }
  });

  it.each([
    ['null options', null],
    ['non-object options', 'options'],
    ['missing photoSha256', { challenge: 'nonce' }],
    ['uppercase photoSha256', { photoSha256: 'A'.repeat(64), challenge: 'n' }],
    ['short photoSha256', { photoSha256: 'a'.repeat(63), challenge: 'n' }],
    ['long photoSha256', { photoSha256: 'a'.repeat(65), challenge: 'n' }],
    ['non-hex photoSha256', { photoSha256: 'g'.repeat(64), challenge: 'n' }],
    ['missing challenge', { photoSha256: HASH }],
    ['empty challenge', { photoSha256: HASH, challenge: '' }],
    ['non-string challenge', { photoSha256: HASH, challenge: 1 }],
    ['lone high surrogate', { photoSha256: HASH, challenge: 'a\uD83D' }],
    ['lone low surrogate', { photoSha256: HASH, challenge: '\uDEF4a' }],
    [
      'reversed surrogate pair',
      { photoSha256: HASH, challenge: '\uDEF4\uD83D' },
    ],
    [
      'zero cloudProjectNumber',
      { photoSha256: HASH, challenge: 'n', cloudProjectNumber: 0 },
    ],
    [
      'negative cloudProjectNumber',
      { photoSha256: HASH, challenge: 'n', cloudProjectNumber: -1 },
    ],
    [
      'fractional cloudProjectNumber',
      { photoSha256: HASH, challenge: 'n', cloudProjectNumber: 1.5 },
    ],
    [
      'unsafe cloudProjectNumber',
      { photoSha256: HASH, challenge: 'n', cloudProjectNumber: 2 ** 53 },
    ],
    [
      'string cloudProjectNumber',
      { photoSha256: HASH, challenge: 'n', cloudProjectNumber: '42' },
    ],
  ])(
    'rejects %s with RangeError before calling native',
    async (_name, value) => {
      await expect(requestAttestation(invalid(value))).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(mockRequestAttestation).not.toHaveBeenCalled();
    },
  );

  it('propagates a native rejection', async () => {
    const error = Object.assign(new Error('App Attest is not supported.'), {
      code: 'E_ATTESTATION_UNSUPPORTED',
    });
    mockRequestAttestation.mockRejectedValueOnce(error);

    await expect(
      requestAttestation({ photoSha256: HASH, challenge: 'nonce-1' }),
    ).rejects.toBe(error);
  });

  it('rejects an empty or non-string native token', async () => {
    mockRequestAttestation.mockResolvedValueOnce('');
    await expect(
      requestAttestation({ photoSha256: HASH, challenge: 'nonce-1' }),
    ).rejects.toThrow('requestAttestation returned an invalid token.');

    mockRequestAttestation.mockResolvedValueOnce(
      undefined as unknown as string,
    );
    await expect(
      requestAttestation({ photoSha256: HASH, challenge: 'nonce-1' }),
    ).rejects.toThrow('requestAttestation returned an invalid token.');
  });
});

describe('resetAttestationKey', () => {
  it('calls the native module once and resolves with undefined', async () => {
    await expect(resetAttestationKey()).resolves.toBeUndefined();

    expect(mockResetAttestationKey).toHaveBeenCalledTimes(1);
    expect(mockRequestAttestation).not.toHaveBeenCalled();
  });

  it('propagates a native rejection', async () => {
    const error = Object.assign(
      new Error('App Attest key reset failed (OSStatus -25308).'),
      { code: 'E_ATTESTATION_FAILED' },
    );
    mockResetAttestationKey.mockRejectedValueOnce(error);

    await expect(resetAttestationKey()).rejects.toBe(error);
  });
});
