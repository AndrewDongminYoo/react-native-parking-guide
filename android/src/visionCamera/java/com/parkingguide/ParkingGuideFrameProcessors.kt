package com.parkingguide

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import com.mrousavy.camera.core.types.Orientation
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import java.lang.ref.WeakReference

internal object ParkingGuideFrameProcessors {
  private var registered = false
  private val motionTrackers = mutableListOf<WeakReference<RotationVectorTracker>>()

  @Synchronized
  fun register() {
    if (registered) return
    FrameProcessorPluginRegistry.addFrameProcessorPlugin("parkingGuide") { proxy, options ->
      val motion = RotationVectorTracker(proxy.context)
      synchronized(this) {
        motionTrackers.removeAll { it.get() == null }
        motionTrackers.add(WeakReference(motion))
      }
      ParkingGuideFrameProcessor(CaptureThresholds.from(options), motion)
    }
    FrameProcessorPluginRegistry.addFrameProcessorPlugin("parkingDetector") { proxy, options ->
      ParkingDetectorFrameProcessor(proxy.context, FileSha256.resolve(options?.get("modelUri") as? String ?: ""))
    }
    registered = true
  }

  @Synchronized
  fun invalidate(context: ReactApplicationContext) {
    motionTrackers.removeAll {
      val tracker = it.get()
      if (tracker == null) true else if (tracker.context === context) {
        tracker.close()
        true
      } else false
    }
  }
}

private class ParkingGuideFrameProcessor(
  private val thresholds: CaptureThresholds,
  private val motion: RotationVectorTracker
) : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: Map<String, Any>?): Any {
    check(Looper.myLooper() != Looper.getMainLooper() && !motion.context.isOnJSQueueThread) {
      "parkingGuide must run on the frame processor thread."
    }
    val tilt = motion.sample()
    var metrics = ImageMetrics()
    if (frame.isValid) {
      val image = frame.image
      if (image.format == ImageFormat.YUV_420_888 && image.planes.isNotEmpty()) {
        val plane = image.planes[0]
        // Android YUV_420_888 defaults to video range when no range is specified.
        val videoRange = Build.VERSION.SDK_INT < 33 ||
          android.hardware.DataSpace.getRange(image.dataSpace) != android.hardware.DataSpace.RANGE_FULL
        metrics = CaptureMetrics.measureLuma(
          plane.buffer, image.width, image.height, plane.rowStride, plane.pixelStride, videoRange
        )
      }
    }
    return CaptureMetrics.assess(metrics, tilt, thresholds)
  }
}

/** Runs the shared [ParkingDetector] on one camera frame; call it inside `runAsync`. Returns tensors or `error`. */
private class ParkingDetectorFrameProcessor(
  private val context: ReactApplicationContext,
  private val model: PhotoSource
) : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: Map<String, Any>?): Any {
    check(Looper.myLooper() != Looper.getMainLooper() && !context.isOnJSQueueThread) {
      "parkingDetector must run on a frame processor thread."
    }
    if (model == PhotoSource.Invalid) return mapOf("error" to "E_INVALID_URI")
    if (!frame.isValid) return mapOf("error" to ParkingDetector.E_PHOTO_READ)
    val image = frame.image
    if (image.format != ImageFormat.YUV_420_888 || image.planes.size < 3) {
      return mapOf("error" to ParkingDetector.E_PHOTO_READ)
    }
    // Frame.orientation is the reverse of CameraX's rotationDegrees (see VisionCamera's Frame.getOrientation), so
    // map it back to the clockwise rotation that makes the frame upright. CameraX itself is not on this classpath.
    val rotation = when (frame.orientation) {
      Orientation.PORTRAIT -> 0
      Orientation.LANDSCAPE_RIGHT -> 90
      Orientation.PORTRAIT_UPSIDE_DOWN -> 180
      Orientation.LANDSCAPE_LEFT -> 270
    }
    // Frame conversion errors (unexpected strides or buffer limits) are reported like a failed photo read.
    val pixels = try {
      val (y, u, v) = image.planes
      val videoRange = Build.VERSION.SDK_INT < 33 ||
        android.hardware.DataSpace.getRange(image.dataSpace) != android.hardware.DataSpace.RANGE_FULL
      FramePixels.toArgb(
        y.buffer, u.buffer, v.buffer, image.width, image.height, y.rowStride, u.rowStride, u.pixelStride,
        rotation, frame.isMirrored, videoRange
      )
    } catch (e: Exception) {
      return mapOf("error" to ParkingDetector.E_PHOTO_READ)
    }
    val (frameWidth, frameHeight) = FramePixels.uprightSize(image.width, image.height, rotation)
    return try {
      val output = ParkingDetectors.forContext(context).runPixels(pixels, model)
      mapOf(
        "boxes" to output.getValue("boxes").toList(),
        "scores" to output.getValue("scores").toList(),
        "classes" to output.getValue("classes").toList(),
        "frameWidth" to frameWidth.toDouble(),
        "frameHeight" to frameHeight.toDouble()
      )
    } catch (e: ParkingDetector.Failure) {
      mapOf("error" to e.code)
    } catch (e: Throwable) {
      // Includes OutOfMemoryError, which would otherwise leave the frame processor thread.
      mapOf("error" to ParkingDetector.E_INFERENCE)
    }
  }
}

private class RotationVectorTracker(val context: ReactApplicationContext) :
  SensorEventListener, LifecycleEventListener {
  private val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  private val sensor = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var tilt: CaptureTilt? = null
  private var timestamp = 0L
  private var lastFrame = 0L
  private var closed = false
  private val idle = object : Runnable {
    override fun run() {
      synchronized(this@RotationVectorTracker) {
        val remaining = 1_000_000_000L - (SystemClock.elapsedRealtimeNanos() - lastFrame)
        if (remaining > 0) handler?.postDelayed(this, (remaining / 1_000_000).coerceAtLeast(1))
        else stop()
      }
    }
  }

  @Synchronized
  fun sample(): CaptureTilt? {
    if (closed || context.lifecycleState != LifecycleState.RESUMED || sensor == null) return null
    val now = SystemClock.elapsedRealtimeNanos()
    lastFrame = now
    if (thread == null) {
      val worker = HandlerThread("ParkingGuideRotationVector").also { it.start() }
      thread = worker
      val sensorHandler = Handler(worker.looper)
      handler = sensorHandler
      context.addLifecycleEventListener(this)
      if (manager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME, sensorHandler) != true) {
        stop()
        return null
      }
      sensorHandler.postDelayed(idle, 1000)
    }
    return CaptureMetrics.freshTilt(tilt, timestamp, now)
  }

  @Synchronized
  override fun onSensorChanged(event: SensorEvent) {
    if (thread == null || closed || event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
    val rotation = FloatArray(9)
    SensorManager.getRotationMatrixFromVector(rotation, event.values)
    tilt = CaptureMetrics.tiltFromGravity(
      rotation[6].toDouble(), rotation[7].toDouble(), rotation[8].toDouble()
    )
    timestamp = event.timestamp
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  override fun onHostResume() = Unit
  override fun onHostPause() = stop()
  override fun onHostDestroy() = close()

  @Synchronized
  private fun stop() {
    manager?.unregisterListener(this)
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    thread = null
    handler = null
    tilt = null
    timestamp = 0
    context.removeLifecycleEventListener(this)
  }

  @Synchronized
  fun close() {
    closed = true
    stop()
  }
}
