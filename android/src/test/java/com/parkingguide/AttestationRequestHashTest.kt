package com.parkingguide

import org.junit.Assert.*
import org.junit.Test

class AttestationRequestHashTest {
  // Expected values from `printf '%s' '<photoSha256>:<challenge>' | shasum -a 256`.
  @Test fun asciiChallenge() {
    assertEquals(
      "10e6e0144c17252c90163d5fcb1c4d3e58199f6c2d6a9caf39faa2627582edba",
      AttestationRequestHash.hex("a".repeat(64), "nonce-1"),
    )
  }

  @Test fun encodesChallengeAsUtf8() {
    assertEquals(
      "d3b21ea7ddbb239893c471c94ebd639f7b7ed5e8a9749e15ad8bbe8ec842ff30",
      AttestationRequestHash.hex(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "주차-확인",
      ),
    )
  }

  @Test fun isLowercaseHex() {
    assertTrue(Regex("^[0-9a-f]{64}$").matches(AttestationRequestHash.hex("b".repeat(64), "x")))
  }
}
