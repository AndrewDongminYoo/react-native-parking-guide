#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ParkingGuideAttestationCompletion)(NSString *_Nullable token,
                                                  NSString *_Nullable errorCode,
                                                  NSString *_Nullable errorMessage);

/// Requests an App Attest attestation (first call) or assertion (later calls) bound to the SHA-256 of the UTF-8 bytes
/// of `photoSha256 + ":" + challenge`. Calls are serialized on one private queue, and `completion` runs on that queue
/// with either the token JSON string or an error code (`E_ATTESTATION_UNSUPPORTED` or `E_ATTESTATION_FAILED`) and
/// a message.
void ParkingGuideRequestAttestation(NSString *photoSha256,
                                    NSString *challenge,
                                    ParkingGuideAttestationCompletion completion);

typedef void (^ParkingGuideAttestationResetCompletion)(NSString *_Nullable errorCode,
                                                       NSString *_Nullable errorMessage);

/// Deletes the stored App Attest key IDs (the attested key and a pending key whose attestation has not succeeded), so
/// that the next `ParkingGuideRequestAttestation` call generates and attests a new key. Runs on the same serial queue as
/// `ParkingGuideRequestAttestation`. `completion` runs on that queue with `nil` arguments when the key IDs were deleted
/// or no key ID was stored, or with `E_ATTESTATION_FAILED` and a message that contains the Keychain `OSStatus`.
void ParkingGuideResetAttestationKey(ParkingGuideAttestationResetCompletion completion);

NS_ASSUME_NONNULL_END
