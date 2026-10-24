import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';

import App from '../App';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles },
  Button: 'Button',
  Text: 'Text',
  View: 'View',
}));

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: jest.fn(),
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    jest.fn(),
  ],
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: { getCameraPermissionStatus: jest.fn() },
  useCameraPermission: () => ({
    hasPermission: false,
    requestPermission: jest.fn(),
  }),
}));

jest.mock('react-native-worklets-core', () => ({}));

jest.mock(
  'react-native-parking-guide',
  () => ({
    getModelVersion: () => '0.1.0-dev',
  }),
  { virtual: true }
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('example camera permission on cold start', () => {
  it.each([
    { status: 'denied', denied: true },
    { status: 'not-determined', denied: false },
  ] as const)('restores the $status state', ({ status, denied }) => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(Camera.getCameraPermissionStatus).mockReturnValue(status);

    const screen = JSON.stringify(App());

    if (denied) {
      expect(screen).toContain(
        'Camera access was denied. Enable camera access in Settings to use capture guidance.'
      );
      expect(screen).toContain('Open Settings');
      expect(screen).not.toContain('Allow camera');
    } else {
      expect(screen).toContain(
        'Camera access is required to show capture guidance.'
      );
      expect(screen).toContain('Allow camera');
      expect(screen).not.toContain('Open Settings');
    }
  });
});
