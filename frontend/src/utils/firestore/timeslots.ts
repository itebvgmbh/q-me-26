import { getFirestore } from 'firebase/firestore';
import { collection, query, where, getDocs, doc, getDoc, Timestamp } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { TimeSlot } from '../types';
import { isTimeSlotAvailable } from './appointments';

/**
 * Holt verfügbare Zeitslots direkt aus Firestore ohne API-Aufruf
 * Diese Funktion ist für anonyme Benutzer gedacht, die keine API-Authentifizierung haben
 */
export const getAvailableTimeslotsDirect = async (
  shopId: string,
  serviceId: string,
  staffId: string | null,
  date: string
): Promise<TimeSlot[]> => {
  try {
    console.log(`Directly fetching timeslots from Firestore for ${shopId}_${serviceId}_${staffId}_${date}`);
    
    const db = getFirestore(firebaseApp);
    
    // Variablen für spätere Verwendung
    let serviceData: any;
    let shopData: any;
    let staffData: any;
    let serviceDuration: number;
    let setupTime: number = 0;
    let totalDuration: number;
    let businessHoursByDay: any[] = [];
    let workingHours: any[] = [];
    
    // Direkte Dokumentabfrage über die Dokument-ID probieren
    if (!staffId) {
      console.error('StaffId is required for direct Firestore access');
      return [];
    }

    try {
      // Service-Daten abrufen (für Dauer)
      console.log(`Fetching service data for serviceId: ${serviceId}`);
      const serviceDoc = await getDoc(doc(db, 'services', serviceId));
      if (!serviceDoc.exists()) {
        console.error(`Service nicht gefunden: ${serviceId}`);
        return [];
      }
      serviceData = serviceDoc.data();
      console.log('Service data found:', { id: serviceId, duration: serviceData.duration });
      
      // Shop-Daten abrufen (für Öffnungszeiten)
      console.log(`Fetching shop data for shopId: ${shopId}`);
      const shopDoc = await getDoc(doc(db, 'shops', shopId));
      if (!shopDoc.exists()) {
        console.error(`Shop nicht gefunden: ${shopId}`);
        return [];
      }
      shopData = shopDoc.data();
      console.log('Shop data found with business hours:', { id: shopId, businessHours: shopData.businessHoursByDay?.length });
      
      // Mitarbeiter-Daten abrufen (für Arbeitszeiten)
      console.log(`Fetching staff data for staffId: ${staffId}`);
      const staffDoc = await getDoc(doc(db, 'staff', staffId));
      if (!staffDoc.exists()) {
        console.error(`Mitarbeiter nicht gefunden: ${staffId}`);
        return [];
      }
      staffData = staffDoc.data();
      console.log('Staff data found with working hours:', { id: staffId, workingHours: staffData.workingHours?.length });
    } catch (innerError) {
      console.log('Direkter Dokumentenzugriff fehlgeschlagen, probiere Query-basierte Suche');
      console.error(innerError);
      
      // Fallback zu Query-basierten Abfragen
      // 1. Service-Daten abrufen (für Dauer)
      const servicesRef = collection(db, 'services');
      const serviceQuery = query(servicesRef, where('id', '==', serviceId));
      const serviceSnap = await getDocs(serviceQuery);
      
      if (serviceSnap.empty) {
        console.error('Service nicht gefunden:', serviceId);
        return [];
      }
      serviceData = serviceSnap.docs[0].data();
      
      // 2. Shop-Daten abrufen (für Öffnungszeiten)
      const shopsRef = collection(db, 'shops');
      const shopQuery = query(shopsRef, where('id', '==', shopId));
      const shopSnap = await getDocs(shopQuery);
      
      if (shopSnap.empty) {
        console.error('Shop nicht gefunden:', shopId);
        return [];
      }
      shopData = shopSnap.docs[0].data();
      
      // 3. Mitarbeiter-Daten abrufen (für Arbeitszeiten)
      const staffRef = collection(db, 'staff');
      const staffQuery = query(staffRef, where('id', '==', staffId));
      const staffSnap = await getDocs(staffQuery);
      
      if (staffSnap.empty) {
        console.error('Mitarbeiter nicht gefunden:', staffId);
        return [];
      }
      staffData = staffSnap.docs[0].data();
    }
    
    // Extrahiere benötigte Daten aus den Dokumenten
    serviceDuration = serviceData.duration;
    setupTime = serviceData.setupTime || 0;
    totalDuration = serviceDuration + setupTime;
    
    // Versuche, die neuen businessHoursByDay oder das alte businessHours-Format zu verwenden
    if (Array.isArray(shopData.businessHoursByDay) && shopData.businessHoursByDay.length > 0) {
      businessHoursByDay = shopData.businessHoursByDay;
      console.log('Verwende neues businessHoursByDay-Format mit', businessHoursByDay.length, 'Tagen');
    } else if (typeof shopData.businessHours === 'string') {
      // Wenn wir nur den alten String haben, generiere ein Default-Array mit den gleichen Stunden für alle Wochentage
      console.log('Verwende altes businessHours-Format mit Wert:', shopData.businessHours);
      try {
        // Versuche, das Format "HH:MM-HH:MM" zu parsen
        let defaultHours = shopData.businessHours.trim();
        let [defaultOpenTime, defaultCloseTime] = defaultHours.split('-').map(time => time.trim());
        
        if (defaultOpenTime && defaultCloseTime) {
          // Erzeuge Standard-Geschäftszeiten für Mo-Sa (in Firestore 0-5, in JS 1-6)
          businessHoursByDay = Array.from({ length: 7 }, (_, index) => ({
            dayOfWeek: index,
            isOpen: index > 0 && index < 6, // Mo-Fr geöffnet, Sa-So geschlossen
            openTime: defaultOpenTime,
            closeTime: defaultCloseTime
          }));
        } else {
          throw new Error('Ungültiges businessHours-Format');
        }
      } catch (e) {
        console.warn('Konnte businessHours nicht parsen:', e);
        // Fallback: Standardzeiten für die Woche generieren
        businessHoursByDay = Array.from({ length: 7 }, (_, index) => ({
          dayOfWeek: index,
          isOpen: index > 0 && index < 6, // Mo-Fr geöffnet, Sa-So geschlossen
          openTime: '09:00',
          closeTime: '17:00'
        }));
      }
    } else {
      // Wenn keine Geschäftszeiten definiert sind, standard verwenden
      console.warn('Keine Geschäftszeiten gefunden, verwende Standard-Geschäftszeiten');
      businessHoursByDay = Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index,
        isOpen: index > 0 && index < 6, // Mo-Fr geöffnet, Sa-So geschlossen
        openTime: '09:00',
        closeTime: '17:00'
      }));
    }
    
    workingHours = staffData.workingHours || [];
    
    // Datum in JavaScript Date konvertieren
    const dateParts = date.split('-');
    if (dateParts.length !== 3) {
      console.error(`Invalid date format: ${date}, expected YYYY-MM-DD`);
      return [];
    }
    
    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; // Monate sind 0-indexed in JavaScript
    const day = parseInt(dateParts[2]);
    
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      console.error(`Invalid date parts: year=${year}, month=${month+1}, day=${day}`);
      return [];
    }
    
    console.log(`Creating date object for: ${year}-${month+1}-${day}`);
    const dateObj = new Date(year, month, day);
    
    // Verifiziere, dass das Datum gültig ist
    if (isNaN(dateObj.getTime())) {
      console.error(`Invalid date created: ${dateObj}`);
      return [];
    }
    
    // Wochentag ermitteln (0 = Sonntag, 1 = Montag, ..., 6 = Samstag)
    const dayOfWeek = dateObj.getDay();
    console.log(`Prüfe Öffnungszeiten für Datum ${date}, Tag der Woche: ${dayOfWeek}`);
    
    // 5. Shop-Öffnungszeiten für diesen Wochentag finden
    // Firestore speichert Tage als 0 = Montag, ... 6 = Sonntag
    // JavaScript verwendet 0 = Sonntag, ... 6 = Samstag
    // Daher müssen wir konvertieren
    const firestoreDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    console.log(`Firestore-Tag der Woche: ${firestoreDayOfWeek}`);
    
    // Prüfe, ob wir gültige Geschäftszeiten haben
    if (!Array.isArray(businessHoursByDay) || businessHoursByDay.length === 0) {
      console.error('Keine Geschäftszeiten für den Shop definiert');
      // Statt Fehler abbrechen, generiere Standardwerte
      console.log('Erstelle Standard-Geschäftszeiten');
      businessHoursByDay = Array.from({ length: 7 }, (_, index) => ({
        dayOfWeek: index,
        isOpen: index > 0 && index < 6, // Mo-Fr geöffnet, Sa-So geschlossen
        openTime: '09:00',
        closeTime: '17:00'
      }));
    }
    
    const businessHoursForDay = businessHoursByDay.find(bh => bh.dayOfWeek === firestoreDayOfWeek);
    console.log(`Business hours for day ${firestoreDayOfWeek}:`, businessHoursForDay);
    
    if (!businessHoursForDay || !businessHoursForDay.isOpen) {
      console.log(`Shop ist an diesem Tag (${dayOfWeek}, Firestore: ${firestoreDayOfWeek}) geschlossen`);
      console.log('Verfügbare Geschäftszeiten:', businessHoursByDay);
      return [];
    }
    
    // 6. Mitarbeiter-Arbeitszeiten für diesen Wochentag finden
    // Gleiche Konvertierung wie bei den Geschäftszeiten
    // Prüfe, ob wir gültige Arbeitszeiten haben
    if (!Array.isArray(workingHours) || workingHours.length === 0) {
      console.error('Keine Arbeitszeiten für den Mitarbeiter definiert');
      return [];
    }
    
    const workingHoursForDay = workingHours.find(wh => wh.dayOfWeek === firestoreDayOfWeek);
    console.log(`Working hours for day ${firestoreDayOfWeek}:`, workingHoursForDay);
    
    if (!workingHoursForDay || !workingHoursForDay.isWorking) {
      console.log(`Mitarbeiter arbeitet an diesem Tag (${dayOfWeek}, Firestore: ${firestoreDayOfWeek}) nicht`);
      console.log('Verfügbare Arbeitszeiten:', workingHours);
      return [];
    }

    // 7. Verfügbare Zeitslots berechnen
    // Shop-Öffnungszeiten in Minuten seit Mitternacht konvertieren
    if (!businessHoursForDay.openTime || !businessHoursForDay.closeTime) {
      console.error('Ungültige Öffnungszeiten-Formate:', businessHoursForDay);
      return [];
    }
    
    let shopOpenHours, shopOpenMinutes, shopCloseHours, shopCloseMinutes;
    try {
      [shopOpenHours, shopOpenMinutes] = businessHoursForDay.openTime.split(':').map(Number);
      [shopCloseHours, shopCloseMinutes] = businessHoursForDay.closeTime.split(':').map(Number);
      
      // Verifikation der Zeitwerte
      if (isNaN(shopOpenHours) || isNaN(shopOpenMinutes) || isNaN(shopCloseHours) || isNaN(shopCloseMinutes)) {
        throw new Error(`Ungültige Zeitformate: open=${businessHoursForDay.openTime}, close=${businessHoursForDay.closeTime}`);
      }
    } catch (error) {
      console.error('Fehler beim Parsen der Öffnungszeiten:', error);
      return [];
    }
    
    const shopOpenMinutesSinceMidnight = shopOpenHours * 60 + shopOpenMinutes;
    const shopCloseMinutesSinceMidnight = shopCloseHours * 60 + shopCloseMinutes;
    
    console.log(`Shop hours: ${shopOpenHours}:${shopOpenMinutes} - ${shopCloseHours}:${shopCloseMinutes}`);

    // Mitarbeiter-Arbeitszeiten in Minuten seit Mitternacht konvertieren
    if (!workingHoursForDay.startTime || !workingHoursForDay.endTime) {
      console.error('Ungültige Arbeitszeiten-Formate:', workingHoursForDay);
      return [];
    }
    
    let staffStartHours, staffStartMinutes, staffEndHours, staffEndMinutes;
    try {
      [staffStartHours, staffStartMinutes] = workingHoursForDay.startTime.split(':').map(Number);
      [staffEndHours, staffEndMinutes] = workingHoursForDay.endTime.split(':').map(Number);
      
      // Verifikation der Zeitwerte
      if (isNaN(staffStartHours) || isNaN(staffStartMinutes) || isNaN(staffEndHours) || isNaN(staffEndMinutes)) {
        throw new Error(`Ungültige Zeitformate: start=${workingHoursForDay.startTime}, end=${workingHoursForDay.endTime}`);
      }
    } catch (error) {
      console.error('Fehler beim Parsen der Arbeitszeiten:', error);
      return [];
    }
    
    const staffStartMinutesSinceMidnight = staffStartHours * 60 + staffStartMinutes;
    const staffEndMinutesSinceMidnight = staffEndHours * 60 + staffEndMinutes;
    
    console.log(`Staff hours: ${staffStartHours}:${staffStartMinutes} - ${staffEndHours}:${staffEndMinutes}`);

    // Effektive Arbeitszeit berechnen (Schnittmenge aus Shop-Öffnungszeiten und Mitarbeiter-Arbeitszeiten)
    const effectiveStartMinutes = Math.max(shopOpenMinutesSinceMidnight, staffStartMinutesSinceMidnight);
    const effectiveEndMinutes = Math.min(shopCloseMinutesSinceMidnight, staffEndMinutesSinceMidnight);

    if (effectiveStartMinutes >= effectiveEndMinutes) {
      console.log('Keine Überschneidung zwischen Shop-Öffnungszeiten und Mitarbeiter-Arbeitszeiten');
      return [];
    }

    // 8. Zeitslots in 15-Minuten-Intervallen erstellen
    const timeSlots: TimeSlot[] = [];
    const intervalMinutes = 15; // 15-Minuten-Intervalle

    // Startzeit auf das nächste 15-Minuten-Intervall aufrunden
    const startMinutesRounded = Math.ceil(effectiveStartMinutes / intervalMinutes) * intervalMinutes;

    for (let minutes = startMinutesRounded; minutes + totalDuration <= effectiveEndMinutes; minutes += intervalMinutes) {
      const startHour = Math.floor(minutes / 60);
      const startMinute = minutes % 60;

      const endMinutes = minutes + totalDuration;
      const endHour = Math.floor(endMinutes / 60);
      const endMinute = endMinutes % 60;

      // Start- und Endzeit als Date-Objekte
      const startDate = new Date(dateObj);
      startDate.setHours(startHour, startMinute, 0, 0);

      const endDate = new Date(dateObj);
      endDate.setHours(endHour, endMinute, 0, 0);

      // 9. Prüfen, ob der Zeitslot verfügbar ist (keine Überschneidung mit bestehenden Terminen)
      const isAvailable = await isTimeSlotAvailable(
        shopId,
        staffId,
        Timestamp.fromDate(startDate),
        Timestamp.fromDate(endDate)
      );

      if (isAvailable) {
        timeSlots.push({
          start: startDate,
          end: endDate,
          isAvailable: true
        });
      }
    }

    console.log(`Directly found ${timeSlots.length} available timeslots for ${shopId}_${serviceId}_${staffId}_${date}`);
    // Debug: Zeige die Zeit-Details für jeden gefundenen Slot
    if (timeSlots.length > 0) {
      timeSlots.forEach((slot, index) => {
        console.log(`Slot ${index + 1}: ${slot.start.toLocaleTimeString()} - ${slot.end.toLocaleTimeString()}, verfügbar: ${slot.isAvailable}`);
      });
    } else {
      console.log('Keine Slots gefunden!');
    }
    return timeSlots;
  } catch (error) {
    console.error('Error directly fetching timeslots from Firestore:', error);
    return [];
  }
};
