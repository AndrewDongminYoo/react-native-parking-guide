import { useEffect, useMemo, useState } from 'react';
import { AppState, Button, Text, View, StyleSheet } from 'react-native';
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

const modelVersion = getModelVersion();

function CaptureGuidance() {
  const device = useCameraDevice('back');
  const guidance = useParkingGuidance();
  const { onFrameResult } = guidance;
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

  if (!device) {
    return <Text>No back camera is available on this device.</Text>;
  }
  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        device={device}
        isActive
        pixelFormat="yuv"
        frameProcessor={frameProcessor}
      />
      <Text>Image quality ready: {String(guidance.ready)}</Text>
      <Text>Issues: {guidance.issues.join(', ') || 'None'}</Text>
      <Text>Progress: {guidance.progress.toFixed(2)}</Text>
      <Text>Image quality only; no vehicle detection or parking verdict.</Text>
    </View>
  );
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [capturing, setCapturing] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state !== 'active') {
        setCapturing(false);
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <Text>Model Version: {modelVersion}</Text>
      {!hasPermission ? (
        <Button
          title="Allow camera"
          onPress={() => {
            requestPermission();
          }}
        />
      ) : (
        <>
          <Button
            title={capturing ? 'Stop capture' : 'Start capture'}
            onPress={() => setCapturing((previous) => !previous)}
          />
          {capturing && active ? <CaptureGuidance /> : null}
        </>
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
  camera: {
    width: 280,
    height: 360,
  },
});
