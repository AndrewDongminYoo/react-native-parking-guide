package com.parkingguide

import com.facebook.react.bridge.ReactApplicationContext

class ParkingGuideModule(reactContext: ReactApplicationContext) :
  NativeParkingGuideSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeParkingGuideSpec.NAME
  }
}
