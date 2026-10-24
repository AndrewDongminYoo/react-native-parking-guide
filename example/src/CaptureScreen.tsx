import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createParkingFrameAnalyzer,
  useParkingGuidance,
} from 'react-native-parking-guide';
import type { VehicleType } from 'react-native-parking-guide';

import { captureTitle, guidanceMessages } from './captureCopy';
import {
  GUIDE_FRAME_HINT_GAP,
  GUIDE_FRAME_HORIZONTAL_MARGIN,
  fitGuideFrameWidth,
} from './guideFrameLayout';
import type { LayoutSize } from './guideFrameLayout';
import { VehicleSilhouette } from './VehicleSilhouette';

const READY_COLOR = '#34C759';
const IDLE_COLOR = 'rgba(255, 255, 255, 0.9)';

interface CaptureScreenProps {
  vehicleType: VehicleType;
  onClose: () => void;
}

function CaptureHeader({
  title,
  onClose,
  torch,
}: {
  title: string;
  onClose: () => void;
  torch?: { on: boolean; onToggle: () => void };
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + 8,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={onClose}
          style={styles.iconButton}
        >
          <Text style={styles.iconText}>✕</Text>
        </Pressable>
        {torch ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Flashlight"
            accessibilityState={{ checked: torch.on }}
            hitSlop={12}
            onPress={torch.onToggle}
            style={[styles.iconButton, torch.on && styles.iconButtonOn]}
          >
            <Text style={[styles.torchText, torch.on && styles.torchTextOn]}>
              {torch.on ? 'Light on' : 'Light off'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

function CameraCapture({ vehicleType, onClose }: CaptureScreenProps) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('back');
  const guidance = useParkingGuidance();
  const { onFrameResult } = guidance;
  const [torchOn, setTorchOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState('');
  const [frameArea, setFrameArea] = useState<LayoutSize | null>(null);
  const [hintHeight, setHintHeight] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const analyze = useMemo(
    () => createParkingFrameAnalyzer(VisionCameraProxy),
    []
  );
  const deliver = useMemo(
    () => Worklets.createRunOnJS(onFrameResult),
    [onFrameResult]
  );
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(5, () => {
        'worklet';
        deliver(analyze(frame));
      });
    },
    [analyze, deliver]
  );

  const title = captureTitle(vehicleType);
  if (!device) {
    return (
      <View style={styles.screen}>
        <CaptureHeader title={title} onClose={onClose} />
        <View style={styles.centered}>
          <Text style={styles.stateText}>
            No back camera is available on this device.
          </Text>
        </View>
      </View>
    );
  }

  const canCapture =
    guidance.ready && guidance.issues.length === 0 && !capturing;
  const messages = guidanceMessages(guidance.issues);
  const frameColor = guidance.ready ? READY_COLOR : IDLE_COLOR;
  const frameWidth =
    frameArea && hintHeight !== null
      ? fitGuideFrameWidth(frameArea, hintHeight)
      : 0;

  async function capturePhoto() {
    if (!canCapture || camera.current == null) {
      return;
    }
    setCapturing(true);
    try {
      await camera.current.takePhoto({ flash: 'off' });
      setStatus('Photo captured. A parking result is not available yet.');
    } catch {
      setStatus('Could not take the photo. Try again.');
    } finally {
      setCapturing(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        pixelFormat="yuv"
        torch={device.hasTorch && torchOn ? 'on' : 'off'}
        frameProcessor={frameProcessor}
      />
      <CaptureHeader
        title={title}
        onClose={onClose}
        torch={
          device.hasTorch
            ? { on: torchOn, onToggle: () => setTorchOn((on) => !on) }
            : undefined
        }
      />
      <View
        style={[
          styles.frameArea,
          { marginLeft: insets.left, marginRight: insets.right },
        ]}
        pointerEvents="none"
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setFrameArea({ width, height });
        }}
      >
        {frameWidth > 0 ? (
          <View
            style={[
              styles.guideFrame,
              { width: frameWidth, borderColor: frameColor },
            ]}
          >
            <VehicleSilhouette
              vehicleType={vehicleType}
              width={frameWidth * 0.7}
              color={frameColor}
            />
          </View>
        ) : null}
        <Text
          style={styles.frameHint}
          onLayout={(event: LayoutChangeEvent) =>
            setHintHeight(event.nativeEvent.layout.height)
          }
        >
          Fit the whole vehicle and the ground around it inside the frame.
        </Text>
      </View>
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
          },
        ]}
      >
        <View style={styles.messages} accessibilityLiveRegion="polite">
          {messages.length > 0 ? (
            messages.map((message) => (
              <Text key={message} style={styles.message}>
                {message}
              </Text>
            ))
          ) : (
            <Text style={styles.message}>
              {guidance.ready
                ? 'Ready. Take the photo.'
                : 'Checking the image. Hold the phone steady.'}
            </Text>
          )}
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <Text style={styles.disclaimer}>
            Checks image quality only. Vehicle detection and the parking result
            are not available yet.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: !canCapture }}
          disabled={!canCapture}
          onPress={capturePhoto}
          style={[styles.shutter, !canCapture && styles.shutterDisabled]}
        >
          <View
            style={[
              styles.shutterInner,
              !canCapture && styles.shutterInnerDisabled,
            ]}
          />
        </Pressable>
      </View>
    </View>
  );
}

export function CaptureScreen({ vehicleType, onClose }: CaptureScreenProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Android reports a never-requested permission as 'denied', so only iOS can
  // restore the denied state on mount. On Android, a permanently denied request
  // resolves to false at once and then shows the Settings path.
  const [permissionDenied, setPermissionDenied] = useState(
    () =>
      Platform.OS === 'ios' && Camera.getCameraPermissionStatus() === 'denied'
  );
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      }
    );
    return () => subscription.remove();
  }, [onClose]);

  async function handlePermissionRequest() {
    try {
      setPermissionDenied(!(await requestPermission()));
    } catch {
      setPermissionDenied(true);
    }
  }

  return (
    <>
      <StatusBar barStyle="light-content" />
      {/* Unmounting capture while inactive gives each session a fresh guidance
          history; late results from the old frame processor reach only the
          unmounted instance. */}
      {hasPermission ? (
        active ? (
          <CameraCapture vehicleType={vehicleType} onClose={onClose} />
        ) : (
          <View style={styles.screen}>
            <CaptureHeader
              title={captureTitle(vehicleType)}
              onClose={onClose}
            />
          </View>
        )
      ) : (
        <PermissionPrompt
          title={captureTitle(vehicleType)}
          denied={permissionDenied}
          onClose={onClose}
          onRequest={handlePermissionRequest}
        />
      )}
    </>
  );
}

function PermissionPrompt({
  title,
  denied,
  onClose,
  onRequest,
}: {
  title: string;
  denied: boolean;
  onClose: () => void;
  onRequest: () => void;
}) {
  return (
    <View style={styles.screen}>
      <CaptureHeader title={title} onClose={onClose} />
      <View style={styles.centered}>
        <Text style={styles.stateText}>
          {denied
            ? 'Camera access is turned off. Turn it on in Settings to take the parking photo.'
            : 'Camera access is needed to take the parking photo.'}
        </Text>
        {denied ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openSettings().catch(() => undefined)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onRequest}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'black',
  },
  header: {
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  iconButtonOn: {
    backgroundColor: 'white',
  },
  iconText: {
    color: 'white',
    fontSize: 20,
  },
  torchText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  torchTextOn: {
    color: 'black',
  },
  title: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
  },
  frameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideFrame: {
    aspectRatio: 4 / 3,
    borderWidth: 3,
    borderRadius: 20,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameHint: {
    color: 'white',
    marginTop: GUIDE_FRAME_HINT_GAP,
    paddingHorizontal: GUIDE_FRAME_HORIZONTAL_MARGIN,
    textAlign: 'center',
    textShadowColor: 'black',
    textShadowRadius: 4,
  },
  footer: {
    alignItems: 'center',
    gap: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  messages: {
    alignSelf: 'stretch',
    gap: 4,
  },
  message: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  status: {
    color: READY_COLOR,
    textAlign: 'center',
  },
  disclaimer: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    textAlign: 'center',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  shutterInnerDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  stateText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  primaryButtonText: {
    color: 'black',
    fontSize: 16,
    fontWeight: '600',
  },
});
