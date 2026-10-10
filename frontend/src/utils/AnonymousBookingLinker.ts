import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from './firestore-client';
import { updateAppointment } from './firestore';
import { getAnonymousBookingCodes, removeAnonymousBookingCode } from './localStorageUtils';
import { toast } from 'sonner';

// Firestore-Dokument-IDs sind 20 Zeichen lang, Wartenummern nur zwei Stellen
const isAppointmentId = (value: string) => value.length >= 15;

/**
 * Verknüpft die in diesem Browser gezogenen Nummern mit dem Konto.
 * @param userId User-ID des angemeldeten Benutzers
 * @param specificShopId Optional: nur Buchungen dieses Shops
 * @param specificReferenceCode Optional: Wartenummer, falls im Browser nichts gespeichert ist
 */
export const linkAnonymousBookingsToUser = async (userId: string, specificShopId?: string, specificReferenceCode?: string): Promise<void> => {
  try {
    let linkedCount = 0;
    const stored = getAnonymousBookingCodes();
    const shops = specificShopId ? { [specificShopId]: stored[specificShopId] || [] } : stored;

    for (const [shopId, values] of Object.entries(shops)) {
      for (const value of values) {
        if (await linkSingleAnonymousBooking(shopId, value, userId)) linkedCount++;
      }
    }

    // Nichts im Browser gespeichert: nur die angegebene Nummer versuchen
    if (linkedCount === 0 && specificShopId && specificReferenceCode && !(stored[specificShopId] || []).length) {
      if (await linkSingleAnonymousBooking(specificShopId, specificReferenceCode, userId)) linkedCount++;
    }

    if (linkedCount > 0) {
      toast.success(linkedCount === 1 ? 'Deine Nummer ist jetzt in deinem Konto.' : `${linkedCount} Nummern sind jetzt in deinem Konto.`);
    }
  } catch (error) {
    console.error('Fehler beim Verknüpfen anonymer Buchungen:', error);
  }
};

/**
 * Verknüpft eine einzelne anonyme Buchung mit einem Benutzer.
 * Über die Termin-ID eindeutig; alte Einträge mit Wartenummer nur, wenn die Nummer im Shop eindeutig ist –
 * sonst könnte die Buchung einer fremden Person übernommen werden.
 */
const linkSingleAnonymousBooking = async (shopId: string, value: string, userId: string): Promise<boolean> => {
  try {
    let appointmentId: string | null = null;

    if (isAppointmentId(value)) {
      const snap = await getDoc(doc(firestore, 'appointments', value));
      const data = snap.data();
      if (snap.exists() && data?.shopId === shopId && data?.isAnonymous === true) appointmentId = snap.id;
    } else {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'appointments'),
          where('shopId', '==', shopId),
          where('referenceCode', '==', value),
          where('isAnonymous', '==', true)
        )
      );
      if (snapshot.size === 1) appointmentId = snapshot.docs[0].id;
      else if (snapshot.size > 1) console.warn(`Wartenummer ${value} ist nicht eindeutig – keine Verknüpfung`);
    }

    if (!appointmentId) {
      removeAnonymousBookingCode(shopId, value);
      return false;
    }

    // Name aus dem Profil übernehmen
    const userData = (await getDoc(doc(firestore, 'users', userId))).data();
    const customerName = userData?.displayName || userData?.email?.split('@')[0] || 'Unbekannt';

    await updateAppointment(appointmentId, {
      customerId: userId,
      customerName,
      isAnonymous: false,
    });

    removeAnonymousBookingCode(shopId, value);
    return true;
  } catch (error) {
    console.error(`Fehler beim Verknüpfen der anonymen Buchung (${value}):`, error);
    return false;
  }
};
