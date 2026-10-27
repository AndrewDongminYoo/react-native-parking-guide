import { StyleSheet, View } from 'react-native';
import type { VehicleType } from 'react-native-parking-guide';

type Point = readonly [number, number];

interface Shape {
  readonly wheels: readonly { center: Point; radius: number }[];
  readonly segments: readonly { from: Point; to: Point; thickness?: number }[];
}

/** Silhouettes drawn in a 200 × 140 box with the vehicle facing right. */
const BOX = { width: 200, height: 140 };
const STROKE = 4;

const BICYCLE: Shape = {
  wheels: [
    { center: [45, 100], radius: 32 },
    { center: [155, 100], radius: 32 },
  ],
  segments: [
    { from: [45, 100], to: [95, 100] },
    { from: [95, 100], to: [80, 45] },
    { from: [80, 45], to: [140, 48] },
    { from: [95, 100], to: [140, 48] },
    { from: [140, 48], to: [155, 100] },
    { from: [80, 45], to: [45, 100] },
    { from: [68, 40], to: [92, 40], thickness: 6 },
    { from: [140, 48], to: [136, 28] },
    { from: [126, 28], to: [150, 28] },
  ],
};

const SHAPES: Record<VehicleType, Shape | null> = {
  kickboard: {
    wheels: [
      { center: [32, 116], radius: 16 },
      { center: [166, 116], radius: 16 },
    ],
    segments: [
      { from: [32, 108], to: [150, 108], thickness: 8 },
      { from: [162, 112], to: [142, 16] },
      { from: [126, 16], to: [160, 16] },
    ],
  },
  bicycle: BICYCLE,
  ebike: {
    wheels: BICYCLE.wheels,
    segments: [
      ...BICYCLE.segments,
      { from: [100, 90], to: [130, 56], thickness: 12 },
    ],
  },
  motorcycle: {
    wheels: [
      { center: [40, 110], radius: 26 },
      { center: [160, 110], radius: 26 },
    ],
    segments: [
      { from: [60, 82], to: [138, 82], thickness: 26 },
      { from: [52, 62], to: [108, 62], thickness: 8 },
      { from: [148, 58], to: [160, 110] },
      { from: [40, 110], to: [90, 92] },
      { from: [148, 58], to: [146, 42] },
      { from: [136, 42], to: [160, 42] },
    ],
  },
  // No silhouette until the vehicle type is detected automatically.
  auto: null,
};

export function VehicleSilhouette({
  vehicleType,
  width,
  color,
}: {
  vehicleType: VehicleType;
  width: number;
  color: string;
}) {
  const shape = SHAPES[vehicleType];
  if (!shape) {
    return null;
  }
  const scale = width / BOX.width;
  return (
    <View
      // Decorative: hidden from VoiceOver (accessibilityElementsHidden) and TalkBack (importantForAccessibility).
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width, height: BOX.height * scale }}
    >
      <View style={[styles.box, { transform: [{ scale }] }]}>
        {shape.wheels.map(({ center, radius }, index) => (
          <View
            key={`wheel-${index}`}
            style={[
              styles.wheel,
              {
                left: center[0] - radius,
                top: center[1] - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: radius,
                borderColor: color,
              },
            ]}
          />
        ))}
        {shape.segments.map(({ from, to, thickness = STROKE }, index) => {
          const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
          const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
          return (
            <View
              key={`segment-${index}`}
              style={[
                styles.segment,
                {
                  left: (from[0] + to[0]) / 2 - length / 2,
                  top: (from[1] + to[1]) / 2 - thickness / 2,
                  width: length,
                  height: thickness,
                  borderRadius: thickness / 2,
                  backgroundColor: color,
                  transform: [{ rotate: `${angle}rad` }],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BOX.width,
    height: BOX.height,
    transformOrigin: 'top left',
  },
  wheel: {
    position: 'absolute',
    borderWidth: STROKE,
  },
  segment: {
    position: 'absolute',
  },
});
