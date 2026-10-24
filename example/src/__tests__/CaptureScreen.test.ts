import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { isValidElement } from 'react';
import type { ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';

import App from '../App';
import { CaptureScreen } from '../CaptureScreen';
import {
  CAPTURE_VEHICLE_TYPES,
  captureTitle,
  guidanceMessages,
  vehicleLabel,
} from '../captureCopy';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  BackHandler: {},
  Platform: { OS: 'ios' },
  StatusBar: {},
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    jest.fn(),
  ],
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
    getModelVersion: () => '0.1.0-dev',
  }),
  { virtual: true }
);

afterEach(() => {
  jest.restoreAllMocks();
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
      CaptureScreen({ vehicleType: 'kickboard', onClose: () => undefined })
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
    expect(screen).toContain('Model version: ');
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
        CaptureScreen({ vehicleType: 'kickboard', onClose: () => undefined })
      );

      expect(names.includes('CameraCapture')).toBe(mounted);
      expect(names).not.toContain('PermissionPrompt');
      expect(names).toContain(mounted ? 'CameraCapture' : 'CaptureHeader');
    }
  );
});
