package com.parkingguide

import java.security.MessageDigest

/** The request hash that binds an attestation token to a photo and a server challenge. */
internal object AttestationRequestHash {
  /** Lowercase hexadecimal SHA-256 of the UTF-8 bytes of `photoSha256 + ':' + challenge`. */
  fun hex(
    photoSha256: String,
    challenge: String,
  ): String {
    val digest = MessageDigest.getInstance("SHA-256").digest("$photoSha256:$challenge".toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
}
