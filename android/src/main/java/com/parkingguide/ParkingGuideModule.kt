package com.parkingguide

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class ParkingGuideModule(
  reactContext: ReactApplicationContext,
) : NativeParkingGuideSpec(reactContext) {
  private val fileExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  override fun getFileSha256(
    uri: String,
    promise: Promise,
  ) {
    val source = FileSha256.resolve(uri)
    if (source == PhotoSource.Invalid) {
      promise.reject(
        "E_INVALID_URI",
        "The photo URI must be an absolute path, a file:/// URI, or a content:// URI.",
      )
      return
    }
    try {
      fileExecutor.execute {
        try {
          val hex = ParkingDetectors.openSource(reactApplicationContext, source)?.use { FileSha256.hex(it) }
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

  override fun runDetector(
    photoUri: String,
    modelUri: String,
    promise: Promise,
  ) {
    val photo = FileSha256.resolve(photoUri)
    val model = FileSha256.resolve(modelUri)
    if (photo == PhotoSource.Invalid || model == PhotoSource.Invalid) {
      promise.reject(
        "E_INVALID_URI",
        "The photo and model URIs must be absolute paths, file:/// URIs, or content:// URIs.",
      )
      return
    }
    try {
      fileExecutor.execute {
        try {
          val output = ParkingDetectors.forContext(reactApplicationContext).run(photo, model)
          val map = Arguments.createMap()
          for ((name, values) in output) {
            val array = Arguments.createArray()
            values.forEach { array.pushDouble(it) }
            map.putArray(name, array)
          }
          promise.resolve(map)
        } catch (e: ParkingDetector.Failure) {
          promise.reject(e.code, e.message)
        } catch (e: Throwable) {
          // Includes OutOfMemoryError, so the promise settles instead of the error reaching the thread's handler.
          promise.reject(ParkingDetector.E_INFERENCE, "The LiteRT inference failed.")
        }
      }
    } catch (e: RejectedExecutionException) {
      promise.reject(ParkingDetector.E_INFERENCE, "The LiteRT inference failed.")
    }
  }

  override fun requestAttestation(
    photoSha256: String,
    challenge: String,
    cloudProjectNumber: Double,
    promise: Promise,
  ) {
    ParkingGuideAttestation.request(
      reactApplicationContext,
      photoSha256,
      challenge,
      cloudProjectNumber.toLong(),
      promise,
    )
  }

  // Play Integrity keeps no key on the device, so there is nothing to reset.
  override fun resetAttestationKey(promise: Promise) {
    promise.resolve(null)
  }

  override fun invalidate() {
    fileExecutor.shutdownNow()
    ParkingGuideAttestation.invalidate()
    ParkingDetectors.close(reactApplicationContext)
    ParkingGuideFrameProcessors.invalidate(reactApplicationContext)
    super.invalidate()
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
