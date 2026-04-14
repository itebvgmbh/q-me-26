import { addDays, isAfter } from 'date-fns';
import useTimeSlotStore from './timeSlotStore';
import { TimeSlot } from './types';
import { isTimeSlotAvailable } from './firestore';
import { Timestamp } from 'firebase/firestore';
import { getShopById } from './firestore/shops';

// Standard-Pufferwert in Millisekunden (1 Minute)
const DEFAULT_BUFFER_TIME_MS = 60000;

/**
 * Findet den nächsten verfügbaren Zeitslot basierend auf den angegebenen Parametern.
 * 
 * @param shopId - Die Shop-ID
 * @param serviceId - Die Service-ID
 * @param staffId - Optional: Die Mitarbeiter-ID (null für Shop-Slots)
 * @param startingFromDate - Optional: Ab diesem Datum suchen (Standard: jetzt)
 * @param maxDaysToSearch - Optional: Maximale Anzahl an Tagen für die Suche (Standard: 14 Tage)
 * @returns Promise mit dem nächsten verfügbaren Zeitslot oder null, wenn keiner gefunden wurde
 */
export const findNextAvailableSlot = async (
  shopId: string,
  serviceId: string,
  staffId: string | null = null,
  startingFromDate: Date = new Date(),
  maxDaysToSearch: number = 14,
  isAuthenticated: boolean = true // Neuer Parameter für den Authentifizierungsstatus
): Promise<TimeSlot | null> => {
  console.log(`Suche nächsten verfügbaren Zeitslot für Shop ${shopId}, Service ${serviceId}, Mitarbeiter ${staffId || 'alle'}`);
  
  const timeSlotStore = useTimeSlotStore.getState();
  const now = new Date();
  // Für genauere Vergleiche berücksichtigen wir auch Slots, die gerade jetzt beginnen
  // indem wir eine kleine Toleranz für den Zeitvergleich einbauen
  
  // Shop-Informationen laden, um den shopspezifischen Puffer zu erhalten
  let bufferTimeMs = DEFAULT_BUFFER_TIME_MS;
  try {
    const shop = await getShopById(shopId);
    if (shop && shop.timeSlotBuffer !== undefined) {
      bufferTimeMs = shop.timeSlotBuffer;
    }
  } catch (error) {
    console.warn('Fehler beim Laden des Shop-Puffers, verwende Standardwert:', error);
  }
  
  // Durchsuche bis zu maxDaysToSearch Tage
  for (let dayOffset = 0; dayOffset < maxDaysToSearch; dayOffset++) {
    const searchDate = addDays(startingFromDate, dayOffset);
    console.log(`Suche für Datum: ${searchDate.toISOString().split('T')[0]}`);
    
    // Slots für diesen Tag abrufen
    const slots = await timeSlotStore.getTimeSlots(shopId, serviceId, staffId, searchDate, false, isAuthenticated);
    
    console.log(`${slots.length} Slots gefunden für Datum: ${searchDate.toISOString().split('T')[0]}`);
    if (slots.length > 0) {
      console.log('Verfügbare Slots:', slots.filter(s => s.isAvailable).length);
      console.log('Beispiel-Slot:', slots[0]);
    }
    
    // Einen verfügbaren Slot finden, der nach der aktuellen Zeit liegt
    // Am ersten Tag (heute) müssen wir die aktuelle Uhrzeit berücksichtigen
    
    // Filtere Slots die nach API-Response verfügbar sind
    const availableApiSlots = slots.filter(slot => {
      // Slot muss laut API verfügbar sein
      if (!slot.isAvailable) return false;
      
      // Wenn es der heutige Tag ist, muss der Slot in der Zukunft liegen
      // Wir verwenden einen kleinen Buffer, um Grenzfälle und Zeitsynchronisationsprobleme zu vermeiden
      const bufferTime = new Date(now.getTime() - bufferTimeMs); // Shop-spezifischer Puffer
      if (dayOffset === 0 && !isAfter(slot.start, bufferTime)) {
        return false;
      }
      
      return true;
    });
    
    // Jetzt prüfen wir jeden potenziell verfügbaren Slot mit derselben Logik, 
    // die beim Buchen verwendet wird
    let trulyAvailableSlot = null;
    
    // Sequentielle Prüfung mit isTimeSlotAvailable (dieselbe Methode wie beim Buchen)
    for (const slot of availableApiSlots) {
      // Zusätzliche Prüfung mit der Firestore-Überschneidungslogik
      try {
        // Diese Prüfung verwendet dieselbe Logik wie beim Buchen des Termins
        const isAvailable = await isTimeSlotAvailable(
          shopId, 
          staffId || '', 
          Timestamp.fromDate(slot.start),
          Timestamp.fromDate(slot.end)
        );
        
        if (isAvailable) {
          trulyAvailableSlot = slot;
          break; // Ersten wirklich verfügbaren Slot nehmen
        }
      } catch (error) {
        console.error('Fehler bei der Prüfung der Verfügbarkeit:', error);
        // Weiter mit nächstem Slot
      }
    }
    
    // Ersten wirklich verfügbaren Slot verwenden
    const availableSlot = trulyAvailableSlot;
    
    // Ersten verfügbaren Slot zurückgeben, wenn gefunden
    if (availableSlot) {
      console.log(`WIRKLICH verfügbarer Slot gefunden: ${availableSlot.start.toISOString()} - ${availableSlot.end.toISOString()}`);
      return availableSlot;
    }
  }
  
  // Kein verfügbarer Slot gefunden
  console.log('Kein verfügbarer Zeitslot gefunden');
  return null;
};

/**
 * Findet den nächsten verfügbaren Zeitslot bei jedem Mitarbeiter im Shop.
 * Nutzt den Mitarbeiter mit dem frühesten verfügbaren Slot.
 * 
 * @param shopId - Die Shop-ID
 * @param serviceId - Die Service-ID
 * @param staffIds - Liste von Mitarbeiter-IDs zum Durchsuchen
 * @param startingFromDate - Optional: Ab diesem Datum suchen (Standard: jetzt)
 * @param maxDaysToSearch - Optional: Maximale Anzahl an Tagen für die Suche (Standard: 14 Tage)
 * @returns Promise mit dem frühesten verfügbaren Zeitslot und Mitarbeiter-ID oder null
 */
export const findFirstAvailableSlotAcrossStaff = async (
  shopId: string,
  serviceId: string,
  staffIds: string[],
  startingFromDate: Date = new Date(),
  maxDaysToSearch: number = 14,
  isAuthenticated: boolean = true // Neuer Parameter für den Authentifizierungsstatus
): Promise<{ slot: TimeSlot; staffId: string } | null> => {
  console.log(`Suche frühesten verfügbaren Zeitslot über ${staffIds.length} Mitarbeiter hinweg`);
  
  // Resultat je Mitarbeiter speichern
  const staffResults: { staffId: string; slot: TimeSlot | null }[] = [];
  
  // Parallel für jeden Mitarbeiter suchen
  const searchPromises = staffIds.map(async staffId => {
    const slot = await findNextAvailableSlot(
      shopId,
      serviceId,
      staffId,
      startingFromDate,
      maxDaysToSearch,
      isAuthenticated // Übergabe des Authentifizierungsstatus
    );
    
    return { staffId, slot };
  });
  
  // Auf alle Suchen warten
  const results = await Promise.all(searchPromises);
  
  // Nur Ergebnisse mit verfügbaren Slots behalten
  const availableResults = results.filter(result => result.slot !== null);
  
  if (availableResults.length === 0) {
    console.log('Kein verfügbarer Zeitslot bei irgendeinem Mitarbeiter gefunden');
    return null;
  }
  
  // Nach frühestem Slot sortieren
  availableResults.sort((a, b) => {
    if (!a.slot || !b.slot) return 0;
    return a.slot.start.getTime() - b.slot.start.getTime();
  });
  
  // Frühesten verfügbaren Slot zurückgeben
  const firstAvailable = availableResults[0];
  console.log(`Frühester verfügbarer Slot gefunden bei Mitarbeiter ${firstAvailable.staffId}: ${firstAvailable.slot?.start.toISOString()}`);
  
  return firstAvailable.slot ? { 
    slot: firstAvailable.slot, 
    staffId: firstAvailable.staffId 
  } : null;
};
