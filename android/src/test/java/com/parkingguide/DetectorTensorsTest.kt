package com.parkingguide

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
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

  @Test fun limitsOutputElementsToMaxDetections() {
    val max = DetectorTensors.MAX_DETECTIONS
    assertTrue(DetectorTensors.withinOutputLimit("boxes", 4 * max))
    assertFalse(DetectorTensors.withinOutputLimit("boxes", 4 * max + 1))
    assertTrue(DetectorTensors.withinOutputLimit("scores", max))
    assertFalse(DetectorTensors.withinOutputLimit("scores", max + 1))
    assertFalse(DetectorTensors.withinOutputLimit("classes", max + 1))
  }

  @Test fun readsExactBytesAroundChunkBoundaries() {
    val chunk = DetectorTensors.CHUNK_BYTES
    for (size in listOf(0, 1, chunk - 1, chunk, chunk + 1, 2 * chunk + 5)) {
      val data = pattern(size)
      val bytes = DetectorTensors.readAtMost(ByteArrayInputStream(data), size)!!
      assertEquals(size, bytes.size)
      // Two reads of the same bytes: one by single bytes, one with a buffer that crosses chunk boundaries.
      assertArrayEquals(data, readByBytes(bytes.inputStream()))
      assertArrayEquals(data, readByBuffer(bytes.inputStream(), 7))
    }
  }

  @Test fun readsAtMostTheLimit() {
    val chunk = DetectorTensors.CHUNK_BYTES
    for (size in listOf(1, chunk, chunk + 1)) {
      assertEquals(size, DetectorTensors.readAtMost(ByteArrayInputStream(pattern(size)), size)?.size)
      assertNull(DetectorTensors.readAtMost(ByteArrayInputStream(pattern(size + 1)), size))
    }
    assertNull(DetectorTensors.readAtMost(ByteArrayInputStream(byteArrayOf(1)), 0))
  }

  @Test fun stopsAnEndlessStreamOneBytePastTheLimit() {
    val chunk = DetectorTensors.CHUNK_BYTES
    for (max in listOf(1000, chunk, 2 * chunk + 5)) {
      val read = EndlessStream()
      assertNull(DetectorTensors.readAtMost(read, max))
      assertEquals(max + 1L, read.served)
      val copy = EndlessStream()
      assertFalse(DetectorTensors.copyAtMost(copy, ByteArrayOutputStream(), max.toLong()))
      assertEquals(max + 1L, copy.served)
    }
  }

  @Test fun supportsMarkResetAndSkip() {
    val data = pattern(DetectorTensors.CHUNK_BYTES + 10)
    val stream = DetectorTensors.readAtMost(ByteArrayInputStream(data), data.size)!!.inputStream()
    assertTrue(stream.markSupported())
    assertEquals(DetectorTensors.CHUNK_BYTES.toLong() - 2, stream.skip(DetectorTensors.CHUNK_BYTES.toLong() - 2))
    stream.mark(16)
    val first = readByBuffer(stream, 5)
    stream.reset()
    assertEquals(12, stream.available())
    assertArrayEquals(first, readByBuffer(stream, 3))
    assertArrayEquals(data.copyOfRange(DetectorTensors.CHUNK_BYTES - 2, data.size), first)
    assertEquals(0L, stream.skip(1))
    assertEquals(-1, stream.read())
  }

  @Test fun copiesExactBytesWithinTheLimit() {
    val chunk = DetectorTensors.CHUNK_BYTES
    for (size in listOf(0, 1, chunk - 1, chunk, chunk + 1, 2 * chunk + 5)) {
      val data = pattern(size)
      val out = ByteArrayOutputStream()
      assertTrue(DetectorTensors.copyAtMost(ByteArrayInputStream(data), out, size.toLong()))
      assertArrayEquals(data, out.toByteArray())
      val longer = ByteArrayInputStream(data + 0x7f.toByte())
      assertFalse(DetectorTensors.copyAtMost(longer, ByteArrayOutputStream(), size.toLong()))
    }
  }

  @Test fun samplesPhotosToTheDecodeBounds() {
    // Keeps at least 512 pixels on the short side.
    assertEquals(1, DetectorTensors.sampleSize(800, 600))
    assertEquals(4, DetectorTensors.sampleSize(4032, 3024))
    // Caps the long side at 4096, even below 512 on the short side.
    assertEquals(16, DetectorTensors.sampleSize(600, 60000))
    for ((width, height) in listOf(600 to 60000, 512 to 512, 9000 to 2000, 1 to 100000)) {
      val sample = DetectorTensors.sampleSize(width, height)
      assertTrue(maxOf(width, height) / sample <= DetectorTensors.MAX_DECODED_SIDE)
    }
  }

  /** [size] bytes that include values of 0x80 and above, so a sign error in a single-byte read shows. */
  private fun pattern(size: Int) = ByteArray(size) { (it * 31 + 0x80).toByte() }

  private fun readByBytes(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    while (true) out.write(input.read().takeIf { it >= 0 } ?: return out.toByteArray())
  }

  private fun readByBuffer(input: InputStream, bufferSize: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(bufferSize)
    while (true) {
      val count = input.read(buffer, 0, buffer.size)
      if (count < 0) return out.toByteArray()
      out.write(buffer, 0, count)
    }
  }

  /** Zero bytes without end, one byte per read; counts the bytes it served. */
  private class EndlessStream : InputStream() {
    var served = 0L
      private set

    override fun read(): Int {
      served++
      return 0
    }
  }
}
