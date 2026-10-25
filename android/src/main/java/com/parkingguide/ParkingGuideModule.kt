package com.parkingguide

import android.net.Uri
import com.facebook.react.bridge.Arguments
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
  private val detector = ParkingDetector(::openPhoto)

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

  override fun runDetector(photoUri: String, modelUri: String, promise: Promise) {
    val photo = FileSha256.resolve(photoUri)
    val model = FileSha256.resolve(modelUri)
    if (photo == PhotoSource.Invalid || model == PhotoSource.Invalid) {
      promise.reject(
        "E_INVALID_URI",
        "The photo and model URIs must be absolute paths, file:/// URIs, or content:// URIs."
      )
      return
    }
    try {
      fileExecutor.execute {
        try {
          val output = detector.run(photo, model)
          val map = Arguments.createMap()
          for ((name, values) in output) {
            val array = Arguments.createArray()
            values.forEach { array.pushDouble(it) }
            map.putArray(name, array)
          }
          promise.resolve(map)
        } catch (e: ParkingDetector.Failure) {
          promise.reject(e.code, e.message)
        } catch (e: Exception) {
          promise.reject(ParkingDetector.E_INFERENCE, "The LiteRT inference failed.")
        }
      }
    } catch (e: RejectedExecutionException) {
      promise.reject(ParkingDetector.E_INFERENCE, "The LiteRT inference failed.")
    }
  }

  private fun openPhoto(source: PhotoSource): InputStream? = when (source) {
    is PhotoSource.File -> FileInputStream(File(source.path))
    is PhotoSource.Content -> reactApplicationContext.contentResolver.openInputStream(Uri.parse(source.uri))
    PhotoSource.Invalid -> null
  }

  override fun invalidate() {
    fileExecutor.shutdownNow()
    detector.close()
    ParkingGuideFrameProcessors.invalidate(reactApplicationContext)
    super.invalidate()
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
