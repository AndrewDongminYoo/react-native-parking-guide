// macOS command-line harness for ios/ParkingGuideDetector.mm. CoreML, ImageIO, and Core Graphics behave the same
// on macOS, so this runs the iOS detector source against fixtures/detector without a simulator. See run.sh.
#import <Foundation/Foundation.h>

#import "ParkingGuideDetector.h"

int main(int argc, const char *argv[])
{
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "usage: %s <photo> <model>\n", argv[0]);
      return 2;
    }
    NSURL *photo = [NSURL fileURLWithPath:@(argv[1])];
    NSURL *model = [NSURL fileURLWithPath:@(argv[2])];
    ParkingGuideDetector *detector = [ParkingGuideDetector new];
    NSString *code = nil;
    NSString *message = nil;
    NSDictionary *output = [detector runWithPhotoURL:photo modelURL:model errorCode:&code message:&message];
    // A second run must reuse the cached model and return the same output.
    NSDictionary *again = [detector runWithPhotoURL:photo modelURL:model errorCode:&code message:&message];
    [detector reset];
    if (output == nil || ![output isEqual:again]) {
      printf("{\"error\":\"%s\"}\n", (code ?: @"MISMATCH").UTF8String);
      return 1;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:output options:NSJSONWritingSortedKeys error:nil];
    printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    return 0;
  }
}
