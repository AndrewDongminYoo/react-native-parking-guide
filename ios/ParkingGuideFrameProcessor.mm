#if __has_include(<VisionCamera/FrameProcessorPlugin.h>)

#import <VisionCamera/FrameProcessorPlugin.h>
#import <CoreMotion/CoreMotion.h>
#import <CoreVideo/CoreVideo.h>
#import <QuartzCore/QuartzCore.h>

#include "../cpp/CaptureMetrics.h"

@interface ParkingGuideFrameProcessor : FrameProcessorPlugin
@end

@implementation ParkingGuideFrameProcessor {
  CMMotionManager *_motion;
  dispatch_source_t _idleTimer;
  CFTimeInterval _lastFrameTime;
  parkingguide::CaptureThresholds _thresholds;
}

VISION_EXPORT_FRAME_PROCESSOR(ParkingGuideFrameProcessor, parkingGuide)

- (instancetype)initWithProxy:(VisionCameraProxyHolder *)proxy
                  withOptions:(NSDictionary *)options {
  self = [super initWithProxy:proxy withOptions:options];
  if (self) {
    for (NSString *key in @[@"minLaplacianVariance", @"minMeanLuminance", @"maxTiltRadians"]) {
      id value = options[key];
      if (![value isKindOfClass:[NSNumber class]] ||
          !std::isfinite([value doubleValue]) || [value doubleValue] <= 0) {
        [NSException raise:NSInvalidArgumentException
                    format:@"parkingGuide requires a positive finite %@ threshold.", key];
      }
    }
    _thresholds = {[options[@"minLaplacianVariance"] doubleValue],
                   [options[@"minMeanLuminance"] doubleValue],
                   [options[@"maxTiltRadians"] doubleValue]};
    _motion = [[CMMotionManager alloc] init];
    _motion.deviceMotionUpdateInterval = 1.0 / 30.0;
    _idleTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
        dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
    dispatch_source_set_timer(_idleTimer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC),
                              NSEC_PER_SEC, NSEC_PER_SEC / 10);
    __weak ParkingGuideFrameProcessor *weakSelf = self;
    dispatch_source_set_event_handler(_idleTimer, ^{
      ParkingGuideFrameProcessor *strongSelf = weakSelf;
      if (!strongSelf) return;
      @synchronized (strongSelf) {
        // Stop sensors after idle capture, even if JS retains the plugin.
        if (CACurrentMediaTime() - strongSelf->_lastFrameTime >= 1.0) {
          [strongSelf->_motion stopDeviceMotionUpdates];
        }
      }
    });
    dispatch_resume(_idleTimer);
  }
  return self;
}

- (void)dealloc {
  if (_idleTimer) dispatch_source_cancel(_idleTimer);
  [_motion stopDeviceMotionUpdates];
}

- (id)callback:(Frame *)frame withArguments:(NSDictionary *)arguments {
  if ([NSThread isMainThread]) {
    [NSException raise:NSInternalInconsistencyException
                format:@"parkingGuide must run on the frame processor thread."];
  }
  @autoreleasepool {
    CMDeviceMotion *motion;
    @synchronized (self) {
      _lastFrameTime = CACurrentMediaTime();
      if (_motion.isDeviceMotionAvailable && !_motion.isDeviceMotionActive) {
        [_motion startDeviceMotionUpdates];
      }
      motion = _motion.deviceMotion;
    }
    parkingguide::ImageMetrics metrics;
    CVPixelBufferRef buffer = frame.isValid ? CMSampleBufferGetImageBuffer(frame.buffer) : nullptr;
    if (buffer) {
      const OSType format = CVPixelBufferGetPixelFormatType(buffer);
      const bool fullRange = format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;
      const bool videoRange = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
      if ((fullRange || videoRange) && CVPixelBufferGetPlaneCount(buffer) >= 1 &&
          CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly) == kCVReturnSuccess) {
        metrics = parkingguide::measureLuma(
            static_cast<const uint8_t *>(CVPixelBufferGetBaseAddressOfPlane(buffer, 0)),
            CVPixelBufferGetWidthOfPlane(buffer, 0),
            CVPixelBufferGetHeightOfPlane(buffer, 0),
            CVPixelBufferGetBytesPerRowOfPlane(buffer, 0), videoRange);
        CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
      }
    }
    const CMAcceleration gravity = motion ? motion.gravity : CMAcceleration{0, 0, 0};
    const auto tilt = parkingguide::tiltFromGravity(gravity.x, gravity.y, gravity.z);
    const double motionAge = motion ? CACurrentMediaTime() - motion.timestamp : -1;
    const auto result = parkingguide::assessCapture(
        metrics, tilt.pitch, tilt.roll, motionAge >= 0 && motionAge <= 0.5, _thresholds);
    NSMutableArray<NSString *> *issues = [NSMutableArray arrayWithCapacity:3];
    if (result.blurry) [issues addObject:@"BLURRY"];
    if (result.lowLight) [issues addObject:@"LOW_LIGHT"];
    if (result.tilted) [issues addObject:@"TILTED"];
    return @{@"ready": @(result.ready), @"issues": issues, @"progress": @(result.progress)};
  }
}

@end

#endif
