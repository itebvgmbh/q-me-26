// Hilfsfunktionen für das Arbeiten mit dem localStorage

// Schlüssel für die anonymen Referenzcodes
const ANONYMOUS_BOOKINGS_KEY = 'qme_anonymous_bookings';

/**
 * Speichert einen anonymen Buchungsreferenzcode im localStorage
 * @param shopId Die ID des Shops
 * @param referenceCode Der Referenzcode der Buchung
 */
export const saveAnonymousBookingCode = (shopId: string, referenceCode: string) => {
  try {
    // Lade vorhandene Codes
    const existingCodesString = localStorage.getItem(ANONYMOUS_BOOKINGS_KEY);
    const existingCodes = existingCodesString ? JSON.parse(existingCodesString) : {};
    
    // Füge den neuen Code hinzu
    if (!existingCodes[shopId]) {
      existingCodes[shopId] = [];
    }
    
    // Prüfe, ob der Code bereits vorhanden ist
    if (!existingCodes[shopId].includes(referenceCode)) {
      existingCodes[shopId].push(referenceCode);
    }
    
    // Speichere die aktualisierte Liste
    localStorage.setItem(ANONYMOUS_BOOKINGS_KEY, JSON.stringify(existingCodes));
    
    console.log('Anonymer Buchungscode gespeichert:', { shopId, referenceCode });
  } catch (error) {
    console.error('Fehler beim Speichern des anonymen Buchungscodes:', error);
  }
};

/**
 * Holt alle gespeicherten anonymen Buchungsreferencecodes
 * @returns Ein Objekt mit ShopIDs als Schlüssel und Arrays von Referenzcodes als Werte
 */
export const getAnonymousBookingCodes = (): Record<string, string[]> => {
  try {
    const codesString = localStorage.getItem(ANONYMOUS_BOOKINGS_KEY);
    return codesString ? JSON.parse(codesString) : {};
  } catch (error) {
    console.error('Fehler beim Abrufen der anonymen Buchungscodes:', error);
    return {};
  }
};

/**
 * Entfernt einen anonymen Buchungsreferenzcode aus dem localStorage
 * @param shopId Die ID des Shops
 * @param referenceCode Der Referenzcode der Buchung
 */
export const removeAnonymousBookingCode = (shopId: string, referenceCode: string) => {
  try {
    const existingCodesString = localStorage.getItem(ANONYMOUS_BOOKINGS_KEY);
    if (!existingCodesString) return;
    
    const existingCodes = JSON.parse(existingCodesString);
    if (!existingCodes[shopId]) return;
    
    // Entferne den Code
    existingCodes[shopId] = existingCodes[shopId].filter((code: string) => code !== referenceCode);
    
    // Entferne den Shop-Eintrag, wenn keine Codes mehr vorhanden sind
    if (existingCodes[shopId].length === 0) {
      delete existingCodes[shopId];
    }
    
    // Speichere die aktualisierte Liste
    localStorage.setItem(ANONYMOUS_BOOKINGS_KEY, JSON.stringify(existingCodes));
    
    console.log('Anonymer Buchungscode entfernt:', { shopId, referenceCode });
  } catch (error) {
    console.error('Fehler beim Entfernen des anonymen Buchungscodes:', error);
  }
};