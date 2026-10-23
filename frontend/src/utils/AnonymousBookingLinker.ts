import { getAnonymousBookingCodes, removeAnonymousBookingCode, saveAnonymousBookingCode } from './localStorageUtils';
import { claimTicket, rememberTicketKey, storedTicketKey } from './ticket-key';
import { toast } from 'sonner';

// Login, Registrierung und Startseite können gleichzeitig verknüpfen – nur ein Lauf auf einmal
let running: Promise<void> | null = null;

/** Nummer, die gerade auf der Nummernseite offen war („Konto anlegen und Nummer behalten“) */
export type TicketToLink = { shopId?: string; appointmentId?: string; ticketKey?: string };

/**
 * Übernimmt die in diesem Browser ohne Konto gezogenen Nummern ins angemeldete Konto.
 * Das Backend prüft dabei den Schlüssel der Nummer (utils/ticket-key.ts): Wer nur die Termin-ID kennt, übernimmt
 * nichts. Einträge ohne Schlüssel (Nummern von vor dieser Umstellung, alte Wartenummern) lassen sich nicht mehr
 * übernehmen und fallen aus der Liste.
 */
export const linkAnonymousBookingsToUser = (ticket: TicketToLink = {}): Promise<void> => {
  if (!running) {
    running = linkAll(ticket).finally(() => {
      running = null;
    });
  }
  return running;
};

const linkAll = async ({ shopId, appointmentId, ticketKey }: TicketToLink): Promise<void> => {
  try {
    if (shopId && appointmentId && ticketKey) {
      rememberTicketKey(appointmentId, ticketKey);
      saveAnonymousBookingCode(shopId, appointmentId);
    }
    let linkedCount = 0;
    for (const [shop, values] of Object.entries(getAnonymousBookingCodes())) {
      for (const value of values) {
        if (await linkSingleAnonymousBooking(shop, value)) linkedCount++;
      }
    }
    if (linkedCount > 0) {
      toast.success(linkedCount === 1 ? 'Deine Nummer ist jetzt in deinem Konto.' : `${linkedCount} Nummern sind jetzt in deinem Konto.`);
    }
  } catch (error) {
    console.error('Fehler beim Verknüpfen anonymer Buchungen:', error);
  }
};

/** Eine Nummer übernehmen; true, wenn sie jetzt im Konto ist. Ohne Verbindung bleibt sie für den nächsten Versuch. */
const linkSingleAnonymousBooking = async (shopId: string, appointmentId: string): Promise<boolean> => {
  const key = storedTicketKey(appointmentId);
  if (!key) {
    removeAnonymousBookingCode(shopId, appointmentId);
    return false;
  }
  try {
    await claimTicket(appointmentId, key);
    removeAnonymousBookingCode(shopId, appointmentId);
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    // Gibt es nicht, schon übernommen, abgesagt oder falscher Schlüssel: nicht noch einmal versuchen
    if (status && status >= 400 && status < 500 && status !== 429) removeAnonymousBookingCode(shopId, appointmentId);
    console.error(`Nummer ${appointmentId} nicht übernommen:`, error);
    return false;
  }
};
