package com.parkingguide

import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class FramePixelsTest {
  private val size = DetectorTensors.INPUT_SIZE

  /** Packed planes: Y is width x height, U and V are (width / 2) x (height / 2) with pixel stride 1. */
  private class Planes(val y: ByteBuffer, val u: ByteBuffer, val v: ByteBuffer, val yRowStride: Int, val uvRowStride: Int, val uvPixelStride: Int)

  private fun packed(width: Int, height: Int, luma: (Int, Int) -> Int, chroma: Int = 128): Planes {
    val y = ByteArray(width * height) { luma(it % width, it / width).toByte() }
    val uv = ByteArray((width / 2) * (height / 2)) { chroma.toByte() }
    return Planes(ByteBuffer.wrap(y), ByteBuffer.wrap(uv.copyOf()), ByteBuffer.wrap(uv.copyOf()), width, width / 2, 1)
  }

  private fun convert(p: Planes, width: Int, height: Int, rotation: Int, mirrored: Boolean = false, videoRange: Boolean = false) =
    FramePixels.toArgb(p.y, p.u, p.v, width, height, p.yRowStride, p.uvRowStride, p.uvPixelStride, rotation, mirrored, videoRange)

  private fun at(pixels: IntArray, x: Int, y: Int) = pixels[y * size + x]

  // Left half white (Y = 255), right half black (Y = 0), full-range neutral chroma.
  private val halves = packed(4, 2, { x, _ -> if (x < 2) 255 else 0 })
  private val white = 0xffffffff.toInt()
  private val black = 0xff000000.toInt()

  @Test fun uprightSizeSwapsForQuarterTurns() {
    assertEquals(Pair(480, 640), FramePixels.uprightSize(640, 480, 90))
    assertEquals(Pair(480, 640), FramePixels.uprightSize(640, 480, 270))
    assertEquals(Pair(640, 480), FramePixels.uprightSize(640, 480, 180))
    assertEquals(Pair(640, 480), FramePixels.uprightSize(640, 480, 0))
  }

  @Test fun convertsNeutralGray() {
    val pixels = convert(packed(4, 2, { _, _ -> 128 }), 4, 2, 0)
    assertEquals(size * size, pixels.size)
    for (pixel in listOf(pixels.first(), pixels.last())) {
      assertEquals(0xff, pixel ushr 24)
      for (shift in listOf(16, 8, 0)) assertEquals(128.0, ((pixel shr shift) and 0xff).toDouble(), 1.0)
    }
  }

  @Test fun appliesEachRotation() {
    convert(halves, 4, 2, 0).let {
      assertEquals(white, at(it, 0, 0))
      assertEquals(black, at(it, size - 1, 0))
    }
    convert(halves, 4, 2, 90).let {
      assertEquals(white, at(it, 0, 0))
      assertEquals(black, at(it, 0, size - 1))
    }
    convert(halves, 4, 2, 180).let {
      assertEquals(black, at(it, 0, 0))
      assertEquals(white, at(it, size - 1, 0))
    }
    convert(halves, 4, 2, 270).let {
      assertEquals(black, at(it, 0, 0))
      assertEquals(white, at(it, 0, size - 1))
    }
  }

  @Test fun mirrorsAfterRotation() {
    convert(halves, 4, 2, 0, mirrored = true).let {
      assertEquals(black, at(it, 0, 0))
      assertEquals(white, at(it, size - 1, 0))
    }
  }

  @Test fun honorsRowPaddingAndInterleavedChroma() {
    // Same left-white/right-black image with 3 padding bytes per Y row and interleaved chroma (pixel stride 2).
    val yRowStride = 7
    val y = ByteArray(yRowStride * 2) { i -> if (i % yRowStride < 2) 255.toByte() else 0 }
    val uv = ByteArray(8) { 128.toByte() }
    val padded = Planes(ByteBuffer.wrap(y), ByteBuffer.wrap(uv), ByteBuffer.wrap(uv.copyOfRange(1, 8)), yRowStride, 4, 2)
    assertArrayEquals(convert(halves, 4, 2, 90), convert(padded, 4, 2, 90))
  }

  @Test fun convertsVideoRange() {
    val pixels = convert(packed(4, 2, { _, _ -> 16 }), 4, 2, 0, videoRange = true)
    assertEquals(black, pixels[0])
    val bright = convert(packed(4, 2, { _, _ -> 235 }), 4, 2, 0, videoRange = true)
    assertEquals(white, bright[0])
  }

  @Test fun rejectsOtherRotations() {
    assertThrows(IllegalArgumentException::class.java) { convert(halves, 4, 2, 45) }
  }
}
