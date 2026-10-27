import { useEffect } from 'react';

// Brücke zur iPhone/iPad-App (mobile/, Capacitor): Push, Bildschirm bleibt an, Links aus Push und QR-Code.
// Die App lädt diese Seite live von dranzeit.de; Capacitor legt dabei window.Capacitor an. Im Browser und in der
// Android-App (Trusted Web Activity, ohne Capacitor) gibt es das nicht – dann tut hier nichts etwas, und die
// Capacitor-Pakete werden gar nicht erst geladen.

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

const capacitor = (): CapacitorGlobal | undefined =>
  typeof window === 'undefined' ? undefined : (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;

/** Läuft die Seite in der Dranzeit-App für iPhone/iPad? */
export const inNativeApp = () => capacitor()?.isNativePlatform?.() === true && capacitor()?.getPlatform?.() === 'ios';

/** Nur Wege auf dranzeit.de öffnen wir in der App, alles andere bleibt draußen */
export const pathInApp = (url: string): string | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!/^(www\.)?dranzeit\.de$/.test(parsed.hostname) && parsed.origin !== window.location.origin) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
};

/**
 * Einmal beim Start: Antippen einer Benachrichtigung (data.url aus backend/app/libs/fcm.py) und Universal Links
 * (QR-Code vom Plakat, Link in einer Mail – frontend/public/.well-known/apple-app-site-association) öffnen die
 * passende Seite in der App. Beide Ereignisse hält Capacitor fest, bis jemand zuhört – auch beim Kaltstart.
 */
export const connectNativeApp = (navigate: (path: string) => void): (() => void) => {
  if (!inNativeApp()) return () => {};
  const open = (url: unknown) => {
    const path = typeof url === 'string' ? pathInApp(url) : null;
    if (path) navigate(path);
  };
  let stopped = false;
  const handles: { remove: () => Promise<void> }[] = [];
  const keep = (handle: { remove: () => Promise<void> }) => {
    if (stopped) handle.remove().catch(() => {});
    else handles.push(handle);
  };
  import('@capacitor/app')
    .then(({ App }) => App.addListener('appUrlOpen', (event) => open(event.url)))
    .then(keep)
    .catch(() => {});
  import('@capacitor/push-notifications')
    .then(({ PushNotifications }) =>
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => open(action.notification.data?.url)),
    )
    .then(keep)
    .catch(() => {});
  return () => {
    stopped = true;
    for (const handle of handles) handle.remove().catch(() => {});
  };
};

type WakeLock = { release: () => Promise<void> };

/**
 * Bildschirm bleibt an (Tresen, Wartezimmer-Bildschirm): in der App nativ, im Browser über die Wake-Lock-Schnittstelle,
 * wo es sie gibt. Der Browser gibt die Sperre frei, sobald der Tab verdeckt ist – beim Zurückkommen neu anfordern.
 */
export function useKeepScreenOn(active = true) {
  useEffect(() => {
    if (!active) return;
    if (inNativeApp()) {
      const plugin = import('@capacitor-community/keep-awake');
      plugin.then(({ KeepAwake }) => KeepAwake.keepAwake()).catch(() => {});
      return () => {
        plugin.then(({ KeepAwake }) => KeepAwake.allowSleep()).catch(() => {});
      };
    }
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } };
    if (!nav.wakeLock) return;
    let lock: WakeLock | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock
        ?.request('screen')
        .then((l) => {
          if (stopped) l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
