import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Button,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import {
  createParkingFrameAnalyzer,
  getModelVersion,
  useParkingGuidance,
} from 'react-native-parking-guide';
import { GUIDANCE_ISSUE_MESSAGES } from './guidanceMessages';

const modelVersion = getModelVersion();

function CaptureGuidance({ active }: { active: boolean }) {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('back');
  const guidance = useParkingGuidance();
  const { onFrameResult, reset } = guidance;
  const [captureMessage, setCaptureMessage] = useState('');
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

  useEffect(() => {
    if (!active) {
      reset();
    }
  }, [active, reset]);

  async function capturePhoto() {
    if (!guidance.ready || camera.current == null) {
      return;
    }

    try {
      await camera.current.takePhoto();
      setCaptureMessage('Photo captured.');
    } catch {
      setCaptureMessage('Unable to capture photo. Try again.');
    }
  }

  if (!device) {
    return <Text>No back camera is available on this device.</Text>;
  }

  return (
    <View style={styles.captureContainer}>
      <Camera
        ref={camera}
        style={styles.camera}
        device={device}
        isActive={active}
        photo
        pixelFormat="yuv"
        frameProcessor={frameProcessor}
      />
      <View style={styles.guidanceOverlay}>
        <Text style={styles.guidanceTitle}>
          {guidance.ready ? 'Ready to capture' : 'Capture guidance'}
        </Text>
        {guidance.issues.length > 0 ? (
          guidance.issues.map((issue) => (
            <Text key={issue} style={styles.guidanceMessage}>
              {GUIDANCE_ISSUE_MESSAGES[issue]}
            </Text>
          ))
        ) : (
          <Text style={styles.guidanceMessage}>
            {guidance.ready
              ? 'Image quality is ready.'
              : 'Checking image quality. Hold the camera steady.'}
          </Text>
        )}
        <Text style={styles.progress}>
          Readiness: {Math.round(guidance.progress * 100)}%
        </Text>
        <Text style={styles.disclaimer}>
          Image quality only; no vehicle detection or parking verdict.
        </Text>
      </View>
      <View style={styles.captureControls}>
        <Button
          title="Capture photo"
          onPress={capturePhoto}
          disabled={!guidance.ready}
        />
        {captureMessage ? <Text>{captureMessage}</Text> : null}
      </View>
    </View>
  );
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [permissionDenied, setPermissionDenied] = useState(
    () => Camera.getCameraPermissionStatus() === 'denied'
  );
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => subscription.remove();
  }, []);

  async function handlePermissionRequest() {
    try {
      setPermissionDenied(!(await requestPermission()));
    } catch {
      setPermissionDenied(true);
    }
  }

  return (
    <View style={styles.container}>
      <Text>Model version: {modelVersion}</Text>
      {Platform.OS !== 'ios' ? (
        <Text>Live capture guidance is currently available on iOS only.</Text>
      ) : !hasPermission ? (
        <View style={styles.permissionState}>
          <Text>
            {permissionDenied
              ? 'Camera access was denied. Enable camera access in Settings to use capture guidance.'
              : 'Camera access is required to show capture guidance.'}
          </Text>
          {permissionDenied ? (
            <Button
              title="Open Settings"
              onPress={() => Linking.openSettings().catch(() => undefined)}
            />
          ) : (
            <Button title="Allow camera" onPress={handlePermissionRequest} />
          )}
        </View>
      ) : (
        <CaptureGuidance active={active} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionState: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  captureContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  camera: {
    width: '100%',
    height: '75%',
  },
  guidanceOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  guidanceTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  guidanceMessage: {
    color: 'white',
    marginTop: 6,
  },
  progress: {
    color: 'white',
    marginTop: 6,
  },
  disclaimer: {
    color: 'white',
    fontSize: 12,
    marginTop: 6,
  },
  captureControls: {
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
});
