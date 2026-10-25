#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

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

/// Releases the cached model and deletes its compiled copy.
- (void)reset;

@end

NS_ASSUME_NONNULL_END
