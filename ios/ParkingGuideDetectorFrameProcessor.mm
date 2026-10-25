#if __has_include(<VisionCamera/FrameProcessorPlugin.h>)

#import <VisionCamera/FrameProcessorPlugin.h>
#import <CoreMedia/CoreMedia.h>
#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>

#import "ParkingGuideDetector.h"

/// Runs the shared `ParkingGuideDetector` on one camera frame; call it inside `runAsync`. Returns tensors or `error`.
@interface ParkingGuideDetectorFrameProcessor : FrameProcessorPlugin
@end

@implementation ParkingGuideDetectorFrameProcessor {
  NSURL *_modelURL;
}

VISION_EXPORT_FRAME_PROCESSOR(ParkingGuideDetectorFrameProcessor, parkingDetector)

- (instancetype)initWithProxy:(VisionCameraProxyHolder *)proxy withOptions:(NSDictionary *)options
{
  self = [super initWithProxy:proxy withOptions:options];
  if (self) {
    id uri = options[@"modelUri"];
    _modelURL = [uri isKindOfClass:[NSString class]] ? ParkingGuideFileURL(uri) : nil;
  }
  return self;
}

/// Maps VisionCamera's `UIImageOrientation` and mirroring to the `CGImagePropertyOrientation` that makes it upright.
static CGImagePropertyOrientation ParkingGuideOrientation(UIImageOrientation orientation, BOOL mirrored)
{
  switch (orientation) {
    case UIImageOrientationUp:
    case UIImageOrientationUpMirrored:
      return mirrored ? kCGImagePropertyOrientationUpMirrored : kCGImagePropertyOrientationUp;
    case UIImageOrientationDown:
    case UIImageOrientationDownMirrored:
      return mirrored ? kCGImagePropertyOrientationDownMirrored : kCGImagePropertyOrientationDown;
    case UIImageOrientationLeft:
    case UIImageOrientationLeftMirrored:
      return mirrored ? kCGImagePropertyOrientationLeftMirrored : kCGImagePropertyOrientationLeft;
    case UIImageOrientationRight:
    case UIImageOrientationRightMirrored:
      return mirrored ? kCGImagePropertyOrientationRightMirrored : kCGImagePropertyOrientationRight;
  }
  return kCGImagePropertyOrientationUp;
}

- (id)callback:(Frame *)frame withArguments:(NSDictionary *)arguments
{
  if ([NSThread isMainThread]) {
    [NSException raise:NSInternalInconsistencyException format:@"parkingDetector must run on a frame processor thread."];
  }
  if (_modelURL == nil) {
    return @{@"error" : @"E_INVALID_URI"};
  }
  CVPixelBufferRef buffer = frame.isValid ? CMSampleBufferGetImageBuffer(frame.buffer) : nullptr;
  if (buffer == nullptr) {
    return @{@"error" : ParkingGuideDetectorErrorPhotoRead};
  }
  const CGImagePropertyOrientation orientation = ParkingGuideOrientation(frame.orientation, frame.isMirrored);
  NSURL *modelURL = _modelURL;
  __block NSDictionary *output = nil;
  __block NSString *code = nil;
  CVPixelBufferRetain(buffer);
  dispatch_sync([ParkingGuideDetector sharedQueue], ^{
    NSString *message = nil;
    output = [[ParkingGuideDetector shared] runWithPixelBuffer:buffer
                                                   orientation:orientation
                                                      modelURL:modelURL
                                                     errorCode:&code
                                                       message:&message];
  });
  CVPixelBufferRelease(buffer);
  return output ?: @{@"error" : code ?: ParkingGuideDetectorErrorInference};
}

@end

#endif
