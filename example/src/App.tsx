import { useCallback, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { getModelVersion } from 'react-native-parking-guide';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type { VehicleType } from 'react-native-parking-guide';

import { CaptureScreen } from './CaptureScreen';
import { CAPTURE_VEHICLE_TYPES, vehicleLabel } from './captureCopy';

const modelVersion = getModelVersion();

export default function App() {
  return (
    <SafeAreaProvider>
      <Home />
    </SafeAreaProvider>
  );
}

function Home() {
  const insets = useSafeAreaInsets();
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const close = useCallback(() => setVehicleType(null), []);

  if (vehicleType) {
    return <CaptureScreen vehicleType={vehicleType} onClose={close} />;
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
        },
      ]}
    >
      <StatusBar barStyle="dark-content" />
      <Text accessibilityRole="header" style={styles.title}>
        End your ride
      </Text>
      <Text style={styles.subtitle}>
        Choose the vehicle you rode, then take a photo of where you parked it.
      </Text>
      <View style={styles.choices}>
        {CAPTURE_VEHICLE_TYPES.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            onPress={() => setVehicleType(type)}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
          >
            <Text style={styles.choiceText}>{vehicleLabel(type)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.version}>Model version: {modelVersion}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: 'white',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: 'black',
  },
  subtitle: {
    fontSize: 16,
    color: '#3C3C43',
  },
  choices: {
    gap: 12,
  },
  choice: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
  },
  pressed: {
    opacity: 0.6,
  },
  choiceText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'black',
  },
  version: {
    fontSize: 12,
    color: '#8E8E93',
  },
});
