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
