/* eslint-env jest */

// Official Jest mock for AsyncStorage (native module isn't available under Jest's
// Node.js test environment — the same reason libraries backed by other native
// modules would need a mock here too, should tests grow to touch them).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// @livekit/react-native(-webrtc) register real native modules (camera, mic,
// audio session, event emitters) at import time, which don't exist under
// Jest's plain Node test environment — there is no device/simulator here.
// Actually exercising LiveKit's media behavior belongs to an on-device E2E
// suite (Detox — see docs/roadmap.md), not this unit-test smoke test, so it's
// stubbed rather than faked as "working": these mocks only exist to let
// component trees that reference LiveKit render in Jest without crashing.
jest.mock('@livekit/react-native', () => ({
  registerGlobals: jest.fn(),
  LiveKitRoom: ({ children }) => children ?? null,
  useTracks: () => [],
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: jest.fn(), setCameraEnabled: jest.fn() },
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
  }),
  isTrackReference: () => false,
  VideoTrack: () => null,
  VideoView: () => null,
}));

// `livekit-client` (the core package @livekit/react-native wraps) is imported
// directly by PreJoinScreen for createLocalVideoTrack — a real getUserMedia
// call with no equivalent under Jest's Node environment (no device/camera).
// Same "stub so component trees can render, not fake device behavior" rule
// as the mock above.
jest.mock('livekit-client', () => ({
  createLocalVideoTrack: jest.fn(() => Promise.reject(new Error('no camera in test environment'))),
}));
