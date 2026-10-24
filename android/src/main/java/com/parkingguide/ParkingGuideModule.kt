package com.parkingguide

import com.facebook.react.bridge.ReactApplicationContext

class ParkingGuideModule(reactContext: ReactApplicationContext) :
  NativeParkingGuideSpec(reactContext) {

  override fun getModelVersion(): String {
    return "0.1.0-dev"
  }

  override fun invalidate() {
    ParkingGuideFrameProcessors.invalidate(reactApplicationContext)
    super.invalidate()
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
