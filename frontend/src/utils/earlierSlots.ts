import brain from 'brain';
import { firebaseAuth } from '../app/auth/firebase';

/**
 * "Früher dran" sofort prüfen lassen, wenn bei einer Person ein Platz frei wird (Absage, Verschiebung)
 * oder jemand neu "früher benachrichtigen" anhakt. Sonst greift erst der 5-Minuten-Takt des Servers.
 * Läuft im Hintergrund; Fehler stören das Speichern nicht (der Takt holt es nach).
 * Nur mit Anmeldung – der Server prüft das Token.
 */
export const requestEarlierSlotCheck = (shopId?: string | null, staffId?: string | null): void => {
  if (!shopId || !firebaseAuth.currentUser) return;
  brain
    .slot_freed({ shop_id: shopId, staff_id: staffId || null })
    .catch((error: unknown) => console.warn('Früher-dran-Prüfung nicht angestoßen (der Server-Takt holt es nach):', error));
};

/** Gibt ein Platz frei (oder kann jemandem früher helfen)? Vergleich vorher/nachher eines Termins. */
export const freesOrWantsSlot = (
  before: { status?: string; startTime?: unknown; endTime?: unknown; staffId?: string | null; checkEarlierOptions?: boolean },
  after: { status?: string; startTime?: unknown; endTime?: unknown; staffId?: string | null; checkEarlierOptions?: boolean },
): boolean => {
  const ms = (v: any) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : v?.seconds ? v.seconds * 1000 : v);
  return (
    (after.status === 'cancelled' && before.status !== 'cancelled') ||
    ms(before.startTime) !== ms(after.startTime) ||
    ms(before.endTime) !== ms(after.endTime) ||
    (before.staffId || null) !== (after.staffId || null) ||
    (!!after.checkEarlierOptions && !before.checkEarlierOptions)
  );
};
