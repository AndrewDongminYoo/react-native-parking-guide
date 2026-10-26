package com.parkingguide

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

enum class InputLayout { NHWC, NCHW }

enum class ValueKind { FLOAT32, INT32, INT64 }

/** Pure tensor and input-limit helpers for [ParkingDetector]; same rules as `ios/ParkingGuideDetector.mm`. */
object DetectorTensors {
  const val INPUT_SIZE = 512
  val OUTPUT_NAMES = listOf("boxes", "scores", "classes")

  /** Maximum detection count N; `boxes` may hold 4 × N elements, `scores` and `classes` N each. */
  const val MAX_DETECTIONS = 1000

  /** Maximum bytes read from a `content://` model. */
  const val MAX_MODEL_BYTES = 256 * 1024 * 1024

  /** Maximum bytes read from a photo. */
  const val MAX_PHOTO_BYTES = 64 * 1024 * 1024

  /** Maximum long side of a decoded photo before the 512 × 512 stretch, as on iOS. */
  const val MAX_DECODED_SIDE = 4096

  /** Whether an output tensor named [name] with [count] elements is within [MAX_DETECTIONS]. */
  fun withinOutputLimit(name: String, count: Int): Boolean =
    count <= (if (name == "boxes") 4 * MAX_DETECTIONS else MAX_DETECTIONS)

  /** Reads [input] to the end, or returns null as soon as it has more than [maxBytes] bytes. */
  fun readAtMost(input: InputStream, maxBytes: Int): ByteArray? {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val count = input.read(buffer, 0, minOf(buffer.size, maxBytes + 1 - out.size()))
      if (count < 0) return out.toByteArray()
      out.write(buffer, 0, count)
      if (out.size() > maxBytes) return null
    }
  }

  /**
   * Power-of-two `inSampleSize` for a [width] × [height] photo: the largest that keeps at least [INPUT_SIZE] pixels on
   * the short side, then larger until the long side is at most [MAX_DECODED_SIDE].
   */
  fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    while (minOf(width, height) / (sample * 2) >= INPUT_SIZE) sample *= 2
    while (maxOf(width, height) / sample > MAX_DECODED_SIDE) sample *= 2
    return sample
  }

  /** [InputLayout.NHWC] for `[1, 512, 512, 3]`, [InputLayout.NCHW] for `[1, 3, 512, 512]`, otherwise null. */
  fun layoutOf(shape: IntArray): InputLayout? = when {
    shape.contentEquals(intArrayOf(1, INPUT_SIZE, INPUT_SIZE, 3)) -> InputLayout.NHWC
    shape.contentEquals(intArrayOf(1, 3, INPUT_SIZE, INPUT_SIZE)) -> InputLayout.NCHW
    else -> null
  }

  /** Writes 512 x 512 ARGB pixels to [out] as RGB values in `[0, 1]` in [layout] order, starting at index 0. */
  fun fillInput(argb: IntArray, layout: InputLayout, out: FloatBuffer) {
    val plane = INPUT_SIZE * INPUT_SIZE
    require(argb.size == plane) { "expected $plane pixels" }
    for (p in 0 until plane) {
      val pixel = argb[p]
      for (c in 0 until 3) {
        val value = ((pixel shr (16 - 8 * c)) and 0xff) / 255f
        out.put(if (layout == InputLayout.NHWC) p * 3 + c else c * plane + p, value)
      }
    }
  }

  /** Reads every value of a native-order output buffer of [kind] from position 0. */
  fun readValues(buffer: ByteBuffer, kind: ValueKind): DoubleArray {
    val data = buffer.duplicate().order(ByteOrder.nativeOrder())
    data.rewind()
    return when (kind) {
      ValueKind.FLOAT32 -> DoubleArray(data.remaining() / 4) { data.getFloat(it * 4).toDouble() }
      ValueKind.INT32 -> DoubleArray(data.remaining() / 4) { data.getInt(it * 4).toDouble() }
      ValueKind.INT64 -> DoubleArray(data.remaining() / 8) { data.getLong(it * 8).toDouble() }
    }
  }
}
