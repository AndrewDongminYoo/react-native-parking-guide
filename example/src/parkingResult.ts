import {
  decodeDetectorOutput,
  defaultPolicy,
  evaluatePolicy,
  getParkingFeedback,
  mapModelOutput,
  runDetector,
} from 'react-native-parking-guide';
import type {
  ModelBox,
  ParkingPolicy,
  Verdict,
  VehicleType,
} from 'react-native-parking-guide';

/**
 * `defaultPolicy` without the two rules that a detector alone cannot evaluate: no uprightness classifier exists yet,
 * and the detector reports no image quality. With them enabled, `UPRIGHT` is always unknown (score 0) and hard-fails
 * every photo. The result screen labels this with `DEMO_POLICY_NOTE`.
 */
export const DEMO_POLICY: ParkingPolicy = {
  ...defaultPolicy,
  rules: {
    ...defaultPolicy.rules,
    UPRIGHT: { ...defaultPolicy.rules.UPRIGHT, enabled: false },
    IMAGE_QUALITY: { ...defaultPolicy.rules.IMAGE_QUALITY, enabled: false },
  },
};

export const DEMO_POLICY_NOTE =
  'Uprightness and image quality are not checked in this demo.';

export interface CapturedPhoto {
  /** `PhotoFile.path` from VisionCamera `takePhoto()`. */
  path: string;
  /** The guide frame in upright camera-frame coordinates at capture time, if known. */
  guideFrame: ModelBox | undefined;
}

export type ParkingJudgment =
  | { kind: 'noModel' }
  | { kind: 'error'; code: string }
  | { kind: 'verdict'; verdict: Verdict; score: number; reasons: string[] };

type Detect = typeof runDetector;

/**
 * Runs the configured detector on the photo and judges it with `DEMO_POLICY`. Detector rejections keep their native
 * code; an output that `decodeDetectorOutput` or `mapModelOutput` rejects is `E_MODEL_CONTRACT`, as in live detection.
 */
export async function judgeParking(
  photo: CapturedPhoto,
  vehicleType: VehicleType,
  modelUri: string | undefined,
  detect: Detect = runDetector
): Promise<ParkingJudgment> {
  if (modelUri === undefined) {
    return { kind: 'noModel' };
  }
  let output;
  try {
    output = await detect(photo.path, modelUri);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      kind: 'error',
      code: typeof code === 'string' ? code : 'E_INFERENCE',
    };
  }
  let rules;
  try {
    rules = mapModelOutput(decodeDetectorOutput(output), {
      vehicleType,
      guideFrame: photo.guideFrame,
    });
  } catch {
    return { kind: 'error', code: 'E_MODEL_CONTRACT' };
  }
  const { verdict, score } = evaluatePolicy(rules, DEMO_POLICY);
  const reasons = getParkingFeedback({ rules }, { policy: DEMO_POLICY }).map(
    (feedback) => feedback.text
  );
  return { kind: 'verdict', verdict, score, reasons };
}

const RESULT_TITLES: Record<Verdict, string> = {
  PASS: 'Parked correctly',
  WARN: 'Check your parking',
  FAIL: 'Park again',
};

export function resultTitle(verdict: Verdict): string {
  return RESULT_TITLES[verdict];
}

/** Feedback text for the result screen, or a single line when no rule failed or warned. */
export function resultReasons(reasons: readonly string[]): string[] {
  return reasons.length > 0 ? [...reasons] : ['No problems found.'];
}
