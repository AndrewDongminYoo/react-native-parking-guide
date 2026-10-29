package com.parkingguide

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/** Used when the Gradle property `ParkingGuide_enableAttestation` is not `true`: the build has no Play Integrity. */
internal object ParkingGuideAttestation {
  @Suppress("UNUSED_PARAMETER")
  fun request(
    context: ReactApplicationContext,
    photoSha256: String,
    challenge: String,
    cloudProjectNumber: Long,
    promise: Promise,
  ) {
    promise.reject(
      E_ATTESTATION_UNSUPPORTED,
      "This build has no Play Integrity support. Set the Gradle property ParkingGuide_enableAttestation=true.",
    )
  }

  fun invalidate() = Unit

  private const val E_ATTESTATION_UNSUPPORTED = "E_ATTESTATION_UNSUPPORTED"
}
