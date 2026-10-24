#import "ParkingGuide.h"

@implementation ParkingGuide

- (NSString *)getModelVersion
{
  return @"0.1.0-dev";
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
