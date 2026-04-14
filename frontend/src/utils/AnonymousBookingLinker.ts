import { collection, query, where, getDocs } from 'firebase/firestore';
import { firestore } from './firestore-client';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { updateAppointment } from './firestore';
import { getAnonymousBookingCodes, removeAnonymousBookingCode } from './localStorageUtils';
import { toast } from 'sonner';

/**
 * Versucht, alle anonymen Buchungen eines Benutzers zu verknüpfen
 * @param userId Die User-ID des angemeldeten Benutzers
 * @param specificShopId Optional: Spezifische Shop-ID für die Verknüpfung
 * @param specificReferenceCode Optional: Spezifischer Referenzcode für die Verknüpfung
 */
export const linkAnonymousBookingsToUser = async (userId: string, specificShopId?: string, specificReferenceCode?: string): Promise<void> => {
  try {
    let linkedCount = 0;
    
    // Fall 1: Spezifische Buchung verknüpfen (wenn Shop-ID und Referenzcode angegeben)
    if (specificShopId && specificReferenceCode) {
      console.log(`Versuche, spezifische anonyme Buchung zu verknüpfen: Shop=${specificShopId}, Referenz=${specificReferenceCode}`);
      const linked = await linkSingleAnonymousBooking(specificShopId, specificReferenceCode, userId);
      if (linked) linkedCount++;
    } 
    // Fall 2: Alle gespeicherten anonymen Buchungen verknüpfen
    else {
      const anonymousBookings = getAnonymousBookingCodes();
      console.log('Prüfe auf anonyme Buchungen für den Benutzer:', userId);
      console.log('Gefundene anonyme Buchungen:', anonymousBookings);
      
      // Durchlaufe alle Shops mit anonymen Buchungen
      for (const [shopId, referenceCodes] of Object.entries(anonymousBookings)) {
        for (const referenceCode of referenceCodes) {
          const linked = await linkSingleAnonymousBooking(shopId, referenceCode, userId);
          if (linked) linkedCount++;
        }
      }
    }
    
    if (linkedCount > 0) {
      // Zeige eine Erfolgsmeldung an
      toast.success(`${linkedCount} ${linkedCount === 1 ? 'anonymer Termin wurde' : 'anonyme Termine wurden'} mit Ihrem Konto verknüpft!`);
    }
  } catch (error) {
    console.error('Fehler beim Verknüpfen anonymer Buchungen:', error);
  }
};

/**
 * Verknüpft eine einzelne anonyme Buchung mit einem Benutzer
 * @param shopId Shop-ID der Buchung
 * @param referenceCode Referenzcode der anonymen Buchung
 * @param userId User-ID des Benutzers
 * @returns true wenn die Verknüpfung erfolgreich war, false sonst
 */
const linkSingleAnonymousBooking = async (shopId: string, referenceCode: string, userId: string): Promise<boolean> => {
  try {
    console.log(`Versuche, anonyme Buchung zu verknüpfen: Shop=${shopId}, Referenz=${referenceCode}, User=${userId}`);
    // Suche nach der Buchung anhand des Referenzcodes
    const appointmentsRef = collection(firestore, 'appointments');
    const q = query(
      appointmentsRef, 
      where('shopId', '==', shopId),
      where('referenceCode', '==', referenceCode),
      where('isAnonymous', '==', true)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.log('Keine anonyme Buchung gefunden mit diesem Referenzcode');
      // Entferne den Code aus dem localStorage, da er nicht mehr gültig ist
      removeAnonymousBookingCode(shopId, referenceCode);
      return false;
    }
    
    // Nehme die erste gefundene Buchung
    const appointmentDoc = querySnapshot.docs[0];
    const appointmentId = appointmentDoc.id;
    
    console.log(`Anonyme Buchung gefunden: ${appointmentId}, wird mit Benutzer ${userId} verknüpft`);
    
    // Hole zunächst die Benutzerinformationen, um den Namen einzutragen
    const db = getFirestore(firebaseApp);
    const userDoc = await getDoc(doc(db, 'users', userId));
    const userData = userDoc.data();
    // Gemäß Task QME-61: Verwende IMMER users.displayName wenn verfügbar
    // Verbessere die Namensermittlung mit mehr Fallbacks
    let customerName = userData?.displayName || '';
    
    if (!customerName) {
      // Wenn kein displayName vorhanden ist, hole den Benutzer direkt aus Firebase Auth
      try {
        const authUser = await getAuth(firebaseApp).getUser(userId);
        customerName = authUser.displayName || 
                      (authUser.email ? authUser.email.split('@')[0] : null) || 
                      userData?.email || '';
      } catch (error) {
        console.error('Fehler beim Abrufen des Firebase Auth Users:', error);
        customerName = userData?.email || '';
      }
    }
    
    if (!customerName) {
      customerName = 'Unbekannt';
    }
    
    // Aktualisiere die Buchung, um sie mit dem Benutzer zu verknüpfen
    await updateAppointment(appointmentId, {
      customerId: userId,
      customerName: customerName,
      isAnonymous: false
    });
    
    console.log(`Buchung ${appointmentId} erfolgreich mit Benutzer ${userId} verknüpft`);
    
    // Entferne den Code aus dem localStorage, da er jetzt verknüpft ist
    removeAnonymousBookingCode(shopId, referenceCode);
    
    return true;
  } catch (error) {
    console.error(`Fehler beim Verknüpfen der anonymen Buchung (${referenceCode}):`, error);
    return false;
  }
};