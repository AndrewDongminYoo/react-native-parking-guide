package com.parkingguide

import android.graphics.Bitmap
import android.media.ExifInterface
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import kotlin.random.Random
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Checks the [ParkingDetector] input and output limits from [DetectorTensors] (issue #70) on the synthetic fixtures
 * from scripts/make-fixture-models.py. `content://` sources are served by the injected `open` function, so no
 * ContentProvider is needed. Run with `./gradlew :react-native-parking-guide:connectedDebugAndroidTest` from
 * example/android.
 */
@RunWith(AndroidJUnit4::class)
class DetectorLimitsTest {
  private val context = InstrumentationRegistry.getInstrumentation().context
  private val streams = mutableMapOf<PhotoSource, () -> InputStream>()
  private val opens = mutableMapOf<PhotoSource, Int>()
  private val detector = ParkingDetector(context.cacheDir) { source ->
    opens[source] = (opens[source] ?: 0) + 1
    streams[source]?.invoke() ?: (source as? PhotoSource.File)?.let { FileInputStream(it.path) }
  }

  @After fun close() = detector.close()

  private fun fixture(name: String): PhotoSource.File {
    val file = File(context.cacheDir, name)
    context.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
    return PhotoSource.File(file.path)
  }

  private fun content(name: String, stream: () -> InputStream): PhotoSource.Content =
    PhotoSource.Content("content://test/$name").also { streams[it] = stream }

  @Test fun rejectsAnEndlessContentModel() {
    val stream = EndlessZeros()
    val model = content("endless.tflite") { stream }
    val error = assertThrows(ParkingDetector.Failure::class.java) { detector.run(fixture("solid.png"), model) }
    logPath("endless model", error, stream, DetectorTensors.MAX_MODEL_BYTES)
    assertEquals(ParkingDetector.E_MODEL_LOAD, error.code)
    assertEquals(DetectorTensors.MAX_MODEL_BYTES + 1L, stream.served)
  }

  @Test fun rejectsAnEndlessPhoto() {
    val stream = EndlessZeros()
    val photo = content("endless.png") { stream }
    val error = assertThrows(ParkingDetector.Failure::class.java) {
      detector.run(photo, fixture("detector-nhwc.tflite"))
    }
    logPath("endless photo", error, stream, DetectorTensors.MAX_PHOTO_BYTES)
    assertEquals(ParkingDetector.E_PHOTO_READ, error.code)
    assertEquals(DetectorTensors.MAX_PHOTO_BYTES + 1L, stream.served)
  }

  /**
   * Logs how many bytes were served before the error, against [maxBytes]. The cases assert that the cap stopped the
   * read at exactly [maxBytes] + 1 bytes; an OutOfMemoryError maps to the same error code, so also check logcat for
   * "Throwing OutOfMemoryError". The endless model case writes up to [maxBytes] bytes to the cache directory.
   */
  private fun logPath(case: String, error: ParkingDetector.Failure, stream: EndlessZeros, maxBytes: Int) {
    Log.i(TAG, "$case: ${error.code} after ${stream.served} of at most ${maxBytes + 1L} bytes")
  }

  @Test fun decodesATallPhotoWithinTheLongSideCap() {
    // 512 x 60000 decodes at 32 x 3750 with the cap; without it, at full size (about 117 MiB of ARGB pixels).
    val output = detector.run(fixture("tall.png"), fixture("detector-nhwc.tflite"))
    assertEquals(8, output.getValue("boxes").size)
    assertEquals(0.8, output.getValue("scores")[0], 1e-3)
  }

  @Test fun opensThePhotoOncePerRun() {
    val photo = content("solid.png") { context.assets.open("solid.png") }
    val output = detector.run(photo, fixture("detector-nhwc.tflite"))
    assertEquals(1, opens[photo])
    assertEquals(0.8, output.getValue("scores")[0], 1e-3)
  }

  @Test fun readsTheExifOrientationThroughTheChunkedPhoto() {
    // Noise keeps the JPEG above one DetectorTensors.CHUNK_BYTES chunk, so ExifInterface reads across chunks.
    val random = Random(0)
    val pixels = IntArray(512 * 512) { random.nextInt() or (0xff shl 24) }
    val file = File(context.cacheDir, "rotated.jpg")
    file.outputStream().use {
      Bitmap.createBitmap(pixels, 512, 512, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 100, it)
    }
    ExifInterface(file.path).apply {
      setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
      saveAttributes()
    }
    val bytes = FileInputStream(file).use { DetectorTensors.readAtMost(it, DetectorTensors.MAX_PHOTO_BYTES) }!!
    assertTrue(bytes.size > DetectorTensors.CHUNK_BYTES)
    val orientation = ExifInterface(bytes.inputStream())
      .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    assertEquals(ExifInterface.ORIENTATION_ROTATE_90, orientation)
  }

  @Test fun rejectsAnOutputAboveTheDetectionLimit() {
    val error = assertThrows(ParkingDetector.Failure::class.java) {
      detector.run(fixture("solid.png"), fixture("detector-large.tflite"))
    }
    assertEquals(ParkingDetector.E_MODEL_CONTRACT, error.code)
  }

  /** Zero bytes without end; fills the caller's buffer without allocating and counts the bytes it served. */
  private class EndlessZeros : InputStream() {
    var served = 0L
      private set

    override fun read(): Int {
      served++
      return 0
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      b.fill(0, off, off + len)
      served += len
      return len
    }
  }

  private companion object {
    const val TAG = "DetectorLimitsTest"
  }
}
