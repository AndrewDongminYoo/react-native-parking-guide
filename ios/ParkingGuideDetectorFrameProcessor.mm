#if __has_include(<VisionCamera/FrameProcessorPlugin.h>)

#import <VisionCamera/FrameProcessorPlugin.h>
#import <CoreMedia/CoreMedia.h>
#import <ImageIO/ImageIO.h>

#import "ParkingGuideDetector.h"

/// Runs the shared `ParkingGuideDetector` on one camera frame; call it through `createDetectorAsyncRunner`. Returns tensors or
/// `error`.
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
  const CGImagePropertyOrientation orientation = ParkingGuideUprightOrientation(frame.orientation, frame.isMirrored);
  NSURL *modelURL = _modelURL;
  __block NSDictionary *output = nil;
  __block NSString *code = nil;
  CVPixelBufferRetain(buffer);
  dispatch_sync([ParkingGuideDetector sharedQueue], ^{
    // dispatch_sync runs this block on the calling thread. Off VisionCamera's video queue (a worklet context thread)
    // no autorelease pool is ever drained, so the autoreleased CIImage would keep the camera's pixel buffer: after a
    // few frames the capture pool runs out and the preview and frame processor stop.
    @autoreleasepool {
      NSString *message = nil;
      output = [[ParkingGuideDetector shared] runWithPixelBuffer:buffer
                                                     orientation:orientation
                                                        modelURL:modelURL
                                                       errorCode:&code
                                                         message:&message];
    }
  });
  CVPixelBufferRelease(buffer);
  return output ?: @{@"error" : code ?: ParkingGuideDetectorErrorInference};
}

@end

#endif
