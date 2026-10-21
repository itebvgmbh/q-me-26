// Salon-Verzeichnis: Salons ohne Dranzeit mit eigener Seite (/friseur/<stadt>/<salon>), dazu die Seiten der Läden.
// Betreiber-Bereich (Reiter Verzeichnis): backend/app/apis/betreiber/verzeichnis.py
// Karte: backend/app/apis/verzeichnis (ohne Anmeldung)
import { send } from './betreiber';

export type EintragStatus = 'entwurf' | 'online' | 'offline' | 'entfernt';
export type Kategorie = 'friseur' | 'barbershop';

export interface Leistung {
  name: string;
  category: string;
  price: number;
  priceFrom: boolean;
}

export interface Pause {
  startTime: string;
  endTime: string;
}

export interface Tag {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  breaks: Pause[];
}

export interface Eintrag {
  id: string;
  status: EintragStatus;
  name: string;
  kategorie: Kategorie;
  street: string;
  postalCode: string;
  city: string;
  ortsteil: string;
  bezirk: string;
  phone: string;
  website: string;
  beschreibung: string;
  schwerpunkte: string[];
  services: Leistung[];
  businessHoursByDay: Tag[];
  ohneTermin: string;
  coordinates: { latitude: number; longitude: number } | null;
  slug: string;
  stadtSlug: string;
  pfad: string;
  altePfade: string[] | null;
  shopId: string | null;
  shopName: string;
  shopFehlt: boolean;
  googlePlaceId: string | null;
  quelle: { website: string; seiten: string[]; gelesenAm: string } | null;
  wuensche: number;
  vorschlag: { shopId: string; name: string; grund: string; am: string } | null;
  fehlt: string[];
  angelegtAm: string | null;
  geaendertAm: string | null;
  veroeffentlichtAm: string | null;
  entferntAm: string | null;
}

export interface Treffer {
  placeId: string;
  name: string;
  address: string;
  postalCode: string;
  website: string;
  websiteFremd: string;
  kategorie: Kategorie | null;
  geschlossen: boolean;
  eintragId: string;
  shopId: string;
}

export interface Liste {
  eintraege: Eintrag[];
  status: { google: boolean; ai: boolean };
}

export type EintragDaten = Partial<
  Pick<
    Eintrag,
    | 'name'
    | 'kategorie'
    | 'street'
    | 'postalCode'
    | 'city'
    | 'ortsteil'
    | 'bezirk'
    | 'phone'
    | 'website'
    | 'beschreibung'
    | 'schwerpunkte'
    | 'services'
    | 'businessHoursByDay'
    | 'ohneTermin'
    | 'slug'
  >
>;

const BASE = '/routes/betreiber/verzeichnis';
const entryPath = (id: string, action = '') => `${BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const loadVerzeichnis = () => send<Liste>(BASE);
export const searchGoogle = (query: string, pageToken = '') =>
  send<{ treffer: Treffer[]; nextPageToken: string }>(`${BASE}/suche`, { query, pageToken });
export const importSalon = (body: { website: string; placeId?: string; name?: string; address?: string; eintragId?: string }) =>
  send<Eintrag>(`${BASE}/import`, body);
export const createByHand = (data: EintragDaten) => send<Eintrag>(`${BASE}/neu`, data);
export const saveEintrag = (id: string, data: EintragDaten) => send<Eintrag>(entryPath(id), data);
export const setStatus = (id: string, status: 'online' | 'offline' | 'entwurf') => send<{ status: string }>(entryPath(id, 'status'), { status });
export const deleteEintrag = (id: string) => send<{ deleted: boolean }>(entryPath(id, 'loeschen'), {});
export const confirmTakeover = (id: string, shopId: string) => send<{ ok: boolean }>(entryPath(id, 'uebernahme'), { shopId });
export const rejectTakeover = (id: string, shopId: string) => send<{ ok: boolean }>(entryPath(id, 'uebernahme-ablehnen'), { shopId });

/** Für die Karte: Salons ohne Dranzeit (ohne Anmeldung). Fehler → leere Liste, die Karte zeigt dann nur Dranzeit-Läden. */
export interface KartenSalon {
  id: string;
  name: string;
  kategorie: Kategorie;
  street: string;
  postalCode: string;
  city: string;
  ortsteil: string;
  latitude: number;
  longitude: number;
  pfad: string;
}

export const loadKartenSalons = async (): Promise<KartenSalon[]> => {
  try {
    const res = await fetch('/routes/verzeichnis/karte');
    if (!res.ok) return [];
    return ((await res.json()) as { salons: KartenSalon[] }).salons ?? [];
  } catch {
    return [];
  }
};

// --- Öffnungszeiten als Text: "09:00–12:00, 13:00–18:00" je Tag, leer = geschlossen -------------------------------

export const TAGE_REIHE = [1, 2, 3, 4, 5, 6, 0];
export const TAG_NAME = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export const tagAlsText = (day: Tag | undefined): string => {
  if (!day || !day.isOpen) return '';
  const spans: string[] = [];
  let start = day.openTime;
  for (const b of [...(day.breaks || [])].sort((a, z) => a.startTime.localeCompare(z.startTime))) {
    spans.push(`${start}–${b.startTime}`);
    start = b.endTime;
  }
  spans.push(`${start}–${day.closeTime}`);
  return spans.join(', ');
};

const zeit = (v: string): string | null => {
  const m = v.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

/** "9-12, 13-18" → Tag; null bei Unlesbarem. Leer → geschlossen. */
export const textAlsTag = (dayOfWeek: number, text: string): Tag | null => {
  const closed: Tag = { dayOfWeek, isOpen: false, openTime: '09:00', closeTime: '18:00', breaks: [] };
  if (!text.trim() || /^geschlossen$/i.test(text.trim())) return closed;
  const windows: [string, string][] = [];
  for (const part of text.split(/[,;]/)) {
    const [a, b, ...rest] = part.split(/[–—-]/);
    if (rest.length || a === undefined || b === undefined) return null;
    const von = zeit(a);
    const bis = zeit(b);
    if (!von || !bis || bis <= von) return null;
    windows.push([von, bis]);
  }
  windows.sort((x, y) => x[0].localeCompare(y[0]));
  for (let i = 1; i < windows.length; i++) if (windows[i][0] < windows[i - 1][1]) return null;
  return {
    dayOfWeek,
    isOpen: true,
    openTime: windows[0][0],
    closeTime: windows[windows.length - 1][1],
    breaks: windows.slice(1).map((w, i) => ({ startTime: windows[i][1], endTime: w[0] })),
  };
};

export const STATUS_LABEL: Record<EintragStatus, string> = {
  entwurf: 'Entwurf',
  online: 'online',
  offline: 'offline',
  entfernt: 'vom Salon entfernt',
};
