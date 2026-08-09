import { Platform } from 'react-native';

/**
 * Dev-time defaults. React Native has no `.env`/`process.env` support out of the
 * box the way Next.js does — a production app should switch this to
 * `react-native-config` (or build-flavor-specific constants) so API_URL differs
 * per environment without a code change. Not wired up yet; tracked in
 * docs/roadmap.md rather than faked here.
 *
 * The Android emulator cannot reach the host machine via `localhost` — it must
 * use the special alias `10.0.2.2`. iOS Simulator *can* use `localhost` directly.
 * A physical device needs your machine's LAN IP instead of either.
 */
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const env = {
  apiUrl: `http://${DEV_HOST}:4000`,
  wsUrl: `ws://${DEV_HOST}:4000`,
  livekitUrl: `ws://${DEV_HOST}:7880`,
};
