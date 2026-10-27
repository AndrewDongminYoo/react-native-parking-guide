import { Platform } from 'react-native';

import ParkingGuide from './NativeParkingGuide';

export interface AttestationOptions {
  /** Lowercase hexadecimal SHA-256 of the photo, for example from `getFileSha256`; exactly 64 characters `0-9a-f`. */
  readonly photoSha256: string;
  /** Server-issued, single-use challenge; a non-empty string that is well-formed UTF-16 (no lone surrogates). */
  readonly challenge: string;
  /**
   * Google Cloud project number linked to the app in the Play Console; a safe integer > 0. Required on Android and
   * ignored on iOS.
   */
  readonly cloudProjectNumber?: number;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** False when `value` contains a lone surrogate, which iOS and Android would encode to different UTF-8 bytes. */
function isWellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateOptions(options: AttestationOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new RangeError('Attestation options must be an object.');
  }
  const { photoSha256, challenge, cloudProjectNumber } = options;
  if (typeof photoSha256 !== 'string' || !SHA256_PATTERN.test(photoSha256)) {
    throw new RangeError(
      'photoSha256 must be 64 lowercase hexadecimal digits.'
    );
  }
  if (
    typeof challenge !== 'string' ||
    challenge.length === 0 ||
    !isWellFormed(challenge)
  ) {
    throw new RangeError(
      'challenge must be a non-empty string without lone surrogates.'
    );
  }
  if (
    cloudProjectNumber !== undefined &&
    (!Number.isSafeInteger(cloudProjectNumber) || cloudProjectNumber <= 0)
  ) {
    throw new RangeError('cloudProjectNumber must be a safe integer > 0.');
  }
  if (Platform.OS === 'android' && cloudProjectNumber === undefined) {
    throw new RangeError('cloudProjectNumber is required on Android.');
  }
}

/**
 * Requests a device attestation token bound to `photoSha256` and `challenge`: App Attest on iOS, Play Integrity on
 * Android. Runs only when called and contacts the platform attestation service over the network. Resolves with the
 * token as a JSON string for `verifyParking({ attestation })`. Rejects with `RangeError` for invalid options, and with
 * code `E_ATTESTATION_UNSUPPORTED` or `E_ATTESTATION_FAILED` from the native module. See the README section
 * "Attestation".
 */
export async function requestAttestation(
  options: AttestationOptions
): Promise<string> {
  validateOptions(options);
  const { photoSha256, challenge, cloudProjectNumber } = options;
  const token = await ParkingGuide.requestAttestation(
    photoSha256,
    challenge,
    cloudProjectNumber ?? 0
  );
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('requestAttestation returned an invalid token.');
  }
  return token;
}

/**
 * Discards the stored App Attest key ID and any pending (not yet attested) key ID on iOS, so that the next
 * `requestAttestation` call resolves with a token of type `"attestation"` for a new key. Call it when the host server
 * does not know the `keyId` of an assertion, for example because the earlier `"attestation"` token never reached it.
 * Rejects with code `E_ATTESTATION_FAILED` when the Keychain delete fails. On Android it resolves without an action.
 * See the README section "Attestation".
 */
export async function resetAttestationKey(): Promise<void> {
  await ParkingGuide.resetAttestationKey();
}
