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

const post = async (path: string, body: unknown, withAuth = false): Promise<void> => {
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
};

/** Nummer ohne Konto zurückgeben (Nummernseite) */
export const cancelTicket = (appointmentId: string, key: string) => post('nummer/absagen', { appointment_id: appointmentId, key });

/** Nummer ohne Konto ins angemeldete Konto übernehmen (AnonymousBookingLinker) */
export const claimTicket = (appointmentId: string, key: string) =>
  post('nummer/uebernehmen', { appointment_id: appointmentId, key }, true);
