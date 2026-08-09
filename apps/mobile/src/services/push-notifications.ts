/**
 * Push notification abstraction — architecture only, not wired to a live provider.
 *
 * The intended shape (per docs/roadmap.md Stage 5 follow-up):
 *   - Android: @react-native-firebase/app + @react-native-firebase/messaging,
 *     requiring a real `google-services.json` dropped into android/app/. Adding
 *     the Firebase Gradle plugin without that file present breaks the native
 *     build for everyone who clones the repo, so it is intentionally NOT added
 *     as a dependency yet — see the note in apps/mobile/README (if/when
 *     credentials exist, wire it here and register android/app/google-services.json
 *     as gitignored).
 *   - iOS: native APNs via the same @react-native-firebase/messaging module (it
 *     wraps APNs registration) or a bare `PushNotificationIOS` setup, needing an
 *     Apple Push Notification key configured in the Apple Developer portal and
 *     forwarded to FCM (or used directly with a raw APNs provider).
 *   - Server side: `devices.pushToken` (see packages/database/prisma/schema.prisma)
 *     already exists to store the token this module would obtain, and
 *     `notifications` rows are already tagged with a PUSH channel — the gap is
 *     purely "obtain a device token and register it", not the data model.
 *
 * Until a real provider is wired in, this module is a documented no-op so the
 * rest of the app can call it without runtime crashes and without pretending
 * push notifications work when they don't.
 */
export interface PushNotificationService {
  /** Requests OS-level notification permission. Returns whether it was granted. */
  requestPermission(): Promise<boolean>;
  /** Obtains a device push token and registers it against `POST /users/me/devices`
   * (not yet implemented on the API — tracked alongside this). */
  registerDevice(): Promise<string | null>;
  /** Unregisters the current device's push token (e.g. on logout). */
  unregisterDevice(): Promise<void>;
}

class NoopPushNotificationService implements PushNotificationService {
  async requestPermission(): Promise<boolean> {
    console.warn(
      '[push-notifications] Not configured — see apps/mobile/src/services/push-notifications.ts',
    );
    return false;
  }

  async registerDevice(): Promise<string | null> {
    return null;
  }

  async unregisterDevice(): Promise<void> {
    // no-op
  }
}

export const pushNotifications: PushNotificationService = new NoopPushNotificationService();
