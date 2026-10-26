#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

NS_ASSUME_NONNULL_BEGIN

/// Resolves a photo or model URI: an absolute path, or a `file:///` URI strictly percent-decoded as UTF-8. Same rule as
/// `FileSha256.resolve` on Android. Returns nil for any other form.
FOUNDATION_EXPORT NSURL *_Nullable ParkingGuideFileURL(NSString *uri);

/// The orientation that turns a VisionCamera frame upright. `frameOrientation` is the raw `UIImageOrientation` of
/// `Frame.orientation`, which VisionCamera defines as the frame's own orientation, the reverse of the upright transform
/// (its snapshot code applies `Orientation.portrait.relativeTo(frameOrientation)`), so Left and Right swap. Mirrored
/// `UIImageOrientation` values are read as their unmirrored base; `mirrored` selects the mirrored result.
FOUNDATION_EXPORT CGImagePropertyOrientation ParkingGuideUprightOrientation(NSInteger frameOrientation, BOOL mirrored);

/// Whether an output tensor named `name` with `count` elements holds at most 1000 detections (`boxes` 4 per detection).
/// Same rule as `DetectorTensors.withinOutputLimit` on Android.
FOUNDATION_EXPORT BOOL ParkingGuideWithinOutputLimit(NSString *name, NSInteger count);

/// Error codes shared with Android `ParkingDetector`.
extern NSString *const ParkingGuideDetectorErrorModelLoad;
extern NSString *const ParkingGuideDetectorErrorModelContract;
extern NSString *const ParkingGuideDetectorErrorPhotoRead;
extern NSString *const ParkingGuideDetectorErrorInference;

/// Runs a host-supplied CoreML detector on one photo, following the README "Detector model contract".
/// Not thread-safe: call every method from one serial queue.
@interface ParkingGuideDetector : NSObject

/// Returns `@{@"boxes", @"scores", @"classes"}`, each a flat `NSArray<NSNumber *>` in row-major order, or nil with
/// `errorCode` set to one of the error codes above and `message` set to a message without file paths.
/// `modelURL` is a `.mlmodelc` directory, or a `.mlmodel` or `.mlpackage` that is compiled once and cached.
- (nullable NSDictionary<NSString *, NSArray<NSNumber *> *> *)runWithPhotoURL:(NSURL *)photoURL
                                                                    modelURL:(NSURL *)modelURL
                                                                   errorCode:(NSString *_Nullable *_Nonnull)errorCode
                                                                     message:(NSString *_Nullable *_Nonnull)message;

/// Same as `runWithPhotoURL:` for one camera frame: `orientation` turns the buffer upright (use a mirrored value for
/// a mirrored frame). The result also has `frameWidth` and `frameHeight`, the upright frame size in pixels.
- (nullable NSDictionary<NSString *, id> *)runWithPixelBuffer:(CVPixelBufferRef)buffer
                                                  orientation:(CGImagePropertyOrientation)orientation
                                                     modelURL:(NSURL *)modelURL
                                                    errorCode:(NSString *_Nullable *_Nonnull)errorCode
                                                      message:(NSString *_Nullable *_Nonnull)message;

/// Releases the cached model and deletes its compiled copy.
- (void)reset;

/// The detector that `runDetector` and the `parkingDetector` frame processor share, so one model URI loads once.
+ (ParkingGuideDetector *)shared;

/// The serial queue for every call on `shared`.
+ (dispatch_queue_t)sharedQueue;

@end

NS_ASSUME_NONNULL_END
