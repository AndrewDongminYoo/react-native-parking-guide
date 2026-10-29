package com.parkingguide

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

sealed class PhotoSource {
  data class File(
    val path: String,
  ) : PhotoSource()

  data class Content(
    val uri: String,
  ) : PhotoSource()

  object Invalid : PhotoSource()
}

object FileSha256 {
  private const val CHUNK_SIZE = 64 * 1024
  private const val FILE_PREFIX = "file://"
  private const val CONTENT_PREFIX = "content://"

  /**
   * Same rule as `ParkingGuideFileURL` in `ios/ParkingGuideDetector.mm`: an absolute path, or a `file:///` URI whose text
   * after `file://` is strictly percent-decoded as UTF-8. Android also accepts `content://` URIs.
   */
  fun resolve(uri: String): PhotoSource =
    when {
      uri.startsWith("/") -> PhotoSource.File(uri)
      uri.startsWith("$FILE_PREFIX/") ->
        percentDecode(uri.substring(FILE_PREFIX.length))?.let { PhotoSource.File(it) } ?: PhotoSource.Invalid
      uri.startsWith(CONTENT_PREFIX) && uri.length > CONTENT_PREFIX.length -> PhotoSource.Content(uri)
      else -> PhotoSource.Invalid
    }

  private fun hexValue(c: Char): Int =
    when (c) {
      in '0'..'9' -> c - '0'
      in 'a'..'f' -> c - 'a' + 10
      in 'A'..'F' -> c - 'A' + 10
      else -> -1
    }

  /** Returns null for a malformed `%XX` sequence or bytes that are not valid UTF-8. */
  fun percentDecode(text: String): String? {
    val bytes = ByteArrayOutputStream(text.length)
    var i = 0
    while (i < text.length) {
      if (text[i] == '%') {
        if (i + 2 >= text.length) return null
        val high = hexValue(text[i + 1])
        val low = hexValue(text[i + 2])
        if (high < 0 || low < 0) return null
        bytes.write(high * 16 + low)
        i += 3
      } else {
        val next = text.indexOf('%', i).let { if (it < 0) text.length else it }
        val literal = text.substring(i, next).toByteArray(Charsets.UTF_8)
        bytes.write(literal, 0, literal.size)
        i = next
      }
    }
    return try {
      Charsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes.toByteArray()))
        .toString()
    } catch (e: CharacterCodingException) {
      null
    }
  }

  /** Lowercase hexadecimal SHA-256 of every remaining byte of [input]. Does not close [input]. */
  fun hex(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(CHUNK_SIZE)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      digest.update(buffer, 0, count)
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
}
