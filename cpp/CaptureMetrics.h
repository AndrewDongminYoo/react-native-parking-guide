#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace parkingguide {

struct ImageMetrics {
  bool valid = false;
  double meanLuminance = 0;
  double laplacianVariance = 0;
};

struct CaptureThresholds {
  double minLaplacianVariance;
  double minMeanLuminance;
  double maxTiltRadians;
};

struct CaptureAssessment {
  bool blurry = false;
  bool lowLight = false;
  bool tilted = false;
  bool ready = false;
  double progress = 0;
};

struct Tilt {
  double pitch;
  double roll;
};

inline Tilt tiltFromGravity(double x, double y, double z) {
  // Deviation from an upright phone, allowing portrait and landscape capture.
  return {std::atan2(-z, std::hypot(x, y)),
          std::remainder(std::atan2(x, -y), std::acos(-1.0) / 2)};
}

inline ImageMetrics measureLuma(const uint8_t *data, size_t width,
                                size_t height, size_t bytesPerRow,
                                bool videoRange) {
  if (!data || width < 3 || height < 3 || bytesPerRow < width) return {};

  constexpr size_t maxWidth = 160;
  constexpr size_t maxHeight = 120;
  std::array<double, maxWidth * maxHeight> luma;
  const size_t columns = std::min(width, maxWidth);
  const size_t rows = std::min(height, maxHeight);
  double sum = 0;
  for (size_t y = 0; y < rows; ++y) {
    const auto *row = data + (y * (height - 1) / (rows - 1)) * bytesPerRow;
    for (size_t x = 0; x < columns; ++x) {
      double value = row[x * (width - 1) / (columns - 1)];
      if (videoRange) value = std::clamp((value - 16) * 255 / 219, 0.0, 255.0);
      luma[y * columns + x] = value;
      sum += value;
    }
  }

  double mean = 0;
  double squaredDeviations = 0;
  size_t count = 0;
  for (size_t y = 1; y + 1 < rows; ++y) {
    for (size_t x = 1; x + 1 < columns; ++x) {
      const size_t i = y * columns + x;
      const double laplacian = luma[i - 1] + luma[i + 1] +
          luma[i - columns] + luma[i + columns] - 4 * luma[i];
      const double delta = laplacian - mean;
      mean += delta / ++count;
      squaredDeviations += delta * (laplacian - mean);
    }
  }
  return {true, sum / (rows * columns), squaredDeviations / count};
}

inline CaptureAssessment assessCapture(const ImageMetrics &metrics,
                                        double pitch, double roll,
                                        bool motionAvailable,
                                        const CaptureThresholds &thresholds) {
  if (!metrics.valid) return {};
  motionAvailable = motionAvailable && std::isfinite(pitch) && std::isfinite(roll);
  CaptureAssessment result;
  result.blurry = metrics.laplacianVariance < thresholds.minLaplacianVariance;
  result.lowLight = metrics.meanLuminance < thresholds.minMeanLuminance;
  result.tilted = motionAvailable &&
      (std::abs(pitch) > thresholds.maxTiltRadians ||
       std::abs(roll) > thresholds.maxTiltRadians);
  const int passed = !result.blurry + !result.lowLight +
      (motionAvailable && !result.tilted);
  result.ready = passed == 3;
  result.progress = passed / 3.0;
  return result;
}

} // namespace parkingguide
