package com.parkingguide

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class ParkingGuideModule(reactContext: ReactApplicationContext) :
  NativeParkingGuideSpec(reactContext) {

  private val fileExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  override fun getModelVersion(): String {
    return "0.1.0-dev"
  }

  override fun getFileSha256(uri: String, promise: Promise) {
    val source = FileSha256.resolve(uri)
    if (source == PhotoSource.Invalid) {
      promise.reject(
        "E_INVALID_URI",
        "The photo URI must be an absolute path, a file:/// URI, or a content:// URI."
      )
      return
    }
    try {
      fileExecutor.execute {
        try {
          val hex = openPhoto(source)?.use { FileSha256.hex(it) }
          if (hex == null) {
            promise.reject("E_PHOTO_READ", "Could not read the photo file.")
          } else {
            promise.resolve(hex)
          }
        } catch (e: Exception) {
          promise.reject("E_PHOTO_READ", "Could not read the photo file.", e)
        }
      }
    } catch (e: RejectedExecutionException) {
      promise.reject("E_PHOTO_READ", "Could not read the photo file.", e)
    }
  }

  private fun openPhoto(source: PhotoSource): InputStream? = when (source) {
    is PhotoSource.File -> FileInputStream(File(source.path))
    is PhotoSource.Content -> reactApplicationContext.contentResolver.openInputStream(Uri.parse(source.uri))
    PhotoSource.Invalid -> null
  }

  override fun invalidate() {
    fileExecutor.shutdownNow()
    ParkingGuideFrameProcessors.invalidate(reactApplicationContext)
    super.invalidate()
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
