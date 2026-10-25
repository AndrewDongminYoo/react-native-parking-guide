#import "ParkingGuideDetector.h"

#import <CoreGraphics/CoreGraphics.h>
#import <CoreML/CoreML.h>
#import <ImageIO/ImageIO.h>

#include <vector>

NSString *const ParkingGuideDetectorErrorModelLoad = @"E_MODEL_LOAD";
NSString *const ParkingGuideDetectorErrorModelContract = @"E_MODEL_CONTRACT";
NSString *const ParkingGuideDetectorErrorPhotoRead = @"E_PHOTO_READ";
NSString *const ParkingGuideDetectorErrorInference = @"E_INFERENCE";

static const NSInteger kInputSize = 512;
static NSArray<NSString *> *const kOutputNames = @[ @"boxes", @"scores", @"classes" ];

@implementation ParkingGuideDetector {
  NSURL *_modelURL;
  MLModel *_model;
  NSURL *_compiledURL;
}

- (void)reset
{
  _model = nil;
  _modelURL = nil;
  if (_compiledURL != nil) {
    [[NSFileManager defaultManager] removeItemAtURL:_compiledURL error:nil];
    _compiledURL = nil;
  }
}

- (void)dealloc
{
  [self reset];
}

- (MLModel *)loadModel:(NSURL *)modelURL
{
  if (_model != nil && [_modelURL isEqual:modelURL]) {
    return _model;
  }
  [self reset];
  NSURL *loadURL = modelURL;
  NSString *extension = modelURL.pathExtension.lowercaseString;
  if ([extension isEqualToString:@"mlmodel"] || [extension isEqualToString:@"mlpackage"]) {
    loadURL = [MLModel compileModelAtURL:modelURL error:nil];
    if (loadURL == nil) {
      return nil;
    }
    _compiledURL = loadURL;
  } else if (![extension isEqualToString:@"mlmodelc"]) {
    return nil;
  }
  MLModel *model = [MLModel modelWithContentsOfURL:loadURL error:nil];
  if (model == nil) {
    [self reset];
    return nil;
  }
  _model = model;
  _modelURL = modelURL;
  return model;
}

/// Returns YES for NHWC ([1, 512, 512, 3]), NO for NCHW ([1, 3, 512, 512]); sets `valid` to NO for any other shape.
static BOOL ParkingGuideIsNHWC(NSArray<NSNumber *> *shape, BOOL *valid)
{
  NSArray<NSNumber *> *nhwc = @[ @1, @(kInputSize), @(kInputSize), @3 ];
  NSArray<NSNumber *> *nchw = @[ @1, @3, @(kInputSize), @(kInputSize) ];
  *valid = [shape isEqualToArray:nhwc] || [shape isEqualToArray:nchw];
  return [shape isEqualToArray:nhwc];
}

/// Decodes the photo, applies its EXIF orientation, and stretches it to 512 x 512 RGB. Returns NO on failure.
static BOOL ParkingGuideReadPixels(NSURL *photoURL, std::vector<uint8_t> &rgbx)
{
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)photoURL, NULL);
  if (source == NULL) {
    return NO;
  }
  NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
  double width = [properties[(NSString *)kCGImagePropertyPixelWidth] doubleValue];
  double height = [properties[(NSString *)kCGImagePropertyPixelHeight] doubleValue];
  if (width <= 0 || height <= 0) {
    CFRelease(source);
    return NO;
  }
  // Keep at least 512 pixels on the short side before the stretch, capped at 4096 on the long side.
  double maxPixelSize = MIN(4096.0, ceil(kInputSize * MAX(width, height) / MIN(width, height)));
  NSDictionary *options = @{
    (NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (NSString *)kCGImageSourceThumbnailMaxPixelSize : @(maxPixelSize),
  };
  CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (image == NULL) {
    return NO;
  }
  rgbx.assign(kInputSize * kInputSize * 4, 0);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(rgbx.data(), kInputSize, kInputSize, 8, kInputSize * 4, colorSpace,
                                               kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(colorSpace);
  if (context == NULL) {
    CGImageRelease(image);
    return NO;
  }
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  CGContextDrawImage(context, CGRectMake(0, 0, kInputSize, kInputSize), image);
  CGContextRelease(context);
  CGImageRelease(image);
  return YES;
}

static NSArray<NSNumber *> *ParkingGuideFlatten(MLMultiArray *array)
{
  NSMutableArray<NSNumber *> *values = [NSMutableArray arrayWithCapacity:array.count];
  for (NSInteger i = 0; i < array.count; i++) {
    [values addObject:@([array[i] doubleValue])];
  }
  return values;
}

- (NSDictionary<NSString *, NSArray<NSNumber *> *> *)runWithPhotoURL:(NSURL *)photoURL
                                                           modelURL:(NSURL *)modelURL
                                                          errorCode:(NSString **)errorCode
                                                            message:(NSString **)message
{
  MLModel *model = [self loadModel:modelURL];
  if (model == nil) {
    *errorCode = ParkingGuideDetectorErrorModelLoad;
    *message = @"Could not load the CoreML model.";
    return nil;
  }

  NSDictionary<NSString *, MLFeatureDescription *> *inputs = model.modelDescription.inputDescriptionsByName;
  MLFeatureDescription *input = inputs.allValues.firstObject;
  MLMultiArrayConstraint *constraint = input.multiArrayConstraint;
  BOOL validShape = NO;
  BOOL nhwc = constraint != nil ? ParkingGuideIsNHWC(constraint.shape, &validShape) : NO;
  NSDictionary<NSString *, MLFeatureDescription *> *outputs = model.modelDescription.outputDescriptionsByName;
  BOOL hasOutputs = YES;
  for (NSString *name in kOutputNames) {
    hasOutputs = hasOutputs && outputs[name].type == MLFeatureTypeMultiArray;
  }
  if (inputs.count != 1 || input.type != MLFeatureTypeMultiArray ||
      constraint.dataType != MLMultiArrayDataTypeFloat32 || !validShape || !hasOutputs) {
    *errorCode = ParkingGuideDetectorErrorModelContract;
    *message = @"The model must have one float32 input of shape [1, 512, 512, 3] or [1, 3, 512, 512] and "
               @"multi-array outputs named boxes, scores, and classes.";
    return nil;
  }

  std::vector<uint8_t> rgbx;
  if (!ParkingGuideReadPixels(photoURL, rgbx)) {
    *errorCode = ParkingGuideDetectorErrorPhotoRead;
    *message = @"Could not read the photo file.";
    return nil;
  }

  const NSInteger plane = kInputSize * kInputSize;
  NSMutableData *tensor = [NSMutableData dataWithLength:plane * 3 * sizeof(float)];
  float *values = (float *)tensor.mutableBytes;
  for (NSInteger p = 0; p < plane; p++) {
    for (NSInteger c = 0; c < 3; c++) {
      float value = rgbx[p * 4 + c] / 255.0f;
      values[nhwc ? p * 3 + c : c * plane + p] = value;
    }
  }
  NSArray<NSNumber *> *strides = nhwc ? @[ @(plane * 3), @(kInputSize * 3), @3, @1 ]
                                      : @[ @(plane * 3), @(plane), @(kInputSize), @1 ];
  NSError *error = nil;
  MLMultiArray *array = [[MLMultiArray alloc] initWithDataPointer:values
                                                            shape:constraint.shape
                                                         dataType:MLMultiArrayDataTypeFloat32
                                                          strides:strides
                                                      deallocator:^(void *bytes) {
                                                        // `tensor` owns the bytes; capturing it keeps them alive.
                                                        (void)tensor;
                                                      }
                                                            error:&error];
  MLDictionaryFeatureProvider *provider =
      array == nil ? nil
                   : [[MLDictionaryFeatureProvider alloc]
                         initWithDictionary:@{input.name : [MLFeatureValue featureValueWithMultiArray:array]}
                                      error:&error];
  id<MLFeatureProvider> result = provider == nil ? nil : [model predictionFromFeatures:provider error:&error];
  if (result == nil) {
    *errorCode = ParkingGuideDetectorErrorInference;
    *message = @"The CoreML prediction failed.";
    return nil;
  }

  NSMutableDictionary<NSString *, NSArray<NSNumber *> *> *output = [NSMutableDictionary dictionary];
  for (NSString *name in kOutputNames) {
    MLMultiArray *value = [result featureValueForName:name].multiArrayValue;
    if (value == nil) {
      *errorCode = ParkingGuideDetectorErrorInference;
      *message = @"The CoreML prediction returned no multi-array for boxes, scores, or classes.";
      return nil;
    }
    output[name] = ParkingGuideFlatten(value);
  }
  return output;
}

@end
