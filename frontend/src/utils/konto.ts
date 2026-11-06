import { liveLesen, LiveFehlt } from './live';
import type { Appointment } from './firestore/types';
import type { EarlierSlotNotificationType } from './types';

/**
 * Was zum angemeldeten Konto gehört, über das Backend (GET /routes/konto/…; requirements/eigene-datenbank.md, Stufe 2).
 * Nur das eigene Konto: Termine mit customerId = eigene uid, Angebote „Früher dran“ mit userId = eigene uid.
 */

const oderNull = async <T,>(lesen: () => Promise<T>): Promise<T | null> => {
  try {
    return await lesen();
  } catch (error) {
    if (error instanceof LiveFehlt) return null;
    throw error;
  }
};

/** Alle Termine und Nummern des Kontos */
export const eigeneTermine = async (): Promise<Appointment[]> => (await liveLesen<{ termine: Appointment[] }>('konto/termine', true)).termine;

/** Ein Termin des Kontos; null, wenn es ihn nicht gibt oder er nicht zum Konto gehört */
export const eigenerTermin = (id: string): Promise<Appointment | null> =>
  oderNull(async () => (await liveLesen<{ termin: Appointment }>(`konto/termine/${encodeURIComponent(id)}`, true)).termin);

/** Offene Angebote „Früher dran“ (noch nicht angenommen) */
export const eigeneAngebote = async (): Promise<EarlierSlotNotificationType[]> =>
  (await liveLesen<{ angebote: EarlierSlotNotificationType[] }>('konto/angebote', true)).angebote;

/** Ein Angebot des Kontos; null, wenn es das nicht gibt */
export const eigenesAngebot = (id: string): Promise<EarlierSlotNotificationType | null> =>
  oderNull(async () => (await liveLesen<{ angebot: EarlierSlotNotificationType }>(`konto/angebote/${encodeURIComponent(id)}`, true)).angebot);
