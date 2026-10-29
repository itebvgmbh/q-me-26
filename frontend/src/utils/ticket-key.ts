import { auth } from 'app';
import { t } from '@/i18n';

/**
 * Schlüssel einer Nummer ohne Konto. Wer eine Nummer ohne Anmeldung zieht, bekommt einen zufälligen Schlüssel; am
 * Termin steht nur sein SHA-256 (ticketKeyHash), den Schlüssel selbst kennt nur dieser Browser und der Link der
 * Nummernseite (/nummer/<id>#k=<Schlüssel>, der Teil hinter # geht nicht an den Server). Absagen, ins Konto
 * übernehmen und Benachrichtigungen einschalten gehen ohne Konto nur mit ihm – das prüft das Backend
 * (backend/app/apis/nummer, gleiche Art wie Team-Einladung und Kunden-Link: backend/app/libs/links.py).
 */

const STORE = 'dranzeit-nummer-schluessel';
const MAX_STORED = 30;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 Zeichen, 192 Bit Zufall (wie links.py new_token) */
export const newTicketKey = (): string => base64url(crypto.getRandomValues(new Uint8Array(24)));

/** SHA-256 als Hex-Text (wie links.py token_hash) */
export const hashTicketKey = async (key: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const readStore = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Schlüssel in diesem Browser merken (die neuesten MAX_STORED) */
export const rememberTicketKey = (appointmentId: string, key: string) => {
  try {
    const entries = Object.entries(readStore()).filter(([id]) => id !== appointmentId);
    entries.push([appointmentId, key]);
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(entries.slice(-MAX_STORED))));
  } catch {
    /* privater Modus: dann gilt nur der Link */
  }
};

export const storedTicketKey = (appointmentId: string): string | null => readStore()[appointmentId] || null;

/** Schlüssel aus dem Teil hinter # (#k=…) */
export const keyFromHash = (hash: string): string | null => {
  const match = hash.match(/(?:^#|&)k=([A-Za-z0-9_-]{16,64})/);
  return match ? match[1] : null;
};

/** Link zur Nummernseite, mit Schlüssel, wenn es einen gibt */
export const ticketPath = (appointmentId: string, key?: string | null, search = '') =>
  `/nummer/${appointmentId}${search}${key ? `#k=${key}` : ''}`;

const post = async <T = unknown>(path: string, body: unknown, withAuth = false): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) headers.Authorization = await auth.getAuthHeaderValue();
  let res: Response;
  try {
    res = await fetch(`/routes/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error(t('Keine Verbindung zum Server. Bitte prüf dein Internet.'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    const error = new Error(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return (await res.json().catch(() => null)) as T;
};

/** 409 vom Backend: Platz inzwischen weg oder zu kurzfristig – neue Zeit aussuchen lassen */
export const isTaken = (error: unknown) => (error as { status?: number } | null)?.status === 409;

/**
 * Nummer zurückgeben oder Termin absagen (Nummernseite, Meine Termine): ohne Konto mit dem Schlüssel der Nummer, sonst
 * als angemeldetes Konto. Das Backend gibt den Platz frei und meldet es dem Team.
 */
export const cancelTicket = (appointmentId: string, key: string | null) =>
  post('nummer/absagen', { appointment_id: appointmentId, ...(key ? { key } : {}) }, !key);

/** Nummer ohne Konto ins angemeldete Konto übernehmen (AnonymousBookingLinker) */
export const claimTicket = (appointmentId: string, key: string) =>
  post('nummer/uebernehmen', { appointment_id: appointmentId, key }, true);

/**
 * Fester Termin ohne Konto (backend/app/apis/nummer): Das Backend prüft den Platz und bucht bei der ersten der Personen,
 * die dann noch frei ist. Der Schlüssel bleibt in diesem Browser und im Link, ans Backend geht nur sein Hash.
 */
export const bookWithoutAccount = async (booking: {
  shopId: string;
  serviceId: string;
  staffIds: string[];
  start: Date;
  name: string;
  phone?: string;
  language: string;
}): Promise<{ appointmentId: string; ticketKey: string }> => {
  const ticketKey = newTicketKey();
  const result = await post<{ appointment_id: string }>('nummer/termin', {
    shop_id: booking.shopId,
    service_id: booking.serviceId,
    staff_ids: booking.staffIds,
    start: booking.start.toISOString(),
    key_hash: await hashTicketKey(ticketKey),
    name: booking.name,
    ...(booking.phone ? { phone: booking.phone } : {}),
    language: booking.language,
  });
  rememberTicketKey(result.appointment_id, ticketKey);
  return { appointmentId: result.appointment_id, ticketKey };
};

/** Fester Termin mit Konto (backend/app/apis/nummer): Name und Handynummer nimmt das Backend aus dem Profil */
export const bookWithAccount = (booking: {
  shopId: string;
  serviceId: string;
  staffIds: string[];
  start: Date;
  language: string;
  checkEarlier: boolean;
}) =>
  post<{ appointment_id: string }>(
    'nummer/termin',
    {
      shop_id: booking.shopId,
      service_id: booking.serviceId,
      staff_ids: booking.staffIds,
      start: booking.start.toISOString(),
      language: booking.language,
      check_earlier: booking.checkEarlier,
    },
    true,
  ).then((result) => ({ appointmentId: result.appointment_id }));

export interface PulledNumber {
  appointmentId: string;
  referenceCode?: string;
  staffId: string;
  start: Date;
  end: Date;
  /** Ohne Konto: Schlüssel für den Link der Nummernseite */
  ticketKey?: string;
}

/**
 * Nummer ziehen (backend/app/apis/nummer), mit oder ohne Konto: frühester freier Platz bei staffIds („Egal wer“: bei
 * der schnellsten Person), heute hinter der Schlange, sonst am Tag des angezeigten Platzes. Ist er beim Speichern
 * schon weg, nimmt das Backend den nächsten. Ohne Konto bleibt der Schlüssel hier und im Link, ans Backend geht nur
 * sein Hash.
 */
export const pullNumber = async (pull: {
  shopId: string;
  serviceId: string;
  staffIds: string[];
  shownStart: Date;
  signedIn: boolean;
  name?: string;
  phone?: string;
  language: string;
  checkEarlier: boolean;
}): Promise<PulledNumber> => {
  const ticketKey = pull.signedIn ? undefined : newTicketKey();
  const result = await post<{ appointment_id: string; reference_code?: string; staff_id: string; start: string; end: string }>(
    'nummer/ziehen',
    {
      shop_id: pull.shopId,
      service_id: pull.serviceId,
      staff_ids: pull.staffIds,
      start: pull.shownStart.toISOString(),
      ...(ticketKey ? { key_hash: await hashTicketKey(ticketKey) } : {}),
      ...(pull.name ? { name: pull.name } : {}),
      ...(pull.phone ? { phone: pull.phone } : {}),
      language: pull.language,
      check_earlier: pull.checkEarlier,
    },
    pull.signedIn,
  );
  if (ticketKey) rememberTicketKey(result.appointment_id, ticketKey);
  return {
    appointmentId: result.appointment_id,
    referenceCode: result.reference_code,
    staffId: result.staff_id,
    start: new Date(result.start),
    end: new Date(result.end),
    ticketKey,
  };
};

/**
 * Platz ändern (backend/app/apis/nummer): Nummer oder Termin auf eine andere Zeit, mit dem Schlüssel der Nummer oder
 * dem eigenen Konto. Der alte Platz bleibt, bis der neue sicher ist; danach ist es ein fester Termin.
 */
export const moveTicket = (move: { appointmentId: string; key: string | null; staffIds: string[]; start: Date; signedIn: boolean }) =>
  post<{ start: string; staff_id: string; reference_code?: string }>(
    'nummer/verschieben',
    { appointment_id: move.appointmentId, staff_ids: move.staffIds, start: move.start.toISOString(), ...(move.key ? { key: move.key } : {}) },
    move.signedIn,
  );
