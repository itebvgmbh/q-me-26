import { auth } from 'app';

// Benachrichtigungen für eine Nummer: Web-Push oder E-Mail.
// Backend: backend/app/apis/push (Anmelden), backend/app/libs/notify_worker.py (Versand).
// Eine Nummer ohne Konto meldet sich mit ihrem Schlüssel an (utils/ticket-key.ts), eine mit Konto mit der Anmeldung.

export interface PushConfig {
  push: boolean;
  email: boolean;
  publicKey: string;
}

const NO_CHANNELS: PushConfig = { push: false, email: false, publicKey: '' };

const post = async (path: string, body: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await auth.getAuthToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = 'Das hat nicht geklappt. Versuch es gleich noch einmal.';
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
  pushSupported() && Notification.permission === 'granted' && readFlag(appointmentId);

const urlBase64ToUint8Array = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export type EnablePushResult = 'ok' | 'denied' | 'unsupported';

export const enablePush = async (appointmentId: string, publicKey: string, ticketKey?: string | null): Promise<EnablePushResult> => {
  if (!pushSupported() || !publicKey) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

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
  const json = subscription.toJSON();
  await post('/routes/push/subscribe', {
    appointment_id: appointmentId,
    key: ticketKey || null,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  });
  try {
    localStorage.setItem(flagKey(appointmentId), '1');
  } catch {
    /* privater Modus: Benachrichtigung kommt trotzdem */
  }
  return 'ok';
};

const mailKey = (appointmentId: string) => `dranzeit-mail-${appointmentId}`;

export const setNotifyEmail = async (appointmentId: string, email: string | null, ticketKey?: string | null) => {
  await post('/routes/push/notify-email', { appointment_id: appointmentId, email: email || null, key: ticketKey || null });
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
    const list = getRememberedTickets().filter((t) => t.id !== ticket.id);
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
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string') : [];
  } catch {
    return [];
  }
};
