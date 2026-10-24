package com.parkingguide

import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.*
import org.junit.Test

class CaptureMetricsTest {
  private val thresholds = CaptureThresholds(100.0, 50.0, PI / 9)
  private val upright = CaptureTilt(0.0, 0.0)

  private fun measure(width: Int = 8, height: Int = 8, value: (Int, Int) -> Int): ImageMetrics {
    val data = ByteBuffer.allocate(width * height)
    for (y in 0 until height) for (x in 0 until width) data.put(value(x, y).toByte())
    data.flip()
    return CaptureMetrics.measureLuma(data, width, height, width, 1, false)
  }

  @Test fun flatAndTexturedImages() {
    val flat = measure { _, _ -> 128 }
    assertEquals(128.0, flat.meanLuminance, 0.0)
    assertEquals(0.0, flat.laplacianVariance, 0.0)
    assertEquals(listOf("BLURRY"), CaptureMetrics.assess(flat, upright, thresholds)["issues"])
    val textured = measure { x, y -> if ((x + y) % 2 == 0) 0 else 255 }
    assertEquals(127.5, textured.meanLuminance, 0.0)
    assertEquals(1040400.0, textured.laplacianVariance, 0.0)
    assertEquals(true, CaptureMetrics.assess(textured, upright, thresholds)["ready"])
  }

  @Test fun respectsStridesBufferPositionAndVideoRange() {
    val data = ByteBuffer.allocate(34)
    data.position(2)
    for (y in 0..2) for (x in 0..2) data.put(2 + y * 12 + x * 2, 235.toByte())
    val metrics = CaptureMetrics.measureLuma(data, 3, 3, 12, 2, true)
    assertEquals(255.0, metrics.meanLuminance, 0.0)
    assertEquals(0.0, metrics.laplacianVariance, 0.0)
    assertEquals(2, data.position())
    for (y in 0..2) for (x in 0..2) data.put(2 + y * 12 + x * 2, 16.toByte())
    assertEquals(0.0, CaptureMetrics.measureLuma(data, 3, 3, 12, 2, true).meanLuminance, 0.0)
  }

  @Test fun samplesEntirePlaneOnBoundedGrid() {
    // A linear ramp remains linear after the same nearest-neighbor sampling as iOS.
    val metrics = measure(319, 239) { x, _ -> x / 2 }
    assertEquals(79.5, metrics.meanLuminance, 0.0)
    assertEquals(0.0, metrics.laplacianVariance, 0.0)
  }

  @Test fun rejectsInvalidPlanesWithoutReadingBuffer() {
    val data = ByteBuffer.allocate(8)
    for (metrics in listOf(
      CaptureMetrics.measureLuma(data, 2, 3, 3, 1, false),
      CaptureMetrics.measureLuma(data, 3, 3, 3, 1, false),
      CaptureMetrics.measureLuma(data, 3, 3, 2, 1, false),
      CaptureMetrics.measureLuma(data, 3, 3, 3, 0, false),
      CaptureMetrics.measureLuma(data, Int.MAX_VALUE, Int.MAX_VALUE, Int.MAX_VALUE, 2, false)
    )) {
      assertFalse(metrics.valid)
      assertEquals(
        mapOf("ready" to false, "issues" to emptyList<String>(), "progress" to 0.0),
        CaptureMetrics.assess(metrics, upright, thresholds)
      )
    }
  }

  @Test fun thresholdsUseStrictComparisons() {
    val boundary = ImageMetrics(true, 50.0, 100.0)
    assertEquals(true, CaptureMetrics.assess(boundary, CaptureTilt(PI / 9, -PI / 9), thresholds)["ready"])
    assertEquals(
      listOf("BLURRY", "LOW_LIGHT", "TILTED"),
      CaptureMetrics.assess(
        ImageMetrics(true, 49.999, 99.999), CaptureTilt(PI / 9 + 0.001, 0.0), thresholds
      )["issues"]
    )
    assertEquals(
      listOf("TILTED"),
      CaptureMetrics.assess(boundary, CaptureTilt(0.0, -PI / 9 - 0.001), thresholds)["issues"]
    )
  }

  @Test fun missingOrNonfiniteMotionNeverReportsReadyOrTilted() {
    for (tilt in listOf(null, CaptureTilt(Double.NaN, 0.0), CaptureTilt(0.0, Double.POSITIVE_INFINITY))) {
      val result = CaptureMetrics.assess(ImageMetrics(true, 100.0, 200.0), tilt, thresholds)
      assertEquals(false, result["ready"])
      assertEquals(emptyList<String>(), result["issues"])
      assertEquals(2.0 / 3, result["progress"])
    }
    assertEquals(0.0, CaptureMetrics.assess(ImageMetrics(true, 0.0, 0.0), null, thresholds)["progress"])
    assertEquals(1.0 / 3, CaptureMetrics.assess(ImageMetrics(true, 0.0, 0.0), upright, thresholds)["progress"])
  }

  @Test fun motionFreshnessMatchesIOSHalfSecondWindow() {
    assertNull(CaptureMetrics.freshTilt(upright, 0, 1))
    assertNull(CaptureMetrics.freshTilt(upright, 2, 1))
    assertSame(upright, CaptureMetrics.freshTilt(upright, 1, 1))
    assertSame(upright, CaptureMetrics.freshTilt(upright, 1, 500_000_001))
    assertNull(CaptureMetrics.freshTilt(upright, 1, 500_000_002))
    assertNull(CaptureMetrics.freshTilt(null, 1, 2))
  }

  @Test fun gravityAllowsPortraitLandscapeAndInvertedPosesButNotFlat() {
    for ((x, y) in listOf(0.0 to -1.0, 1.0 to 0.0, 0.0 to 1.0, -1.0 to 0.0)) {
      val tilt = CaptureMetrics.tiltFromGravity(x, y, 0.0)
      assertEquals(0.0, tilt.pitch, 1e-12)
      assertEquals(0.0, tilt.roll, 1e-12)
    }
    val flat = CaptureMetrics.tiltFromGravity(0.0, 0.0, 1.0)
    assertEquals(-PI / 2, flat.pitch, 1e-12)
    val lean = CaptureMetrics.tiltFromGravity(0.0, -cos(PI / 6), sin(PI / 6))
    assertEquals(-PI / 6, lean.pitch, 1e-12)
    val roll = CaptureMetrics.tiltFromGravity(sin(PI / 6), -cos(PI / 6), 0.0)
    assertEquals(PI / 6, roll.roll, 1e-12)
  }

  @Test fun rejectsInvalidInitializationThresholds() {
    val options = mapOf<String, Any>(
      "minLaplacianVariance" to 100.0, "minMeanLuminance" to 50.0, "maxTiltRadians" to PI / 9
    )
    assertEquals(thresholds, CaptureThresholds.from(options))
    for (value in listOf(0, -1, Double.NaN, Double.POSITIVE_INFINITY, "100")) {
      assertThrows(IllegalArgumentException::class.java) {
        CaptureThresholds.from(options + ("minMeanLuminance" to value))
      }
    }
    assertThrows(IllegalArgumentException::class.java) { CaptureThresholds.from(null) }
  }
}
