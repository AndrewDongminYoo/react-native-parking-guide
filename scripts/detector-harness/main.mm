// macOS command-line harness for ios/ParkingGuideDetector.mm. CoreML, Core Image, ImageIO, and Core Graphics behave
// the same on macOS, so this runs the iOS detector source against fixtures/detector without a simulator. See run.sh.
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <algorithm>

#import "ParkingGuideDetector.h"

/// A 640 x 480 full-range 4:2:0 bi-planar buffer of one RGB color, converted with BT.601.
static CVPixelBufferRef ParkingGuideSolidPixelBuffer(int r, int g, int b)
{
  const size_t width = 640;
  const size_t height = 480;
  CVPixelBufferRef buffer = NULL;
  NSDictionary *attributes = @{(NSString *)kCVPixelBufferIOSurfacePropertiesKey : @{}};
  if (CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                          (__bridge CFDictionaryRef)attributes, &buffer) != kCVReturnSuccess) {
    return NULL;
  }
  auto clamp = [](double value) { return (uint8_t)std::clamp((int)lround(value), 0, 255); };
  const uint8_t y = clamp(0.299 * r + 0.587 * g + 0.114 * b);
  const uint8_t cb = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
  const uint8_t cr = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  CVPixelBufferLockBaseAddress(buffer, 0);
  uint8_t *luma = (uint8_t *)CVPixelBufferGetBaseAddressOfPlane(buffer, 0);
  for (size_t row = 0; row < height; row++) {
    memset(luma + row * CVPixelBufferGetBytesPerRowOfPlane(buffer, 0), y, width);
  }
  uint8_t *chroma = (uint8_t *)CVPixelBufferGetBaseAddressOfPlane(buffer, 1);
  for (size_t row = 0; row < height / 2; row++) {
    uint8_t *line = chroma + row * CVPixelBufferGetBytesPerRowOfPlane(buffer, 1);
    for (size_t col = 0; col < width / 2; col++) {
      line[col * 2] = cb;
      line[col * 2 + 1] = cr;
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, 0);
  return buffer;
}

static int ParkingGuidePrint(NSDictionary *output, NSString *code)
{
  if (output == nil) {
    printf("{\"error\":\"%s\"}\n", (code ?: @"MISMATCH").UTF8String);
    return 1;
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:output options:NSJSONWritingSortedKeys error:nil];
  printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  return 0;
}

int main(int argc, const char *argv[])
{
  @autoreleasepool {
    ParkingGuideDetector *detector = [ParkingGuideDetector new];
    NSString *code = nil;
    NSString *message = nil;
    if (argc == 7 && strcmp(argv[1], "--pixel-buffer") == 0) {
      CVPixelBufferRef buffer = ParkingGuideSolidPixelBuffer(atoi(argv[2]), atoi(argv[3]), atoi(argv[4]));
      NSURL *model = [NSURL fileURLWithPath:@(argv[6])];
      NSDictionary *output = buffer == NULL ? nil
                                            : [detector runWithPixelBuffer:buffer
                                                               orientation:(CGImagePropertyOrientation)atoi(argv[5])
                                                                  modelURL:model
                                                                 errorCode:&code
                                                                   message:&message];
      if (buffer != NULL) {
        CVPixelBufferRelease(buffer);
      }
      [detector reset];
      return ParkingGuidePrint(output, code);
    }
    if (argc != 3) {
      fprintf(stderr, "usage: %s <photo> <model> | --pixel-buffer <r> <g> <b> <orientation> <model>\n", argv[0]);
      return 2;
    }
    NSURL *photo = [NSURL fileURLWithPath:@(argv[1])];
    NSURL *model = [NSURL fileURLWithPath:@(argv[2])];
    NSDictionary *output = [detector runWithPhotoURL:photo modelURL:model errorCode:&code message:&message];
    // A second run must reuse the cached model and return the same output.
    NSDictionary *again = [detector runWithPhotoURL:photo modelURL:model errorCode:&code message:&message];
    [detector reset];
    return ParkingGuidePrint(output != nil && [output isEqual:again] ? output : nil, code);
  }
}
