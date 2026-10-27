#import "ParkingGuideAttestation.h"

#import <CommonCrypto/CommonDigest.h>
#import <DeviceCheck/DeviceCheck.h>
#import <Security/Security.h>

static NSString *const kUnsupported = @"E_ATTESTATION_UNSUPPORTED";
static NSString *const kFailed = @"E_ATTESTATION_FAILED";
static NSString *const kKeychainService = @"com.parkingguide.appattest";
// The attested key ID, used for assertions.
static NSString *const kKeychainAccount = @"keyId";
// A generated key ID whose attestation has not succeeded yet, with the client data hash of that attestation, as the
// JSON object {"keyId":"<key ID>","clientDataHash":"<lowercase hex>"}. It is never used for assertions.
static NSString *const kKeychainPendingAccount = @"pendingKeyId";

static NSDictionary *ParkingGuideKeyQuery(NSString *account)
{
  return @{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : kKeychainService,
    (__bridge id)kSecAttrAccount : account,
  };
}

// Returns nil with `*status` errSecItemNotFound when no key is stored, or another status when the read failed.
static NSString *ParkingGuideLoadKeyId(NSString *account, OSStatus *status)
{
  NSMutableDictionary *query = [ParkingGuideKeyQuery(account) mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef result = NULL;
  *status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (*status != errSecSuccess) {
    return nil;
  }
  NSData *data = (__bridge_transfer NSData *)result;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static OSStatus ParkingGuideDeleteKeyId(NSString *account)
{
  return SecItemDelete((__bridge CFDictionaryRef)ParkingGuideKeyQuery(account));
}

static OSStatus ParkingGuideStoreKeyId(NSString *account, NSString *keyId)
{
  ParkingGuideDeleteKeyId(account);
  NSMutableDictionary *item = [ParkingGuideKeyQuery(account) mutableCopy];
  item[(__bridge id)kSecValueData] = [keyId dataUsingEncoding:NSUTF8StringEncoding];
  // App Attest keys are bound to this device's Secure Enclave, so the key ID must not move to another device.
  item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
  return SecItemAdd((__bridge CFDictionaryRef)item, NULL);
}

// Stores the pending key ID together with the client data hash of its attestation in one Keychain item, so that the two
// values cannot get out of sync.
static OSStatus ParkingGuideStorePendingKey(NSString *keyId, NSString *requestHash)
{
  NSDictionary *pending = @{@"keyId" : keyId, @"clientDataHash" : requestHash};
  NSData *json = [NSJSONSerialization dataWithJSONObject:pending options:0 error:nil];
  if (json == nil) {
    return errSecParam;
  }
  return ParkingGuideStoreKeyId(kKeychainPendingAccount, [[NSString alloc] initWithData:json
                                                                               encoding:NSUTF8StringEncoding]);
}

// Returns the pending key ID and sets `*requestHash` to the lowercase hex client data hash of its attestation. Returns
// nil with `*status` errSecItemNotFound when no pending key is stored, with errSecDecode when the stored item is not
// valid, or with another status when the read failed.
static NSString *ParkingGuideLoadPendingKey(NSString *__autoreleasing *requestHash, OSStatus *status)
{
  NSString *stored = ParkingGuideLoadKeyId(kKeychainPendingAccount, status);
  if (stored == nil) {
    return nil;
  }
  NSData *json = [stored dataUsingEncoding:NSUTF8StringEncoding];
  id pending = json == nil ? nil : [NSJSONSerialization JSONObjectWithData:json options:0 error:nil];
  id keyId = [pending isKindOfClass:[NSDictionary class]] ? pending[@"keyId"] : nil;
  id hash = [pending isKindOfClass:[NSDictionary class]] ? pending[@"clientDataHash"] : nil;
  if (![keyId isKindOfClass:[NSString class]] || ![hash isKindOfClass:[NSString class]]) {
    *status = errSecDecode;
    return nil;
  }
  *requestHash = hash;
  return keyId;
}

static NSString *ParkingGuideHex(NSData *data)
{
  const unsigned char *bytes = (const unsigned char *)data.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger i = 0; i < data.length; i++) {
    [hex appendFormat:@"%02x", bytes[i]];
  }
  return hex;
}

static BOOL ParkingGuideIsDCError(NSError *error, DCError code)
{
  return [error.domain isEqualToString:DCErrorDomain] && error.code == code;
}

static void ParkingGuideFail(NSString *step, NSError *error, ParkingGuideAttestationCompletion completion)
{
  NSString *code = ParkingGuideIsDCError(error, DCErrorFeatureUnsupported) ? kUnsupported : kFailed;
  NSString *message =
      [NSString stringWithFormat:@"App Attest %@ failed (%@ %ld).", step, error.domain, (long)error.code];
  completion(nil, code, message);
}

static NSString *ParkingGuideTokenJSON(NSString *type, NSString *keyId, NSData *data, NSString *requestHash)
{
  NSDictionary *token = @{
    @"platform" : @"ios",
    @"type" : type,
    @"keyId" : keyId,
    @"data" : [data base64EncodedStringWithOptions:0],
    @"requestHash" : requestHash,
  };
  NSData *json = [NSJSONSerialization dataWithJSONObject:token options:NSJSONWritingWithoutEscapingSlashes error:nil];
  return json == nil ? nil : [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}

static void ParkingGuideAttestOnQueue(NSString *photoSha256,
                                      NSString *challenge,
                                      ParkingGuideAttestationCompletion completion)
{
  DCAppAttestService *service = DCAppAttestService.sharedService;
  if (!service.isSupported) {
    completion(nil, kUnsupported, @"App Attest is not supported on this device.");
    return;
  }
  NSData *clientData = [[NSString stringWithFormat:@"%@:%@", photoSha256, challenge]
      dataUsingEncoding:NSUTF8StringEncoding];
  if (clientData == nil) {
    completion(nil, kFailed, @"The challenge is not valid UTF-8.");
    return;
  }
  NSMutableData *clientDataHash = [NSMutableData dataWithLength:CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(clientData.bytes, (CC_LONG)clientData.length, (unsigned char *)clientDataHash.mutableBytes);
  NSString *requestHash = ParkingGuideHex(clientDataHash);

  OSStatus status = errSecSuccess;
  NSString *keyId = ParkingGuideLoadKeyId(kKeychainAccount, &status);
  if (keyId == nil && status != errSecItemNotFound) {
    // Generating a new key here would replace a key the server may already trust.
    completion(nil, kFailed, [NSString stringWithFormat:@"App Attest key lookup failed (OSStatus %d).", (int)status]);
    return;
  }
  NSString *pendingKeyId = nil;
  if (keyId == nil) {
    NSString *pendingRequestHash = nil;
    pendingKeyId = ParkingGuideLoadPendingKey(&pendingRequestHash, &status);
    if (pendingKeyId == nil && status != errSecItemNotFound && status != errSecDecode) {
      // Generating a new key here would discard a key that can still be attested.
      completion(
          nil, kFailed, [NSString stringWithFormat:@"App Attest pending key lookup failed (OSStatus %d).", (int)status]);
      return;
    }
    if (pendingKeyId == nil || ![pendingRequestHash isEqualToString:requestHash]) {
      // Apple allows a retry after DCErrorServerUnavailable only with the same key and the same client data hash. A
      // request for a different photo or challenge (or a stored item that is not valid) cannot retry the pending
      // attestation, so it discards the pending key and generates a new key.
      ParkingGuideDeleteKeyId(kKeychainPendingAccount);
      pendingKeyId = nil;
    }
  }

  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  // The second pass runs only after DCErrorInvalidKey, with a newly generated key.
  for (int pass = 0; pass < 2; pass++) {
    __block NSString *generatedKeyId = nil;
    __block NSData *data = nil;
    __block NSError *error = nil;
    if (keyId == nil) {
      NSString *attestKeyId = pendingKeyId;
      if (attestKeyId == nil) {
        [service generateKeyWithCompletionHandler:^(NSString *newKeyId, NSError *generateError) {
          generatedKeyId = newKeyId;
          error = generateError;
          dispatch_semaphore_signal(done);
        }];
        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        if (generatedKeyId == nil) {
          ParkingGuideFail(@"key generation", error, completion);
          return;
        }
        attestKeyId = generatedKeyId;
        // Keep the key ID and this client data hash as pending until the attestation succeeds, so that a call after
        // DCErrorServerUnavailable with the same photo and challenge attests the same key with the same client data
        // hash instead of generating another key. If the store fails, the next call generates a new key.
        ParkingGuideStorePendingKey(attestKeyId, requestHash);
      }
      [service attestKey:attestKeyId
            clientDataHash:clientDataHash
         completionHandler:^(NSData *attestationObject, NSError *attestError) {
           data = attestationObject;
           error = attestError;
           dispatch_semaphore_signal(done);
         }];
      dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
      if (data == nil) {
        // Apple: after DCErrorServerUnavailable, attest the same key with the same client data hash again later; after
        // any other error, discard the key ID and create a new key for the next try.
        if (!ParkingGuideIsDCError(error, DCErrorServerUnavailable)) {
          ParkingGuideDeleteKeyId(kKeychainPendingAccount);
          pendingKeyId = nil;
          if (pass == 0 && ParkingGuideIsDCError(error, DCErrorInvalidKey)) {
            continue;
          }
        }
        ParkingGuideFail(@"attestation", error, completion);
        return;
      }
      // Store the key ID as attested only after the attestation succeeded, so that assertions use only an attested key.
      // If the store fails, the attestation is still valid; the next call attests the pending key again, or a new key.
      // If this token does not reach the server, the host calls ParkingGuideResetAttestationKey so that the next call
      // attests a new key.
      if (ParkingGuideStoreKeyId(kKeychainAccount, attestKeyId) == errSecSuccess) {
        ParkingGuideDeleteKeyId(kKeychainPendingAccount);
      }
      NSString *token = ParkingGuideTokenJSON(@"attestation", attestKeyId, data, requestHash);
      completion(token, token == nil ? kFailed : nil, token == nil ? @"Could not encode the App Attest token." : nil);
      return;
    }

    [service generateAssertion:keyId
                clientDataHash:clientDataHash
             completionHandler:^(NSData *assertionObject, NSError *assertionError) {
               data = assertionObject;
               error = assertionError;
               dispatch_semaphore_signal(done);
             }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (data == nil) {
      if (pass == 0 && ParkingGuideIsDCError(error, DCErrorInvalidKey)) {
        ParkingGuideDeleteKeyId(kKeychainAccount);
        keyId = nil;
        continue;
      }
      ParkingGuideFail(@"assertion", error, completion);
      return;
    }
    NSString *token = ParkingGuideTokenJSON(@"assertion", keyId, data, requestHash);
    completion(token, token == nil ? kFailed : nil, token == nil ? @"Could not encode the App Attest token." : nil);
    return;
  }
  completion(nil, kFailed, @"App Attest failed after regenerating an invalid key.");
}

// Serial, so that two concurrent first calls do not generate and attest two keys, and so that a reset never deletes the
// key while a request is using it.
static dispatch_queue_t ParkingGuideAttestationQueue(void)
{
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("com.parkingguide.attestation", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

void ParkingGuideRequestAttestation(NSString *photoSha256,
                                    NSString *challenge,
                                    ParkingGuideAttestationCompletion completion)
{
  dispatch_async(ParkingGuideAttestationQueue(), ^{
    ParkingGuideAttestOnQueue(photoSha256, challenge, completion);
  });
}

void ParkingGuideResetAttestationKey(ParkingGuideAttestationResetCompletion completion)
{
  dispatch_async(ParkingGuideAttestationQueue(), ^{
    OSStatus status = ParkingGuideDeleteKeyId(kKeychainAccount);
    OSStatus pendingStatus = ParkingGuideDeleteKeyId(kKeychainPendingAccount);
    if (status == errSecSuccess || status == errSecItemNotFound) {
      status = pendingStatus;
    }
    if (status == errSecSuccess || status == errSecItemNotFound) {
      completion(nil, nil);
    } else {
      completion(kFailed, [NSString stringWithFormat:@"App Attest key reset failed (OSStatus %d).", (int)status]);
    }
  });
}
