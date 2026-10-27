require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ParkingGuide"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/AndrewDongminYoo/react-native-parking-guide.git", :tag => "v#{s.version}" }

  s.source_files = ["ios/**/*.{h,m,mm,swift,cpp}", "cpp/**/*.h"]
  s.private_header_files = ["ios/**/*.h", "cpp/**/*.h"]

  # Resolve optional camera dependencies from the consuming app, not this package.
  app_path = Pod::Config.instance.installation_root.to_s
  has_camera_worklets = system("node", "-e",
    "for (const name of ['react-native-vision-camera', 'react-native-worklets-core']) require.resolve(name + '/package.json', { paths: [process.argv[1]] })",
    app_path, :out => File::NULL, :err => File::NULL)
  if has_camera_worklets && (!defined?($VCEnableFrameProcessors) || $VCEnableFrameProcessors)
    s.dependency "VisionCamera/FrameProcessors", "~> 4.7"
    s.frameworks = "CoreML", "CoreImage", "ImageIO", "CoreGraphics", "DeviceCheck", "Security", "CoreMotion", "CoreVideo", "QuartzCore"
  else
    s.frameworks = "CoreML", "CoreImage", "ImageIO", "CoreGraphics", "DeviceCheck", "Security"
    s.exclude_files = ["ios/ParkingGuideFrameProcessor.mm", "ios/ParkingGuideDetectorFrameProcessor.mm"]
  end

  install_modules_dependencies(s)
end
