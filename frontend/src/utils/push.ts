import { auth } from 'app';
import { sprache, t } from '@/i18n';
import { inNativeApp } from './native-app';

// Benachrichtigungen für eine Nummer: Web-Push, in der iPhone/iPad-App nativer Push (enableAppPush), oder E-Mail.
// Backend: backend/app/apis/push (Anmelden), backend/app/libs/notify_worker.py (Versand).
// Eine Nummer ohne Konto meldet sich mit ihrem Schlüssel an (utils/ticket-key.ts), eine mit Konto mit der Anmeldung.

export interface PushConfig {
  push: boolean;
  email: boolean;
  publicKey: string;
  /** Push an die App (Firebase Cloud Messaging, backend/app/libs/fcm.py) */
  app?: boolean;
}

const NO_CHANNELS: PushConfig = { push: false, email: false, publicKey: '', app: false };

/** POST an das Backend, mit Anmeldung, wenn es eine gibt; Fehler mit der Meldung des Backends (auch utils/team-push.ts) */
export const post = async (path: string, body: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await auth.getAuthToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = t('Das hat nicht geklappt. Versuch es gleich noch einmal.');
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(detail);
  }
};

export const getPushConfig = async (): Promise<PushConfig> => {
  try {
    const res = await fetch('/routes/push/config');
    return res.ok ? ((await res.json()) as PushConfig) : NO_CHANNELS;
  } catch {
    return NO_CHANNELS;
  }
};

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Als App vom Home-Bildschirm geöffnet? Nur dann erlaubt iOS Benachrichtigungen. */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const flagKey = (appointmentId: string) => `dranzeit-push-${appointmentId}`;

const readFlag = (appointmentId: string) => {
  try {
    return localStorage.getItem(flagKey(appointmentId)) === '1';
  } catch {
    return false;
  }
};

export const pushEnabledFor = (appointmentId: string) =>
  inNativeApp() ? readFlag(appointmentId) : pushSupported() && Notification.permission === 'granted' && readFlag(appointmentId);

const setFlag = (appointmentId: string) => {
  try {
    localStorage.setItem(flagKey(appointmentId), '1');
  } catch {
    /* privater Modus: Benachrichtigung kommt trotzdem */
  }
};

const urlBase64ToUint8Array = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export type EnablePushResult = 'ok' | 'denied' | 'unsupported';

/** Push-Adresse dieses Browsers (Service Worker /sw.js) – erst nach der Erlaubnis aufrufen. Auch für das Team (utils/team-push.ts). */
export const browserSubscription = async (publicKey: string): Promise<PushSubscriptionJSON> => {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  try {
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  } catch {
    // Alte Anmeldung mit anderem Schlüssel: abmelden und neu anmelden
    await subscription?.unsubscribe();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }
  return subscription.toJSON();
};

export const enablePush = async (appointmentId: string, publicKey: string, ticketKey?: string | null): Promise<EnablePushResult> => {
  if (!pushSupported() || !publicKey) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const json = await browserSubscription(publicKey);
  await post('/routes/push/subscribe', {
    appointment_id: appointmentId,
    key: ticketKey || null,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    // Nachrichten an dieses Gerät in der gewählten Sprache (backend/app/i18n)
    language: sprache(),
  });
  setFlag(appointmentId);
  return 'ok';
};

// So lange warten wir auf das Token von iOS/Firebase (mobile/ios/App/App/AppDelegate.swift)
const APP_TOKEN_TIMEOUT_MS = 15000;

/** Token des Geräts in der App: iOS fragt einmal nach der Erlaubnis, danach kommt es ohne Rückfrage. */
export const appPushToken = async (): Promise<string | 'denied'> => {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted' && permission.receive !== 'denied') permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return 'denied';
  const handles: { remove: () => Promise<void> }[] = [];
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(t('Das hat nicht geklappt. Versuch es gleich noch einmal.'))), APP_TOKEN_TIMEOUT_MS);
      Promise.all([
        PushNotifications.addListener('registration', ({ value }) => {
          window.clearTimeout(timer);
          resolve(value);
        }),
        PushNotifications.addListener('registrationError', ({ error }) => {
          window.clearTimeout(timer);
          reject(new Error(error || t('Das hat nicht geklappt.')));
        }),
      ])
        .then((added) => {
          handles.push(...added);
          return PushNotifications.register();
        })
        .catch(reject);
    });
  } finally {
    for (const handle of handles) handle.remove().catch(() => {});
  }
};

/** In der iPhone/iPad-App: nativer Push statt Web-Push (WKWebView kann keinen Web-Push). */
export const enableAppPush = async (appointmentId: string, ticketKey?: string | null): Promise<EnablePushResult> => {
  if (!inNativeApp()) return 'unsupported';
  const token = await appPushToken();
  if (token === 'denied') return 'denied';
  await post('/routes/push/subscribe-app', {
    appointment_id: appointmentId,
    key: ticketKey || null,
    token,
    platform: 'ios',
    language: sprache(),
  });
  setFlag(appointmentId);
  return 'ok';
};

const mailKey = (appointmentId: string) => `dranzeit-mail-${appointmentId}`;

export const setNotifyEmail = async (appointmentId: string, email: string | null, ticketKey?: string | null) => {
  await post('/routes/push/notify-email', { appointment_id: appointmentId, email: email || null, key: ticketKey || null, language: sprache() });
  // Die Adresse steht nur am Termin, den ohne Anmeldung niemand lesen kann – für die Anzeige hier merken
  try {
    if (email) localStorage.setItem(mailKey(appointmentId), email);
    else localStorage.removeItem(mailKey(appointmentId));
  } catch {
    /* privater Modus */
  }
};

/** In diesem Browser hinterlegte E-Mail für die Nummer (setNotifyEmail) */
export const savedNotifyEmail = (appointmentId: string): string => {
  try {
    return localStorage.getItem(mailKey(appointmentId)) || '';
  } catch {
    return '';
  }
};

// Zuletzt gezogene Nummern auf diesem Gerät, damit man sie von der Startseite wiederfindet
const TICKETS_KEY = 'dranzeit-nummern';

export interface StoredTicket {
  id: string;
  shopId: string;
  /** ISO-Zeit der geplanten Startzeit */
  start: string;
}

export const rememberTicket = (ticket: StoredTicket) => {
  try {
    const list = getRememberedTickets().filter((stored) => stored.id !== ticket.id);
    list.unshift(ticket);
    localStorage.setItem(TICKETS_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* ohne Speicher keine Erinnerung auf der Startseite */
  }
};

export const getRememberedTickets = (): StoredTicket[] => {
  try {
    const raw = localStorage.getItem(TICKETS_KEY);
    const list = raw ? (JSON.parse(raw) as StoredTicket[]) : [];
    return Array.isArray(list) ? list.filter((stored) => stored && typeof stored.id === 'string') : [];
  } catch {
    return [];
  }
};
