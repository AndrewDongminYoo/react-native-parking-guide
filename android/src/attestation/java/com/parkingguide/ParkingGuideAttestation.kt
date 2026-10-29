package com.parkingguide

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityException
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import com.google.android.play.core.integrity.model.StandardIntegrityErrorCode
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** Play Integrity Standard API requests, used when the Gradle property `ParkingGuide_enableAttestation` is `true`. */
internal object ParkingGuideAttestation {
  /**
   * Provider preparations by Cloud project number, pending or complete, so that concurrent requests share one prepare
   * call. A failed preparation is removed; a provider stays until a request reports it invalid.
   */
  private val providers = ConcurrentHashMap<Long, Task<StandardIntegrityTokenProvider>>()

  /** Error codes that mean the device has no usable Play Store or Play services, not that the request failed. */
  private val unsupportedCodes =
    setOf(
      StandardIntegrityErrorCode.API_NOT_AVAILABLE,
      StandardIntegrityErrorCode.PLAY_STORE_NOT_FOUND,
      StandardIntegrityErrorCode.PLAY_SERVICES_NOT_FOUND,
    )

  fun request(
    context: ReactApplicationContext,
    photoSha256: String,
    challenge: String,
    cloudProjectNumber: Long,
    promise: Promise,
  ) {
    val requestHash = AttestationRequestHash.hex(photoSha256, challenge)
    withProvider(context, cloudProjectNumber, promise) { provider ->
      requestToken(context, cloudProjectNumber, provider, requestHash, true, promise)
    }
  }

  fun invalidate() {
    providers.clear()
  }

  private fun withProvider(
    context: ReactApplicationContext,
    cloudProjectNumber: Long,
    promise: Promise,
    block: (StandardIntegrityTokenProvider) -> Unit,
  ) {
    val task =
      try {
        providers.computeIfAbsent(cloudProjectNumber) {
          IntegrityManagerFactory
            .createStandard(context.applicationContext)
            .prepareIntegrityToken(
              PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(cloudProjectNumber).build(),
            )
        }
      } catch (e: Exception) {
        reject(promise, "prepare", e)
        return
      }
    task
      .addOnSuccessListener { provider -> block(provider) }
      .addOnFailureListener { e ->
        // Remove only this failed preparation, so that the next request prepares again.
        providers.remove(cloudProjectNumber, task)
        reject(promise, "prepare", e)
      }
  }

  /** Removes the cached preparation only if it still holds `provider`, not a newer preparation. */
  private fun discardProvider(
    cloudProjectNumber: Long,
    provider: StandardIntegrityTokenProvider,
  ) {
    providers.computeIfPresent(cloudProjectNumber) { _, task ->
      if (task.isSuccessful && task.result === provider) null else task
    }
  }

  private fun requestToken(
    context: ReactApplicationContext,
    cloudProjectNumber: Long,
    provider: StandardIntegrityTokenProvider,
    requestHash: String,
    retryOnInvalidProvider: Boolean,
    promise: Promise,
  ) {
    try {
      provider
        .request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
        .addOnSuccessListener { response ->
          val token =
            JSONObject()
              .put("platform", "android")
              .put("type", "integrity")
              .put("data", response.token())
              .put("requestHash", requestHash)
              .toString()
          promise.resolve(token)
        }.addOnFailureListener { e ->
          if (retryOnInvalidProvider &&
            e is StandardIntegrityException &&
            e.errorCode == StandardIntegrityErrorCode.INTEGRITY_TOKEN_PROVIDER_INVALID
          ) {
            // Prepare a new provider once; a second invalid provider is reported as a failure.
            discardProvider(cloudProjectNumber, provider)
            withProvider(context, cloudProjectNumber, promise) { fresh ->
              requestToken(context, cloudProjectNumber, fresh, requestHash, false, promise)
            }
          } else {
            reject(promise, "request", e)
          }
        }
    } catch (e: Exception) {
      reject(promise, "request", e)
    }
  }

  private fun reject(
    promise: Promise,
    step: String,
    e: Exception,
  ) {
    if (e is StandardIntegrityException) {
      val code = if (e.errorCode in unsupportedCodes) E_ATTESTATION_UNSUPPORTED else E_ATTESTATION_FAILED
      promise.reject(code, "Play Integrity $step failed (StandardIntegrityErrorCode ${e.errorCode}).")
    } else {
      promise.reject(E_ATTESTATION_FAILED, "Play Integrity $step failed (${e.javaClass.simpleName}).")
    }
  }

  private const val E_ATTESTATION_UNSUPPORTED = "E_ATTESTATION_UNSUPPORTED"
  private const val E_ATTESTATION_FAILED = "E_ATTESTATION_FAILED"
}
