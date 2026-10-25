#import "ParkingGuide.h"

#import <CommonCrypto/CommonDigest.h>

static const NSUInteger kSha256ChunkSize = 64 * 1024;

// Same rule as `FileSha256.resolve` on Android: an absolute path, or a `file:///` URI whose text after `file://` is
// strictly percent-decoded as UTF-8 (nil for a malformed sequence or invalid UTF-8).
static NSURL *ParkingGuideFileURL(NSString *uri)
{
  if ([uri hasPrefix:@"/"]) {
    return [NSURL fileURLWithPath:uri];
  }
  if ([uri hasPrefix:@"file:///"]) {
    NSString *path = [[uri substringFromIndex:@"file://".length] stringByRemovingPercentEncoding];
    return path == nil ? nil : [NSURL fileURLWithPath:path];
  }
  return nil;
}

// Returns nil when the file cannot be opened or read.
static NSString *ParkingGuideSha256Hex(NSURL *url)
{
  NSInputStream *stream = [NSInputStream inputStreamWithURL:url];
  if (stream == nil) {
    return nil;
  }
  [stream open];
  if (stream.streamStatus == NSStreamStatusError) {
    return nil;
  }

  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  NSMutableData *buffer = [NSMutableData dataWithLength:kSha256ChunkSize];
  BOOL failed = NO;
  while (YES) {
    NSInteger count = [stream read:(uint8_t *)buffer.mutableBytes maxLength:kSha256ChunkSize];
    if (count < 0) {
      failed = YES;
      break;
    }
    if (count == 0) {
      break;
    }
    CC_SHA256_Update(&context, buffer.bytes, (CC_LONG)count);
  }
  [stream close];
  if (failed) {
    return nil;
  }

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
    [hex appendFormat:@"%02x", digest[i]];
  }
  return hex;
}

@implementation ParkingGuide
- (NSString *)getModelVersion {
  return @"0.1.0-dev";
}

- (void)getFileSha256:(NSString *)uri
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  NSURL *url = ParkingGuideFileURL(uri);
  if (url == nil) {
    reject(@"E_INVALID_URI", @"The photo URI must be an absolute path or a file:/// URI.", nil);
    return;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *hex = ParkingGuideSha256Hex(url);
    if (hex == nil) {
      reject(@"E_PHOTO_READ", @"Could not read the photo file.", nil);
    } else {
      resolve(hex);
    }
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeParkingGuideSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"ParkingGuide";
}

@end
