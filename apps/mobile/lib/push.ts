// Registering this phone for a content-free ping.
//
// WHAT ARRIVES IS "Something needs you. Open to see." AND NOTHING ELSE — no category, no figure, no
// merchant. That is the owner's decision, recorded in `plan/tasks/P3-25-push-ping/DECISION.md`,
// because a notification lands on a lock screen readable without unlocking the phone and travels
// through two intermediaries email does not have. The real content is fetched over the tailnet when
// the app opens.
//
// Nothing here chooses the text. The server holds it as a constant; this file only asks iOS for
// permission and hands the resulting address to the server.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { authedPost } from './api';

export type PushStatus =
  | { state: 'registered' }
  | { state: 'denied' }
  | { state: 'unsupported'; why: string }
  | { state: 'failed'; why: string };

/**
 * Ask for permission, get the token, tell the server.
 *
 * PERMISSION IS ASKED FOR ONCE BY IOS AND REMEMBERED FOREVER. A denied prompt cannot be re-asked
 * from inside the app — only in Settings — so this is called deliberately from a button the owner
 * taps, never on first launch. An app that asks before it has shown why gets denied, and then the
 * feature is gone until somebody finds the Settings screen.
 */
export async function registerForPing(label: string): Promise<PushStatus> {
  // A simulator has no APNs registration to give. Expo Go on a real device does.
  if (!Device.isDevice) {
    return { state: 'unsupported', why: 'Push needs a real device; a simulator has no APNs token.' };
  }

  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return { state: 'denied' };

    if (Platform.OS === 'android') {
      // Android requires a channel to exist before anything can be delivered to it.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'b8',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // THE PROJECT ID IS PASSED EXPLICITLY, not inferred. Since SDK 49 `getExpoPushTokenAsync`
    // requires one, and in Expo Go the inference that used to cover for its absence is gone — the
    // failure is a runtime "No projectId found", which is what this app did on its first attempt.
    // Reading it from the config rather than hardcoding keeps one source of truth after `eas init`
    // wrote it into app.json.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      return { state: 'failed', why: 'No EAS projectId in app.json — run `eas init` in apps/mobile.' };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await authedPost('/api/v1/push/devices', { token, label });
    return { state: 'registered' };
  } catch (e) {
    return { state: 'failed', why: e instanceof Error ? e.message : 'Could not register for push.' };
  }
}
