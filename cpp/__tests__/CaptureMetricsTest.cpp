#include "../CaptureMetrics.h"

#include <array>
#include <cassert>
#include <cmath>
#include <limits>
#include <vector>

using namespace parkingguide;

int main() {
  const CaptureThresholds thresholds{100, 50, std::acos(-1.0) / 9};
  std::array<uint8_t, 25> dark{};
  auto metrics = measureLuma(dark.data(), 5, 5, 5, false);
  assert(metrics.valid && metrics.meanLuminance == 0);
  assert(metrics.laplacianVariance == 0);
  auto result = assessCapture(metrics, 0, 0, true, thresholds);
  assert(result.blurry && result.lowLight && !result.tilted);
  assert(!result.ready && result.progress == 1.0 / 3);

  std::array<uint8_t, 25> bright;
  bright.fill(200);
  metrics = measureLuma(bright.data(), 5, 5, 5, false);
  assert(metrics.meanLuminance == 200 && metrics.laplacianVariance == 0);
  assert(!assessCapture(metrics, 0, 0, true, thresholds).lowLight);

  // Padding must not contribute to either image metric.
  const std::array<uint8_t, 15> padded{
      50, 50, 50, 255, 255, 50, 50, 50, 255, 255, 50, 50, 50, 255, 255};
  metrics = measureLuma(padded.data(), 3, 3, 5, false);
  assert(metrics.meanLuminance == 50 && metrics.laplacianVariance == 0);

  std::array<uint8_t, 25> checker;
  for (size_t i = 0; i < checker.size(); ++i) checker[i] = i % 2 ? 255 : 0;
  metrics = measureLuma(checker.data(), 5, 5, 5, false);
  assert(metrics.meanLuminance > 50 && metrics.laplacianVariance > 100);
  result = assessCapture(metrics, 0, 0, true, thresholds);
  assert(result.ready && result.progress == 1);

  // Video-range and full-range luma use the same [0, 255] scale.
  bright.fill(16);
  assert(measureLuma(bright.data(), 5, 5, 5, true).meanLuminance == 0);
  bright.fill(235);
  assert(measureLuma(bright.data(), 5, 5, 5, true).meanLuminance == 255);

  const ImageMetrics boundary{true, 50, 100};
  result = assessCapture(boundary, thresholds.maxTiltRadians,
                         -thresholds.maxTiltRadians, true, thresholds);
  assert(result.ready);
  for (double angle : {-0.5, 0.5}) {
    assert(assessCapture(boundary, angle, 0, true, thresholds).tilted);
    assert(assessCapture(boundary, 0, angle, true, thresholds).tilted);
  }
  result = assessCapture(boundary, 0, 0, false, thresholds);
  assert(!result.ready && !result.tilted && result.progress == 2.0 / 3);
  assert(!assessCapture(boundary, std::numeric_limits<double>::quiet_NaN(),
                        0, true, thresholds).ready);

  // Upright portrait, landscape, and upside-down poses have zero deviation.
  const double halfPi = std::acos(-1.0) / 2;
  for (const auto &gravity : {std::array<double, 3>{0, -1, 0},
                             std::array<double, 3>{1, 0, 0},
                             std::array<double, 3>{0, 1, 0}}) {
    auto tilt = tiltFromGravity(gravity[0], gravity[1], gravity[2]);
    assert(std::abs(tilt.pitch) < 1e-10 && std::abs(tilt.roll) < 1e-10);
  }
  assert(std::abs(tiltFromGravity(0, 0, -1).pitch - halfPi) < 1e-10);
  assert(std::abs(tiltFromGravity(0.5, -std::sqrt(0.75), 0).roll) > thresholds.maxTiltRadians);
  assert(std::abs(tiltFromGravity(0, -std::sqrt(0.75), 0.5).pitch) > thresholds.maxTiltRadians);

  assert(!measureLuma(nullptr, 5, 5, 5, false).valid);
  assert(!measureLuma(dark.data(), 2, 5, 5, false).valid);
  assert(!measureLuma(dark.data(), 5, 5, 4, false).valid);
  assert(!assessCapture({}, 0, 0, true, thresholds).ready);

  // Large frames are sampled on a bounded grid, including the last row/column.
  std::vector<uint8_t> large(1920 * 1080, 80);
  metrics = measureLuma(large.data(), 1920, 1080, 1920, false);
  assert(metrics.valid && metrics.meanLuminance == 80 && metrics.laplacianVariance == 0);
}
