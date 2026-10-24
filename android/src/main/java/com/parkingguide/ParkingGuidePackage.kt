package com.parkingguide

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ParkingGuidePackage : BaseReactPackage() {
  init {
    ParkingGuideFrameProcessors.register()
  }

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == ParkingGuideModule.NAME) {
      ParkingGuideModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      ParkingGuideModule.NAME to ReactModuleInfo(
        name = ParkingGuideModule.NAME,
        className = ParkingGuideModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
