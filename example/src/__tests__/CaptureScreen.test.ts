import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { isValidElement, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AppState, BackHandler, Platform } from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';

import App from '../App';
import { CaptureScreen } from '../CaptureScreen';
import { ResultScreen } from '../ResultScreen';
import {
  CAPTURE_VEHICLE_TYPES,
  captureDisclaimer,
  captureMessages,
  captureTitle,
  guidanceMessages,
  vehicleLabel,
} from '../captureCopy';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  BackHandler: { addEventListener: jest.fn() },
  Platform: { OS: 'ios' },
  StatusBar: {},
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));

const mockStateSetters: jest.Mock[] = [];

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
  useState: (initial: unknown) => {
    const setter = jest.fn();
    mockStateSetters.push(setter);
    return [typeof initial === 'function' ? initial() : initial, setter];
  },
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: { getCameraPermissionStatus: jest.fn() },
  useCameraPermission: jest.fn(() => ({
    hasPermission: false,
    requestPermission: jest.fn(),
  })),
}));

jest.mock('react-native-worklets-core', () => ({}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock(
  'react-native-parking-guide',
  () => ({
    ...jest.requireActual<object>('../../../src/feedback/feedback'),
    // App imports the result screen, whose demo policy spreads defaultPolicy at module load.
    ...jest.requireActual<object>('../../../src/policy/defaultPolicy'),
  }),
  { virtual: true }
);

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(useEffect).mockClear();
  mockStateSetters.length = 0;
  Platform.OS = 'ios';
  AppState.currentState = 'active';
});

function componentNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(componentNames);
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return [];
  }
  const own = typeof node.type === 'function' ? [node.type.name] : [];
  return [...own, ...componentNames(node.props.children)];
}

// Renders hook-free function components so their text is visible to assertions.
function expand(node: ReactNode): unknown {
  if (Array.isArray(node)) {
    return node.map(expand);
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return node;
  }
  if (typeof node.type === 'function') {
    return expand((node.type as (props: unknown) => ReactNode)(node.props));
  }
  return { type: node.type, children: expand(node.props.children) };
}

function renderPermissionScreen() {
  return JSON.stringify(
    expand(
      CaptureScreen({
        vehicleType: 'kickboard',
        onClose: () => undefined,
        onCaptured: () => undefined,
      })
    )
  );
}

describe('example capture copy', () => {
  it('titles the capture screen per vehicle type', () => {
    expect(CAPTURE_VEHICLE_TYPES.map(captureTitle)).toEqual([
      'Take a photo of the kickboard',
      'Take a photo of the bicycle',
      'Take a photo of the e-bike',
      'Take a photo of the motorcycle',
    ]);
    expect(captureTitle('auto')).toBe('Take a photo of the vehicle');
    expect(CAPTURE_VEHICLE_TYPES.map(vehicleLabel)).toEqual([
      'Kickboard',
      'Bicycle',
      'E-bike',
      'Motorcycle',
    ]);
  });

  it('explains a detector failure instead of reporting no vehicle', () => {
    expect(captureMessages([], 'E_MODEL_LOAD')).toEqual([
      'The parking model could not run.',
    ]);
    expect(captureMessages(['BLURRY'], 'E_INFERENCE')).toEqual([
      'The parking model could not run.',
      'Hold the phone steady.',
    ]);
    expect(captureMessages(['NO_VEHICLE'], null)).toEqual(
      guidanceMessages(['NO_VEHICLE'])
    );
  });

  it('describes what the capture screen checks', () => {
    expect(captureDisclaimer(false)).toBe(
      'Checks image quality only. Vehicle detection and the parking result need a detector model.'
    );
    expect(captureDisclaimer(true)).toBe(
      'Checks image quality and vehicle placement with the configured model, then shows a parking result for the photo.'
    );
  });

  it('uses the library default text for guidance issues', () => {
    expect(guidanceMessages([])).toEqual([]);
    expect(guidanceMessages(['BLURRY', 'TILTED'])).toEqual([
      'Hold the phone upright and straight.',
      'Hold the phone steady.',
    ]);
  });
});

describe('example home screen', () => {
  it('offers every capture vehicle type', () => {
    const screen = JSON.stringify(expand(App()));
    for (const label of ['Kickboard', 'Bicycle', 'E-bike', 'Motorcycle']) {
      expect(screen).toContain(label);
    }
  });
});

describe('example result screen', () => {
  it('shows a checking state with retake and done before the result arrives', () => {
    const screen = JSON.stringify(
      expand(
        ResultScreen({
          vehicleType: 'kickboard',
          photo: { path: '/tmp/photo.jpg', guideFrame: undefined },
          onRetake: () => undefined,
          onDone: () => undefined,
        })
      )
    );
    expect(screen).toContain('Checking your parking…');
    expect(screen).toContain('Retake');
    expect(screen).toContain('Done');
  });
});

describe('example camera permission on cold start', () => {
  it.each([
    { os: 'ios', status: 'denied', denied: true },
    { os: 'ios', status: 'not-determined', denied: false },
    // Android reports a never-requested permission as 'denied'.
    { os: 'android', status: 'denied', denied: false },
  ] as const)(
    'shows the right prompt for $status on $os',
    ({ os, status, denied }) => {
      Platform.OS = os;
      jest.mocked(Camera.getCameraPermissionStatus).mockReturnValue(status);

      const screen = renderPermissionScreen();

      expect(screen).toContain('Take a photo of the kickboard');
      if (denied) {
        expect(screen).toContain(
          'Camera access is turned off. Turn it on in Settings to take the parking photo.'
        );
        expect(screen).toContain('Open Settings');
        expect(screen).not.toContain('Allow camera');
      } else {
        expect(screen).toContain(
          'Camera access is needed to take the parking photo.'
        );
        expect(screen).toContain('Allow camera');
        expect(screen).not.toContain('Open Settings');
      }
    }
  );
});

describe('example capture lifecycle', () => {
  it.each([
    { state: 'active', mounted: true },
    { state: 'background', mounted: false },
    { state: 'inactive', mounted: false },
  ] as const)(
    'mounts the camera only while the app is active ($state)',
    ({ state, mounted }) => {
      AppState.currentState = state;
      jest.mocked(useCameraPermission).mockReturnValueOnce({
        hasPermission: true,
        requestPermission: jest.fn(async () => true),
      });

      const names = componentNames(
        CaptureScreen({
          vehicleType: 'kickboard',
          onClose: () => undefined,
          onCaptured: () => undefined,
        })
      );

      expect(names.includes('CameraCapture')).toBe(mounted);
      expect(names).not.toContain('PermissionPrompt');
      expect(names).toContain(mounted ? 'CameraCapture' : 'CaptureHeader');
    }
  );
});

describe('example capture AppState subscription', () => {
  it('tracks AppState changes and removes the listener on unmount', () => {
    const remove = jest.fn();
    let listener: ((state: string) => void) | undefined;
    jest
      .mocked(AppState.addEventListener)
      .mockImplementation((_type, handler) => {
        listener = handler as (state: string) => void;
        return { remove };
      });
    jest
      .mocked(BackHandler.addEventListener)
      .mockReturnValue({ remove: jest.fn() });

    CaptureScreen({
      vehicleType: 'kickboard',
      onClose: () => undefined,
      onCaptured: () => undefined,
    });
    // CaptureScreen calls useState for permissionDenied, then for active.
    const setActive = mockStateSetters[1]!;
    const cleanups = jest
      .mocked(useEffect)
      .mock.calls.map(([effect]) => effect());

    expect(AppState.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
    for (const [state, active] of [
      ['background', false],
      ['active', true],
      ['inactive', false],
    ] as const) {
      setActive.mockClear();
      listener!(state);
      expect(setActive).toHaveBeenCalledWith(active);
    }

    for (const cleanup of cleanups) {
      cleanup?.();
    }
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
