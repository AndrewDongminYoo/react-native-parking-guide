package com.parkingguide

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import org.junit.Assert.*
import org.junit.Test

class DetectorTensorsTest {
  private val size = DetectorTensors.INPUT_SIZE
  private val plane = size * size

  @Test fun detectsLayoutFromShape() {
    assertEquals(InputLayout.NHWC, DetectorTensors.layoutOf(intArrayOf(1, 512, 512, 3)))
    assertEquals(InputLayout.NCHW, DetectorTensors.layoutOf(intArrayOf(1, 3, 512, 512)))
    assertNull(DetectorTensors.layoutOf(intArrayOf(1, 640, 640, 3)))
    assertNull(DetectorTensors.layoutOf(intArrayOf(512, 512, 3)))
    assertNull(DetectorTensors.layoutOf(intArrayOf(1, 512, 512, 4)))
  }

  @Test fun fillsNhwcAndNchwInUnitRange() {
    // Pixel 0 is opaque RGB (255, 128, 0); pixel 1 is RGB (0, 0, 51); the rest are black.
    val pixels = IntArray(plane).also {
      it[0] = 0xffff8000.toInt()
      it[1] = 0xff000033.toInt()
    }
    val nhwc = FloatBuffer.allocate(plane * 3)
    DetectorTensors.fillInput(pixels, InputLayout.NHWC, nhwc)
    assertArrayEquals(floatArrayOf(1f, 128 / 255f, 0f, 0f, 0f, 0.2f), FloatArray(6) { nhwc.get(it) }, 1e-6f)

    val nchw = FloatBuffer.allocate(plane * 3)
    DetectorTensors.fillInput(pixels, InputLayout.NCHW, nchw)
    assertEquals(1f, nchw.get(0), 1e-6f)
    assertEquals(0f, nchw.get(1), 1e-6f)
    assertEquals(128 / 255f, nchw.get(plane), 1e-6f)
    assertEquals(0.2f, nchw.get(2 * plane + 1), 1e-6f)
  }

  @Test fun readsFloatIntAndLongOutputs() {
    val floats = ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).putFloat(0.5f).putFloat(0.25f)
    assertArrayEquals(doubleArrayOf(0.5, 0.25), DetectorTensors.readValues(floats, ValueKind.FLOAT32), 0.0)
    val ints = ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).putInt(3).putInt(7)
    assertArrayEquals(doubleArrayOf(3.0, 7.0), DetectorTensors.readValues(ints, ValueKind.INT32), 0.0)
    val longs = ByteBuffer.allocateDirect(16).order(ByteOrder.nativeOrder()).putLong(0).putLong(5)
    assertArrayEquals(doubleArrayOf(0.0, 5.0), DetectorTensors.readValues(longs, ValueKind.INT64), 0.0)
  }
}
