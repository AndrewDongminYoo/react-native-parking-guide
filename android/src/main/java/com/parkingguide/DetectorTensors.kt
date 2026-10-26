package com.parkingguide

import java.io.InputStream
import java.io.OutputStream
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

  /** Buffer and chunk size for [readAtMost] and [copyAtMost]. */
  const val CHUNK_BYTES = 64 * 1024

  /**
   * Reads [input] to the end into [CHUNK_BYTES] chunks, or returns null as soon as it has more than [maxBytes] bytes.
   * Reads at most [maxBytes] + 1 bytes, and never copies the bytes it has read.
   */
  fun readAtMost(input: InputStream, maxBytes: Int): ChunkedBytes? {
    val chunks = mutableListOf<ByteArray>()
    var total = 0L
    var filled = CHUNK_BYTES
    while (true) {
      if (filled == CHUNK_BYTES) {
        chunks.add(ByteArray(CHUNK_BYTES))
        filled = 0
      }
      val request = minOf((CHUNK_BYTES - filled).toLong(), maxBytes + 1 - total).toInt()
      val count = input.read(chunks.last(), filled, request)
      if (count < 0) {
        if (filled == 0) chunks.removeAt(chunks.lastIndex)
        return ChunkedBytes(chunks, total.toInt())
      }
      filled += count
      total += count
      if (total > maxBytes) return null
    }
  }

  /**
   * Copies [input] to [output] until the end and returns true, or returns false as soon as [input] has more than
   * [maxBytes] bytes. Reads at most [maxBytes] + 1 bytes and writes at most [maxBytes].
   */
  fun copyAtMost(input: InputStream, output: OutputStream, maxBytes: Long): Boolean {
    val buffer = ByteArray(CHUNK_BYTES)
    var total = 0L
    while (true) {
      val count = input.read(buffer, 0, minOf(buffer.size.toLong(), maxBytes + 1 - total).toInt())
      if (count < 0) return true
      total += count
      if (total > maxBytes) return false
      output.write(buffer, 0, count)
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

/**
 * [size] bytes held in [DetectorTensors.CHUNK_BYTES] chunks; every chunk but the last is full. [inputStream] reads
 * them without copying, any number of times.
 */
class ChunkedBytes internal constructor(private val chunks: List<ByteArray>, val size: Int) {
  /** A new stream over all [size] bytes, with mark and reset support. */
  fun inputStream(): InputStream = object : InputStream() {
    private var position = 0
    private var marked = 0

    override fun read(): Int {
      if (position >= size) return -1
      val chunk = chunks[position / DetectorTensors.CHUNK_BYTES]
      return chunk[position++ % DetectorTensors.CHUNK_BYTES].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (off < 0 || len < 0 || len > b.size - off) throw IndexOutOfBoundsException()
      if (len == 0) return 0
      if (position >= size) return -1
      val count = minOf(len, size - position)
      var copied = 0
      while (copied < count) {
        val offset = position % DetectorTensors.CHUNK_BYTES
        val part = minOf(count - copied, DetectorTensors.CHUNK_BYTES - offset)
        System.arraycopy(chunks[position / DetectorTensors.CHUNK_BYTES], offset, b, off + copied, part)
        copied += part
        position += part
      }
      return count
    }

    override fun skip(n: Long): Long {
      val count = n.coerceIn(0L, (size - position).toLong()).toInt()
      position += count
      return count.toLong()
    }

    override fun available(): Int = size - position

    override fun markSupported(): Boolean = true

    override fun mark(readlimit: Int) {
      marked = position
    }

    override fun reset() {
      position = marked
    }
  }
}
