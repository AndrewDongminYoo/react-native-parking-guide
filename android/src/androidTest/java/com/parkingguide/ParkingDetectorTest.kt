package com.parkingguide

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs [ParkingDetector] on the synthetic fixtures from scripts/make-fixture-models.py. Row 0 score is the mean red
 * value of fixtures/detector/solid.png, 0.8 within 1e-3; reading the input in the wrong layout gives about 0.467.
 * Run with `./gradlew :react-native-parking-guide:connectedDebugAndroidTest` from example/android.
 */
@RunWith(AndroidJUnit4::class)
class ParkingDetectorTest {
  private val detector = ParkingDetector { source ->
    (source as? PhotoSource.File)?.let { FileInputStream(it.path) }
  }

  @After fun close() = detector.close()

  private fun fixture(name: String): PhotoSource.File {
    val context = InstrumentationRegistry.getInstrumentation().context
    val file = File(context.cacheDir, name)
    context.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
    return PhotoSource.File(file.path)
  }

  @Test fun runsNhwcAndNchwFixtures() {
    for (layout in listOf("nhwc", "nchw")) {
      val output = detector.run(fixture("solid.png"), fixture("detector-$layout.tflite"))
      assertArrayEquals(layout, doubleArrayOf(0.1, 0.2, 0.6, 0.9, 0.0, 0.0, 0.0, 0.0), output.getValue("boxes"), 1e-6)
      assertEquals(layout, 0.8, output.getValue("scores")[0], 1e-3)
      assertEquals(layout, 0.0, output.getValue("scores")[1], 0.0)
      assertArrayEquals(layout, doubleArrayOf(0.0, 3.0), output.getValue("classes"), 0.0)
    }
  }

  @Test fun rejectsAMissingModel() {
    val error = assertThrows(ParkingDetector.Failure::class.java) {
      detector.run(fixture("solid.png"), PhotoSource.File("/nonexistent/model.tflite"))
    }
    assertEquals(ParkingDetector.E_MODEL_LOAD, error.code)
  }

  @Test fun rejectsAnUnreadablePhoto() {
    val error = assertThrows(ParkingDetector.Failure::class.java) {
      detector.run(fixture("detector-nhwc.tflite"), fixture("detector-nhwc.tflite"))
    }
    assertEquals(ParkingDetector.E_PHOTO_READ, error.code)
  }
}
