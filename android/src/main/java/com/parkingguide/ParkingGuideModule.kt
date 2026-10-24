package com.parkingguide

import com.facebook.react.bridge.ReactApplicationContext

class ParkingGuideModule(reactContext: ReactApplicationContext) :
  NativeParkingGuideSpec(reactContext) {

  override fun getModelVersion(): String {
    return "0.1.0-dev"
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
