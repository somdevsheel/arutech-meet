/**
 * @format
 */

// Must run before any LiveKit/WebRTC code executes anywhere in the app —
// registers the native WebRTC globals (RTCPeerConnection, mediaDevices, ...)
// that livekit-client expects to find, same as calling registerGlobals() would
// on web via the browser providing them natively.
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
