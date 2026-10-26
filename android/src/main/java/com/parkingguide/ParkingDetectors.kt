package com.parkingguide

import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.WeakHashMap

/**
 * One [ParkingDetector] per React context, shared by `runDetector` and the `parkingDetector` frame processor so that
 * one model URI is loaded once. [ParkingDetector] serializes its calls.
 */
object ParkingDetectors {
  private val detectors = WeakHashMap<ReactApplicationContext, ParkingDetector>()
  private var copiesDeleted = false

  /**
   * Detectors keep `content://` model copies in [ParkingDetector.MODEL_COPY_DIR] inside the app cache directory, so the
   * cleanup never touches host-app files. The first call in a process deletes the copies that an earlier process left
   * there; no detector of this process has written one yet.
   */
  @Synchronized
  fun forContext(context: ReactApplicationContext): ParkingDetector =
    detectors.getOrPut(context) {
      val copyDir = File(context.cacheDir, ParkingDetector.MODEL_COPY_DIR)
      if (!copiesDeleted) {
        ParkingDetector.deleteModelCopies(copyDir)
        copiesDeleted = true
      }
      ParkingDetector(copyDir) { openSource(context, it) }
    }

  @Synchronized
  fun close(context: ReactApplicationContext) {
    detectors.remove(context)?.close()
  }

  /** Opens a resolved photo or model source for reading; `content://` uses the context's `ContentResolver`. */
  fun openSource(context: ReactApplicationContext, source: PhotoSource): InputStream? = when (source) {
    is PhotoSource.File -> FileInputStream(File(source.path))
    is PhotoSource.Content -> context.contentResolver.openInputStream(Uri.parse(source.uri))
    PhotoSource.Invalid -> null
  }
}
