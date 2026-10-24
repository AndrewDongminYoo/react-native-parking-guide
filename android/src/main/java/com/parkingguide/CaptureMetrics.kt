package com.parkingguide

import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.min

internal data class ImageMetrics(
  val valid: Boolean = false,
  val meanLuminance: Double = 0.0,
  val laplacianVariance: Double = 0.0
)

internal data class CaptureThresholds(
  val minLaplacianVariance: Double,
  val minMeanLuminance: Double,
  val maxTiltRadians: Double
) {
  companion object {
    fun from(options: Map<String, Any>?): CaptureThresholds {
      fun threshold(key: String): Double {
        val value = (options?.get(key) as? Number)?.toDouble()
        require(value != null && value.isFinite() && value > 0) {
          "parkingGuide requires a positive finite $key threshold."
        }
        return value
      }
      return CaptureThresholds(
        threshold("minLaplacianVariance"),
        threshold("minMeanLuminance"),
        threshold("maxTiltRadians")
      )
    }
  }
}

internal data class CaptureTilt(val pitch: Double, val roll: Double)

internal object CaptureMetrics {
  fun freshTilt(tilt: CaptureTilt?, timestamp: Long, now: Long): CaptureTilt? =
    if (timestamp > 0 && now - timestamp in 0..500_000_000L) tilt else null

  fun tiltFromGravity(x: Double, y: Double, z: Double) = CaptureTilt(
    atan2(-z, hypot(x, y)),
    Math.IEEEremainder(atan2(x, -y), Math.PI / 2)
  )

  fun measureLuma(
    data: ByteBuffer,
    width: Int,
    height: Int,
    rowStride: Int,
    pixelStride: Int,
    videoRange: Boolean
  ): ImageMetrics {
    if (width < 3 || height < 3 || pixelStride < 1 ||
      rowStride < (width - 1L) * pixelStride + 1) return ImageMetrics()
    val offset = data.position()
    val last = offset.toLong() + (height - 1L) * rowStride + (width - 1L) * pixelStride
    if (last >= data.limit()) return ImageMetrics()

    val columns = min(width, 160)
    val rows = min(height, 120)
    val luma = DoubleArray(columns * rows)
    var sum = 0.0
    for (y in 0 until rows) {
      val row = offset + (y.toLong() * (height - 1) / (rows - 1)).toInt() * rowStride
      for (x in 0 until columns) {
        val column = (x.toLong() * (width - 1) / (columns - 1)).toInt() * pixelStride
        var value = (data.get(row + column).toInt() and 0xff).toDouble()
        if (videoRange) value = ((value - 16) * 255 / 219).coerceIn(0.0, 255.0)
        luma[y * columns + x] = value
        sum += value
      }
    }
    var mean = 0.0
    var squaredDeviations = 0.0
    var count = 0
    for (y in 1 until rows - 1) {
      for (x in 1 until columns - 1) {
        val i = y * columns + x
        val laplacian = luma[i - 1] + luma[i + 1] +
          luma[i - columns] + luma[i + columns] - 4 * luma[i]
        val delta = laplacian - mean
        count++
        mean += delta / count
        squaredDeviations += delta * (laplacian - mean)
      }
    }
    return ImageMetrics(true, sum / luma.size, squaredDeviations / count)
  }

  fun assess(
    metrics: ImageMetrics,
    tilt: CaptureTilt?,
    thresholds: CaptureThresholds
  ): Map<String, Any> {
    if (!metrics.valid) return mapOf("ready" to false, "issues" to emptyList<String>(), "progress" to 0.0)
    val motionAvailable = tilt != null && tilt.pitch.isFinite() && tilt.roll.isFinite()
    val blurry = metrics.laplacianVariance < thresholds.minLaplacianVariance
    val lowLight = metrics.meanLuminance < thresholds.minMeanLuminance
    val tilted = motionAvailable &&
      (abs(tilt.pitch) > thresholds.maxTiltRadians || abs(tilt.roll) > thresholds.maxTiltRadians)
    val issues = mutableListOf<String>()
    if (blurry) issues.add("BLURRY")
    if (lowLight) issues.add("LOW_LIGHT")
    if (tilted) issues.add("TILTED")
    val passed = (if (!blurry) 1 else 0) + (if (!lowLight) 1 else 0) +
      (if (motionAvailable && !tilted) 1 else 0)
    return mapOf("ready" to (passed == 3), "issues" to issues, "progress" to passed / 3.0)
  }
}
