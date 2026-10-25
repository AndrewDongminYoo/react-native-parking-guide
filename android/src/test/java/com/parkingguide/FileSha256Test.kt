package com.parkingguide

import java.io.ByteArrayInputStream
import org.junit.Assert.*
import org.junit.Test

class FileSha256Test {
  private fun hex(bytes: ByteArray) = FileSha256.hex(ByteArrayInputStream(bytes))

  @Test fun knownDigests() {
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hex(ByteArray(0)))
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex("abc".toByteArray()))
  }

  @Test fun inputLongerThanOneChunk() {
    // 1,000,000 x 'a' is a FIPS 180-2 test vector and spans many read buffers.
    val bytes = ByteArray(1_000_000) { 'a'.code.toByte() }
    assertEquals("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", hex(bytes))
  }

  @Test fun resolvesSources() {
    assertEquals(PhotoSource.File("/data/user/0/app/cache/photo.jpg"), FileSha256.resolve("/data/user/0/app/cache/photo.jpg"))
    assertEquals(PhotoSource.File("/data/a b/photo.jpg"), FileSha256.resolve("file:///data/a%20b/photo.jpg"))
    assertEquals(PhotoSource.File("/data/a b/photo.jpg"), FileSha256.resolve("file:///data/a b/photo.jpg"))
    assertEquals(PhotoSource.File("/data/\uD55C.jpg"), FileSha256.resolve("file:///data/%ED%95%9C.jpg"))
    assertEquals(PhotoSource.File("/data/\uD83D\uDEF4 %.jpg"), FileSha256.resolve("file:///data/\uD83D\uDEF4%20%25.jpg"))
    assertEquals(PhotoSource.Content("content://media/external/images/media/1"), FileSha256.resolve("content://media/external/images/media/1"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve(""))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("photo.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("https://example.com/photo.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file://"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file://photo.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file://localhost/data/photo.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("content://"))
  }

  @Test fun rejectsInvalidPercentEncoding() {
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file:///data/%zz.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file:///data/%2.jpg"))
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file:///data/%FF.jpg"))
    // Arabic-Indic digit three is a Unicode digit but not an ASCII hex digit.
    assertEquals(PhotoSource.Invalid, FileSha256.resolve("file:///data/%2\u0663.jpg"))
  }
}
