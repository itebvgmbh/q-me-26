// Übernahme: Ein Salon aus dem Verzeichnis (/friseur/…) macht seine Seite zum Dranzeit-Laden.
// Mit dem Code aus dem Brief verknüpft das Backend Seite und Laden sofort; ohne Code füllt nur der Assistent vor,
// und der Betreiber bestätigt die Verknüpfung wie bisher. Backend: backend/app/libs/uebernahme.py,
// Endpunkte in backend/app/apis/verzeichnis. Seite: pages/Uebernehmen.tsx, Assistent: pages/ShopSetup.tsx.
import { auth } from 'app';
import { t } from '@/i18n';
import { claimFounder } from './billing';
import type { BusinessHoursDay } from './firestore/types';
import { normalizeHours } from './opening-hours';
import { DraftService, emptyDraft, newKey, ShopDraft } from './shop-setup';

export interface Vorschau {
  id: string;
  pfad: string;
  name: string;
  kategorie: 'friseur' | 'barbershop' | '';
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  website: string;
  beschreibung: string;
  googlePlaceId: string;
  coordinates: { latitude: number; longitude: number } | null;
  businessHoursByDay: BusinessHoursDay[];
  services: { name: string; category: string; price: number; priceFrom: boolean }[];
}

/** Antwort mit Fehlerstatus vom Backend (Code falsch, schon eingelöst …) – anders als „keine Verbindung“ */
export class AntwortFehler extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const request = async <T>(path: string, body?: unknown, withAuth = false): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) headers.Authorization = await auth.getAuthHeaderValue();
  let res: Response;
  try {
    res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
    throw new AntwortFehler(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }), res.status);
  }
  return (await res.json()) as T;
};

/** 'abcde fghjk' → 'ABCDE-FGHJK' (wie im Brief) */
export const codeAnzeigen = (code: string) => {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5, 10)}` : c;
};

export const pruefeCode = (code: string) =>
  request<{ code: string; eintrag: Vorschau }>('/routes/verzeichnis/uebernahme/pruefen', { code });

export const holeVorschau = (eintragId: string) => request<Vorschau>(`/routes/verzeichnis/${encodeURIComponent(eintragId)}/vorschau`);

export const loeseEin = (code: string, shopId: string) =>
  request<{ ok: boolean; pfad: string }>('/routes/verzeichnis/uebernahme/einloesen', { code, shopId }, true);

// --- Gemerkt bis nach dem Anlegen (Konto anlegen und Anmelden liegen dazwischen) -----------------------------------

export interface Offen {
  eintrag: Vorschau;
  /** nur mit Brief: dann verknüpft das Backend gleich */
  code?: string;
}

const KEY = 'dranzeit-uebernahme';

export const merkeUebernahme = (offen: Offen) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(offen));
  } catch {
    /* privater Modus – dann eben ohne Vorbefüllen */
  }
};

export const offeneUebernahme = (): Offen | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const offen = raw ? (JSON.parse(raw) as Offen) : null;
    return offen?.eintrag?.id ? offen : null;
  } catch {
    return null;
  }
};

export const vergissUebernahme = () => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
};

// --- Entwurf für den Einrichtungsassistenten ---------------------------------------------------------------------

/** Die Seite nennt Preise, aber keine Dauer: grob nach dem Namen schätzen (der Assistent zeigt „geschätzt“) */
const DAUER: [RegExp, number][] = [
  [/dauerwelle|gl[äa]tt|keratin/i, 120],
  [/str[äa]hn|balayage|blond|f[äa]rb|farbe|t[öo]n|color|colour/i, 90],
  [/hochsteck|braut|anlass/i, 60],
  [/waschen.*schneiden|schneiden.*f[öo]hn|damen/i, 60],
  [/haar.*bart|bart.*haar|komplett|kombi/i, 45],
  [/f[öo]hn|styling|wasch/i, 30],
  [/maschine|kinder|kids|bart|rasur|augenbrau|konturen|nacken/i, 20],
];

export const dauerSchaetzen = (name: string, category = ''): number => DAUER.find(([muster]) => muster.test(`${name} ${category}`))?.[1] ?? 30;

const leistungen = (services: Vorschau['services']): DraftService[] =>
  services
    .filter((s) => s.name?.trim())
    .map((s) => ({
      key: newKey('v'),
      name: s.name.trim(),
      category: s.category || '',
      duration: dauerSchaetzen(s.name, s.category),
      price: Number(s.price) || 0,
      priceFrom: Boolean(s.priceFrom),
      durationGuessed: true,
      selected: true,
      source: 'website' as const,
    }));

// --- Nach dem Anlegen: Seite und Laden verbinden --------------------------------------------------------------------

export type Verbindung =
  | { stand: 'verbunden'; pfad: string; gruender: boolean }
  /** ohne Code: der Betreiber bestätigt (Abgleich über Name und PLZ bzw. Google-Eintrag) */
  | { stand: 'pruefen'; pfad: string }
  /** nochmal: keine Verbindung, später erneut versuchen */
  | { stand: 'fehler'; pfad: string; text: string; nochmal: boolean };

export const verbindeSeite = async (verzeichnis: NonNullable<ShopDraft['verzeichnis']>, shopId: string): Promise<Verbindung> => {
  const { pfad, code } = verzeichnis;
  if (!code) {
    vergissUebernahme();
    return { stand: 'pruefen', pfad };
  }
  try {
    const res = await loeseEin(code, shopId);
    vergissUebernahme();
    // Wer per Brief kommt, bekommt den Gründerplatz gleich mit (solange frei); ohne ist der Laden trotzdem fertig
    const gruender = await claimFounder(shopId).then((r) => r.founder, () => false);
    return { stand: 'verbunden', pfad: res.pfad || pfad, gruender };
  } catch (error) {
    const fest = error instanceof AntwortFehler;
    if (fest) vergissUebernahme();
    return { stand: 'fehler', pfad, text: (error as Error).message, nochmal: !fest };
  }
};

/** Entwurf aus der Seite: Angaben prüfen ist der erste Schritt, die Branche steht schon fest */
export const entwurfAus = (offen: Offen, email: string, ownerName: string): ShopDraft => {
  const e = offen.eintrag;
  const hours = e.businessHoursByDay?.length ? normalizeHours(e.businessHoursByDay) : null;
  const leer = emptyDraft(email, ownerName);
  return {
    ...leer,
    step: 'check',
    source: 'verzeichnis',
    googlePlaceId: e.googlePlaceId || '',
    name: e.name,
    street: e.street,
    postalCode: e.postalCode,
    city: e.city,
    phone: e.phone,
    website: e.website,
    coordinates: e.coordinates,
    industry: 'barbershop', // Friseure und Barbershops: dieselbe Branche im Assistenten
    industryGuessed: true,
    hours: hours ?? leer.hours,
    hoursFromGoogle: Boolean(hours),
    services: leistungen(e.services || []),
    websiteRead: e.website, // die Preisliste steht schon da; nicht noch einmal auslesen
    verzeichnis: { eintragId: e.id, pfad: e.pfad, code: offen.code },
  };
};
