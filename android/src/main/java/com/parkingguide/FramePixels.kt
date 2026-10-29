package com.parkingguide

import java.nio.ByteBuffer

/** Pure conversion of a `YUV_420_888` camera frame to the upright 512 x 512 ARGB pixels [DetectorTensors] reads. */
object FramePixels {
  /** Size of the frame after rotating it clockwise by [rotationDegrees] (0, 90, 180, or 270). */
  fun uprightSize(
    width: Int,
    height: Int,
    rotationDegrees: Int,
  ): Pair<Int, Int> = if (quarterTurns(rotationDegrees) % 2 == 1) Pair(height, width) else Pair(width, height)

  /**
   * Returns 512 x 512 opaque ARGB pixels of the frame rotated clockwise by [rotationDegrees] (the CameraX
   * `ImageInfo.rotationDegrees` value), then mirrored horizontally when [mirrored], stretched without letterbox and
   * sampled nearest-neighbor. Converts with BT.601, full range or, when [videoRange], video range.
   */
  fun toArgb(
    y: ByteBuffer,
    u: ByteBuffer,
    v: ByteBuffer,
    width: Int,
    height: Int,
    yRowStride: Int,
    uvRowStride: Int,
    uvPixelStride: Int,
    rotationDegrees: Int,
    mirrored: Boolean,
    videoRange: Boolean,
  ): IntArray {
    val turns = quarterTurns(rotationDegrees)
    val (uprightWidth, uprightHeight) = uprightSize(width, height, rotationDegrees)
    val size = DetectorTensors.INPUT_SIZE
    val pixels = IntArray(size * size)
    for (outY in 0 until size) {
      val uprightY = (outY * 2 + 1) * uprightHeight / (size * 2)
      for (outX in 0 until size) {
        val sampledX = (outX * 2 + 1) * uprightWidth / (size * 2)
        val uprightX = if (mirrored) uprightWidth - 1 - sampledX else sampledX
        val sourceX: Int
        val sourceY: Int
        when (turns) {
          0 -> {
            sourceX = uprightX
            sourceY = uprightY
          }
          1 -> {
            sourceX = uprightY
            sourceY = height - 1 - uprightX
          }
          2 -> {
            sourceX = width - 1 - uprightX
            sourceY = height - 1 - uprightY
          }
          else -> {
            sourceX = width - 1 - uprightY
            sourceY = uprightX
          }
        }
        val luma = y.get(sourceY * yRowStride + sourceX).toInt() and 0xff
        val chromaIndex = (sourceY / 2) * uvRowStride + (sourceX / 2) * uvPixelStride
        val cb = (u.get(chromaIndex).toInt() and 0xff) - 128
        val cr = (v.get(chromaIndex).toInt() and 0xff) - 128
        pixels[outY * size + outX] = argb(luma, cb, cr, videoRange)
      }
    }
    return pixels
  }

  private fun quarterTurns(rotationDegrees: Int): Int {
    require(rotationDegrees in setOf(0, 90, 180, 270)) { "rotationDegrees must be 0, 90, 180, or 270." }
    return rotationDegrees / 90
  }

  private fun argb(
    luma: Int,
    cb: Int,
    cr: Int,
    videoRange: Boolean,
  ): Int {
    val r: Double
    val g: Double
    val b: Double
    if (videoRange) {
      val scaled = 1.164 * (luma - 16)
      r = scaled + 1.596 * cr
      g = scaled - 0.392 * cb - 0.813 * cr
      b = scaled + 2.017 * cb
    } else {
      r = luma + 1.402 * cr
      g = luma - 0.344136 * cb - 0.714136 * cr
      b = luma + 1.772 * cb
    }
    return (0xff shl 24) or (channel(r) shl 16) or (channel(g) shl 8) or channel(b)
  }

  private fun channel(value: Double): Int = Math.round(value).toInt().coerceIn(0, 255)
}
