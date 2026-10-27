import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Verdict, VehicleType } from 'react-native-parking-guide';

import {
  DEMO_POLICY_NOTE,
  NO_RESULT_TITLE,
  judgeParking,
  noResultDetail,
  resultAnnouncement,
  resultReasons,
  resultTitle,
  scoreText,
} from './parkingResult';
import type { CapturedPhoto, ParkingJudgment } from './parkingResult';

const VERDICT_COLORS: Record<Verdict, string> = {
  PASS: '#248A3D',
  WARN: '#B25000',
  FAIL: '#D70015',
};

interface ResultScreenProps {
  vehicleType: VehicleType;
  /** The detector model URI, or undefined when no model is configured. */
  modelUri: string | undefined;
  photo: CapturedPhoto;
  onRetake: () => void;
  onDone: () => void;
}

export function ResultScreen({
  vehicleType,
  modelUri,
  photo,
  onRetake,
  onDone,
}: ResultScreenProps) {
  const insets = useSafeAreaInsets();
  const [judgment, setJudgment] = useState<ParkingJudgment | null>(null);

  useEffect(() => {
    let current = true;
    judgeParking(photo, vehicleType, modelUri).then((result) => {
      if (current) {
        setJudgment(result);
        // accessibilityLiveRegion below is Android-only; VoiceOver needs an explicit announcement.
        // Queued, so that it does not cut off VoiceOver reading the screen that just opened.
        if (Platform.OS === 'ios') {
          AccessibilityInfo.announceForAccessibilityWithOptions(
            resultAnnouncement(result),
            { queue: true }
          );
        }
      }
    });
    return () => {
      current = false;
    };
  }, [photo, vehicleType, modelUri]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onDone();
        return true;
      }
    );
    return () => subscription.remove();
  }, [onDone]);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
        },
      ]}
    >
      <StatusBar barStyle="dark-content" />
      {/* The body scrolls so that many reasons or large text never push Retake and Done off screen. */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        accessibilityLiveRegion="polite"
      >
        <JudgmentBody judgment={judgment} />
      </ScrollView>
      <View style={styles.actions}>
        {/* Retake stays enabled while checking: the effect cleanup discards a result that arrives after leaving. */}
        <Pressable
          accessibilityRole="button"
          onPress={onRetake}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Retake</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function JudgmentBody({ judgment }: { judgment: ParkingJudgment | null }) {
  if (judgment === null) {
    return <Text style={styles.detail}>Checking your parking…</Text>;
  }
  if (judgment.kind !== 'verdict') {
    return (
      <>
        <Text accessibilityRole="header" style={styles.title}>
          {NO_RESULT_TITLE}
        </Text>
        <Text style={styles.detail}>{noResultDetail(judgment)}</Text>
      </>
    );
  }
  const score = scoreText(judgment.score);
  return (
    <>
      <Text
        style={[
          styles.verdict,
          { backgroundColor: VERDICT_COLORS[judgment.verdict] },
        ]}
      >
        {judgment.verdict}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        {resultTitle(judgment.verdict)}
      </Text>
      <Text style={styles.detail} accessibilityLabel={score.spoken}>
        {score.shown}
      </Text>
      <View style={styles.reasons}>
        {resultReasons(judgment.reasons).map((reason) => (
          <Text key={reason} style={styles.reason}>
            {reason}
          </Text>
        ))}
      </View>
      <Text style={styles.note}>{DEMO_POLICY_NOTE}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 16,
    backgroundColor: 'white',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    gap: 12,
  },
  verdict: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: 'black',
  },
  detail: {
    fontSize: 16,
    color: '#3C3C43',
  },
  reasons: {
    gap: 8,
  },
  reason: {
    fontSize: 17,
    color: 'black',
  },
  note: {
    fontSize: 13,
    color: '#6C6C70',
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
  },
  secondaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'black',
  },
  pressed: {
    opacity: 0.6,
  },
});
