import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
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
import type { Frame } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_AUTO_CAPTURE_HOLD_MS,
  copyDetectorResult,
  createDetectorAsyncRunner,
  createParkingDetector,
  createParkingFrameAnalyzer,
  screenRectToFrameBox,
  useParkingGuidance,
} from 'react-native-parking-guide';
import type {
  DetectorFrameResult,
  ScreenRect,
  Size,
  VehicleType,
} from 'react-native-parking-guide';

import { decideGuidanceAnnouncement } from './announcements';
import type { GuidanceAnnouncement } from './announcements';
import {
  captureDisclaimer,
  captureMessages,
  captureTitle,
  guidanceLines,
  shutterHint,
} from './captureCopy';
import type { CapturedPhoto } from './parkingResult';
import {
  GUIDE_FRAME_HINT_GAP,
  GUIDE_FRAME_HORIZONTAL_MARGIN,
  fitGuideFrameWidth,
  frameSizeChange,
  usableGuideBox,
} from './guideFrameLayout';
import { VehicleSilhouette } from './VehicleSilhouette';

const READY_COLOR = '#34C759';
const IDLE_COLOR = 'rgba(255, 255, 255, 0.9)';

interface CaptureScreenProps {
  vehicleType: VehicleType;
  /** The detector model URI, or undefined to check image quality only. */
  modelUri: string | undefined;
  onClose: () => void;
  /** Called with each photo taken; the caller shows the parking result. */
  onCaptured: (photo: CapturedPhoto) => void;
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

/**
 * Announces the first guidance line to VoiceOver when it changes, at most once per interval
 * (`decideGuidanceAnnouncement`). Android reads the guidance through `accessibilityLiveRegion` instead.
 */
function useGuidanceAnnouncement(line: string | null) {
  const lastRef = useRef<GuidanceAnnouncement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'ios' || line === null) {
      return;
    }
    const announce = () => {
      lastRef.current = { line, at: Date.now() };
      AccessibilityInfo.announceForAccessibility(line);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const decision = decideGuidanceAnnouncement(
      lastRef.current,
      line,
      Date.now(),
    );
    if (decision.kind === 'announce') {
      announce();
    } else if (decision.kind === 'wait') {
      // Announce when the wait ends instead of deciding again, so a clock that went backwards delays the line by
      // `delayMs` only.
      timer = setTimeout(announce, decision.delayMs);
    }
    // A newer line cancels the pending announcement of this one.
    return () => clearTimeout(timer);
  }, [line]);
}

function CameraCapture({
  vehicleType,
  modelUri,
  onClose,
  onCaptured,
}: CaptureScreenProps) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('back');
  const [torchOn, setTorchOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState('');
  const [frameArea, setFrameArea] = useState<ScreenRect | null>(null);
  const [guideRect, setGuideRect] = useState<ScreenRect | null>(null);
  const [cameraView, setCameraView] = useState<Size | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const frameSizeRef = useRef<Size | null>(null);
  const [hintHeight, setHintHeight] = useState<number | null>(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const insets = useSafeAreaInsets();
  const detectorConfigured = modelUri !== undefined;
  // The guide frame in camera-frame coordinates, once the layouts and the first detection's frame size are known.
  const guideFrame =
    frameArea && guideRect && cameraView && frameSize
      ? usableGuideBox(
          screenRectToFrameBox(
            {
              x: frameArea.x + guideRect.x,
              y: frameArea.y + guideRect.y,
              width: guideRect.width,
              height: guideRect.height,
            },
            cameraView,
            frameSize,
          ),
        )
      : undefined;
  const guidance = useParkingGuidance({
    detection: detectorConfigured ? { guideFrame, vehicleType } : undefined,
    autoCapture:
      detectorConfigured && autoCapture
        ? { holdMs: DEFAULT_AUTO_CAPTURE_HOLD_MS }
        : undefined,
  });
  const { onFrameResult, onDetectorResult, reset: resetGuidance } = guidance;
  const analyze = useMemo(
    () => createParkingFrameAnalyzer(VisionCameraProxy),
    [],
  );
  const detect = useMemo(
    () =>
      modelUri === undefined
        ? undefined
        : createParkingDetector(VisionCameraProxy, { modelUri }),
    [modelUri],
  );
  const runDetection = useMemo(
    () => createDetectorAsyncRunner<Frame>(Worklets),
    [],
  );
  const deliver = useMemo(
    () => Worklets.createRunOnJS(onFrameResult),
    [onFrameResult],
  );
  const deliverDetection = useMemo(
    () =>
      Worklets.createRunOnJS((delivered: DetectorFrameResult) => {
        // The worklet delivers a host object; read a plain copy.
        const result = copyDetectorResult(delivered);
        const previous = frameSizeRef.current;
        const changed = frameSizeChange(previous, result);
        if (changed !== null) {
          // This result was mapped against the guide frame for the old size; drop it and let the next one count.
          frameSizeRef.current = changed;
          setFrameSize(changed);
          if (previous !== null) {
            // After a rotation, the previous detection and the auto-capture hold describe the old orientation.
            resetGuidance();
          }
          return;
        }
        onDetectorResult(result);
      }),
    [onDetectorResult, resetGuidance],
  );
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(5, () => {
        'worklet';
        deliver(analyze(frame));
      });
      if (detect !== undefined) {
        // Not VisionCamera's runAsync, which loses its worklet context (README "Live detector guidance").
        runAtTargetFps(2, () => {
          'worklet';
          runDetection(frame, () => {
            'worklet';
            deliverDetection(detect(frame));
          });
        });
      }
    },
    [analyze, deliver, detect, deliverDetection, runDetection],
  );
  const { autoCaptureDue, acknowledgeAutoCapture } = guidance;
  // Holds the latest capturePhoto, which is declared after the early return below.
  const captureRef = useRef<() => Promise<void>>(async () => undefined);
  // A photo that finishes after the rider closed capture belongs to no session; capturePhoto drops it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (autoCaptureDue) {
      acknowledgeAutoCapture();
      captureRef.current();
    }
  }, [autoCaptureDue, acknowledgeAutoCapture]);
  const lines = guidanceLines(
    captureMessages(guidance.issues, guidance.detectorError),
    guidance.ready,
  );
  // Without a camera the screen shows no guidance.
  useGuidanceAnnouncement(device ? lines[0]! : null);

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
      const photo = await camera.current.takePhoto({ flash: 'off' });
      if (mountedRef.current) {
        onCaptured({ path: photo.path, guideFrame });
      }
    } catch {
      setStatus('Could not take the photo. Try again.');
    } finally {
      setCapturing(false);
    }
  }

  captureRef.current = capturePhoto;

  return (
    <View
      style={styles.screen}
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setCameraView({ width, height });
      }}
    >
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
          const { x, y, width, height } = event.nativeEvent.layout;
          setFrameArea({ x, y, width, height });
        }}
      >
        {frameWidth > 0 ? (
          <View
            style={[
              styles.guideFrame,
              // Readiness is shown by the border style and the label too, not by color alone.
              guidance.ready ? styles.guideFrameReady : styles.guideFrameIdle,
              { width: frameWidth, borderColor: frameColor },
            ]}
            onLayout={(event: LayoutChangeEvent) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              setGuideRect({ x, y, width, height });
            }}
          >
            {guidance.ready ? (
              // Screen readers get readiness from the guidance line, so the visual label is hidden from them.
              <Text
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.readyLabel}
              >
                Ready
              </Text>
            ) : null}
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
          {lines.map((line) => (
            <Text key={line} style={styles.message}>
              {line}
            </Text>
          ))}
          {status ? <Text style={styles.status}>{status}</Text> : null}
          {detectorConfigured ? (
            <View style={styles.autoCapture}>
              <Text style={styles.status}>Auto capture</Text>
              <Switch
                accessibilityLabel="Auto capture"
                value={autoCapture}
                onValueChange={setAutoCapture}
              />
            </View>
          ) : null}
          <Text style={styles.disclaimer}>
            {captureDisclaimer(detectorConfigured)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityHint={shutterHint(canCapture, capturing)}
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

export function CaptureScreen({
  vehicleType,
  modelUri,
  onClose,
  onCaptured,
}: CaptureScreenProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Android reports a never-requested permission as 'denied', so only iOS can
  // restore the denied state on mount. On Android, a permanently denied request
  // resolves to false at once and then shows the Settings path.
  const [permissionDenied, setPermissionDenied] = useState(
    () =>
      Platform.OS === 'ios' && Camera.getCameraPermissionStatus() === 'denied',
  );
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
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
          <CameraCapture
            vehicleType={vehicleType}
            modelUri={modelUri}
            onClose={onClose}
            onCaptured={onCaptured}
          />
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideFrameReady: {
    borderStyle: 'solid',
  },
  guideFrameIdle: {
    borderStyle: 'dashed',
  },
  readyLabel: {
    position: 'absolute',
    top: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: READY_COLOR,
    color: 'black',
    fontSize: 14,
    fontWeight: '700',
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
  autoCapture: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
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
