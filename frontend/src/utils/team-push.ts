import { auth } from 'app';
import { sprache } from '@/i18n';
import { appPushToken, browserSubscription, isIos, isStandalone, post, pushSupported, type PushConfig } from './push';
import { inNativeApp } from './native-app';

// Benachrichtigungen für Inhaber und Team auf diesem Gerät: Ein Kunde zieht selbst eine Nummer, bucht online oder am
// Telefon oder sagt ab. Anmelden: backend/app/apis/team_push (für alle Läden des Kontos), Versand und Nachtruhe:
// backend/app/libs/team_notify.py. Die Auswahl merkt sich das Gerät je Konto; bei jedem Öffnen von „Mein Tag“ meldet
// es sich neu an (TeamPushSchalter), so stimmen Läden und Push-Adresse. Was der Kunde tut, meldet announceToTeam –
// Einträge vom Tresen nicht.

export type TeamEvent = 'nummer' | 'buchung' | 'absage';
export type TeamEvents = Record<TeamEvent, boolean>;

export const ALLE_EREIGNISSE: TeamEvents = { nummer: true, buchung: true, absage: true };

type Device = { endpoint: string; p256dh?: string; auth?: string } | { token: string; platform: 'ios' };

const storeKey = (uid: string) => `dranzeit-team-push-${uid}`;

/** Auswahl auf diesem Gerät für das Konto, null = aus */
export const savedTeamPush = (uid: string): TeamEvents | null => {
  try {
    const raw = localStorage.getItem(storeKey(uid));
    return raw ? { ...ALLE_EREIGNISSE, ...(JSON.parse(raw) as Partial<TeamEvents>) } : null;
  } catch {
    return null;
  }
};

const save = (uid: string, events: TeamEvents | null) => {
  try {
    if (events) localStorage.setItem(storeKey(uid), JSON.stringify(events));
    else localStorage.removeItem(storeKey(uid));
  } catch {
    /* privater Modus: gilt bis zum Neuladen */
  }
};

/** Geht es auf diesem Gerät? Im iPhone-Browser nur als App vom Home-Bildschirm, in der Dranzeit-App über FCM */
export const teamPushAvailable = (config: PushConfig) =>
  inNativeApp() ? Boolean(config.app) : config.push && pushSupported() && !(isIos() && !isStandalone());

/** Push-Adresse dieses Geräts; ask: um Erlaubnis fragen (nur nach einem Tippen, nicht beim Öffnen der Seite) */
const thisDevice = async (config: PushConfig, ask: boolean): Promise<Device | 'denied' | 'unsupported'> => {
  if (inNativeApp()) {
    const token = await appPushToken();
    return token === 'denied' ? 'denied' : { token, platform: 'ios' };
  }
  if (!teamPushAvailable(config) || !config.publicKey) return 'unsupported';
  const permission = ask ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return 'denied';
  const json = await browserSubscription(config.publicKey);
  if (!json.endpoint) return 'unsupported';
  return { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth };
};

/** Einschalten oder Auswahl ändern – für alle Läden des Kontos */
export const enableTeamPush = async (uid: string, events: TeamEvents, config: PushConfig, ask = true): Promise<'ok' | 'denied' | 'unsupported'> => {
  const device = await thisDevice(config, ask);
  if (typeof device === 'string') return device;
  await post('/routes/team-push/subscribe', { ...device, events, language: sprache() });
  save(uid, events);
  return 'ok';
};

/** Beim Öffnen von „Mein Tag“: Anmeldung auffrischen, ohne zu fragen. Ist die Erlaubnis weg, gilt es als aus. */
export const refreshTeamPush = async (uid: string, config: PushConfig): Promise<TeamEvents | null> => {
  const events = savedTeamPush(uid);
  if (!events) return null;
  const result = await enableTeamPush(uid, events, config, false).catch(() => 'ok' as const);
  if (result !== 'ok') save(uid, null);
  return result === 'ok' ? events : null;
};

/** Ausschalten für dieses Konto auf diesem Gerät */
export const disableTeamPush = async (uid: string) => {
  save(uid, null);
  let device: Device | null = null;
  if (inNativeApp()) {
    const token = await appPushToken();
    if (token !== 'denied') device = { token, platform: 'ios' };
  } else if (pushSupported()) {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const endpoint = (await registration?.pushManager.getSubscription())?.endpoint;
    if (endpoint) device = { endpoint };
  }
  if (device) await post('/routes/team-push/unsubscribe', device);
};

/** Vor dem Abmelden aus dem Konto: Das Gerät bekommt danach keine Nachrichten mehr über die Kunden des Ladens */
export const stopTeamPushBeforeLogout = async () => {
  const uid = auth.getCurrentUser()?.uid;
  if (!uid || !savedTeamPush(uid)) return;
  await disableTeamPush(uid).catch(() => {});
};

/**
 * Der Kunde hat eben selbst eine Nummer gezogen oder gebucht ("new") oder abgesagt ("cancelled"): Inhaber und gebuchte
 * Person bekommen Bescheid (/push/team-event). Mit Konto über die Anmeldung, ohne mit dem Schlüssel der Nummer.
 * Klappt das nicht, merkt der Kunde nichts davon.
 */
export const announceToTeam = (appointmentId: string, kind: 'new' | 'cancelled', ticketKey?: string | null) => {
  post('/routes/push/team-event', { appointment_id: appointmentId, kind, key: ticketKey || null }).catch(() => {});
};
