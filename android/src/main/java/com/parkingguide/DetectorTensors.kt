package com.parkingguide

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

enum class InputLayout { NHWC, NCHW }

enum class ValueKind { FLOAT32, INT32, INT64 }

/** Pure tensor helpers for [ParkingDetector]; same rules as `ios/ParkingGuideDetector.mm`. */
object DetectorTensors {
  const val INPUT_SIZE = 512
  val OUTPUT_NAMES = listOf("boxes", "scores", "classes")

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
