package com.parkingguide

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter

/**
 * Runs a host-supplied LiteRT (TFLite) detector on one photo, following the README "Detector model contract".
 * Same rules and error codes as `ios/ParkingGuideDetector.mm`. Caches the last model; every method is synchronized.
 *
 * [open] opens a [PhotoSource] for reading, or returns null.
 */
class ParkingDetector(private val open: (PhotoSource) -> InputStream?) {
  class Failure(val code: String, message: String) : Exception(message)

  private var modelKey: PhotoSource? = null
  private var interpreter: Interpreter? = null

  /** Returns the flattened `boxes`, `scores`, and `classes` outputs for a photo, or throws [Failure]. */
  @Synchronized
  fun run(photo: PhotoSource, model: PhotoSource): Map<String, DoubleArray> =
    runWith(model) { readPixels(photo) ?: throw Failure(E_PHOTO_READ, "Could not read the photo file.") }

  /** Same as [run] for 512 x 512 upright ARGB pixels, for example from [FramePixels.toArgb]. */
  @Synchronized
  fun runPixels(pixels: IntArray, model: PhotoSource): Map<String, DoubleArray> = runWith(model) { pixels }

  /** Loads [model] and checks its contract before [pixels] is called, so model errors take precedence. */
  private fun runWith(model: PhotoSource, pixels: () -> IntArray): Map<String, DoubleArray> {
    val interpreter = load(model)
    val key = interpreter.signatureKeys.singleOrNull() ?: throw contractFailure()
    val inputName = interpreter.getSignatureInputs(key).singleOrNull() ?: throw contractFailure()
    val input = interpreter.getInputTensorFromSignature(inputName, key)
    val layout = DetectorTensors.layoutOf(input.shape())
    val outputNames = interpreter.getSignatureOutputs(key).toList()
    if (layout == null || input.dataType() != DataType.FLOAT32 || !outputNames.containsAll(DetectorTensors.OUTPUT_NAMES)) {
      throw contractFailure()
    }
    val kinds = outputNames.associateWith { name ->
      when (interpreter.getOutputTensorFromSignature(name, key).dataType()) {
        DataType.FLOAT32 -> ValueKind.FLOAT32
        DataType.INT32 -> ValueKind.INT32
        DataType.INT64 -> ValueKind.INT64
        else -> null
      }
    }
    if (DetectorTensors.OUTPUT_NAMES.any { kinds[it] == null }) throw contractFailure()

    val argb = pixels()
    val inputBuffer = ByteBuffer.allocateDirect(4 * 3 * DetectorTensors.INPUT_SIZE * DetectorTensors.INPUT_SIZE)
      .order(ByteOrder.nativeOrder())
    DetectorTensors.fillInput(argb, layout, inputBuffer.asFloatBuffer())
    try {
      // No preallocated outputs: a model may return a different detection count per photo, so each output is read
      // after inference with the shape it resolved to.
      interpreter.runSignature(mapOf<String, Any>(inputName to inputBuffer), mutableMapOf(), key)
    } catch (e: Exception) {
      throw inferenceFailure()
    }
    val outputs = DetectorTensors.OUTPUT_NAMES.associateWith { interpreter.getOutputTensorFromSignature(it, key) }
    if (outputs.any { (name, tensor) -> !DetectorTensors.withinOutputLimit(name, tensor.numElements()) }) {
      throw contractFailure()
    }
    return try {
      outputs.mapValues { (name, tensor) -> DetectorTensors.readValues(tensor.asReadOnlyBuffer(), kinds.getValue(name)!!) }
    } catch (e: Exception) {
      throw inferenceFailure()
    } catch (e: OutOfMemoryError) {
      throw inferenceFailure()
    }
  }

  @Synchronized
  fun close() {
    interpreter?.close()
    interpreter = null
    modelKey = null
  }

  private fun load(model: PhotoSource): Interpreter {
    interpreter?.let { if (modelKey == model) return it }
    close()
    val loaded = try {
      when (model) {
        is PhotoSource.File -> Interpreter(File(model.path))
        is PhotoSource.Content -> {
          val bytes = open(model)?.use { DetectorTensors.readAtMost(it, DetectorTensors.MAX_MODEL_BYTES) }
            ?: throw Failure(E_MODEL_LOAD, MODEL_LOAD_MESSAGE)
          Interpreter(ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply { put(bytes); rewind() })
        }
        PhotoSource.Invalid -> throw Failure(E_MODEL_LOAD, MODEL_LOAD_MESSAGE)
      }
    } catch (e: Failure) {
      throw e
    } catch (e: Exception) {
      throw Failure(E_MODEL_LOAD, MODEL_LOAD_MESSAGE)
    } catch (e: OutOfMemoryError) {
      throw Failure(E_MODEL_LOAD, MODEL_LOAD_MESSAGE)
    }
    interpreter = loaded
    modelKey = model
    return loaded
  }

  /**
   * Reads the photo once (at most [DetectorTensors.MAX_PHOTO_BYTES]), so its size, pixels, and EXIF orientation come
   * from the same bytes; decodes it with the long side at most [DetectorTensors.MAX_DECODED_SIDE], applies the
   * orientation, and stretches it to 512 x 512 ARGB pixels.
   */
  private fun readPixels(photo: PhotoSource): IntArray? = try {
    val bytes = open(photo)?.use { DetectorTensors.readAtMost(it, DetectorTensors.MAX_PHOTO_BYTES) }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size, bounds) }
    if (bytes == null || bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      null
    } else {
      val options = BitmapFactory.Options().apply {
        inSampleSize = DetectorTensors.sampleSize(bounds.outWidth, bounds.outHeight)
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.let { decoded ->
        val matrix = orientationMatrix(bytes)
        val oriented = if (matrix.isIdentity) {
          decoded
        } else {
          Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        }
        val size = DetectorTensors.INPUT_SIZE
        val scaled = Bitmap.createScaledBitmap(oriented, size, size, true)
        IntArray(size * size).also { scaled.getPixels(it, 0, size, 0, 0, size, size) }
      }
    }
  } catch (e: Exception) {
    null
  } catch (e: OutOfMemoryError) {
    null
  }

  private fun orientationMatrix(bytes: ByteArray): Matrix {
    val orientation = try {
      ExifInterface(ByteArrayInputStream(bytes))
        .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } catch (e: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    return Matrix().apply {
      when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
      }
    }
  }

  private fun inferenceFailure() = Failure(E_INFERENCE, "The LiteRT inference failed.")

  private fun contractFailure() = Failure(
    E_MODEL_CONTRACT,
    "The model must have one signature with one float32 input of shape [1, 512, 512, 3] or [1, 3, 512, 512] " +
      "and outputs named boxes, scores, and classes for at most ${DetectorTensors.MAX_DETECTIONS} detections."
  )

  companion object {
    const val E_MODEL_LOAD = "E_MODEL_LOAD"
    const val E_MODEL_CONTRACT = "E_MODEL_CONTRACT"
    const val E_PHOTO_READ = "E_PHOTO_READ"
    const val E_INFERENCE = "E_INFERENCE"
    private const val MODEL_LOAD_MESSAGE = "Could not load the LiteRT model."
  }
}
