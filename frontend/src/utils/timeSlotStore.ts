import { create } from 'zustand';
import brain from 'brain';
import { TimeSlot } from './types';
import { API_URL } from 'app';
import { getAvailableTimeslotsDirect } from './firestore/timeslots';
import { AppEventType, useEventStore } from './firebase/event-system';
import { firebaseAuth } from '../app/auth/firebase';


// Type für den Cache-Schlüssel
type CacheKey = string;

// Type für die Cache-Daten mit Zeitstempel
interface CachedData {
  timestamp: number;
  data: TimeSlot[];
}

// Interface für den Store-Zustand
interface TimeSlotsState {
  // Cache-Daten nach Schlüssel (shop_id + service_id + staff_id + date)
  cachedTimeSlots: Record<CacheKey, CachedData>;
  loading: Record<CacheKey, boolean>;
  
  // Hauptfunktion zum Abrufen von Zeitslots mit Caching
  getTimeSlots: (
    shopId: string,
    serviceId: string,
    staffId: string | null,
    date: Date,
    forceRefresh?: boolean,
    isAuthenticated?: boolean // Neuer Parameter für Authentifizierungsstatus
  ) => Promise<TimeSlot[]>;
  
  // Cache für einen bestimmten Shop und ein Datum invalidieren
  invalidateCache: (shopId: string, date: Date) => void;
  
  // Cache für einen bestimmten Schlüssel invalidieren
  invalidateCacheKey: (cacheKey: string) => void;
  
  // Cache für einen bestimmten Mitarbeiter invalidieren
  invalidateStaffCache: (shopId: string, staffId: string | null, date?: Date) => void;
  
  // Hilfsfunktion zum Erstellen des Cache-Schlüssels
  generateCacheKey: (
    shopId: string,
    serviceId: string,
    staffId: string | null,
    date: Date
  ) => CacheKey;
  
  // Extrahiere das Datum aus einem Cache-Schlüssel
  getDateFromCacheKey: (cacheKey: string) => string | null;
}

// Cache-Ablaufzeit in Millisekunden (4 Stunden)
// Längere Cache-Dauer, da sich Zeitslots nur durch Buchungen, Stornierungen oder Änderungen an Arbeitszeiten ändern
const CACHE_EXPIRY = 4 * 60 * 60 * 1000;

const useTimeSlotStore = create<TimeSlotsState>((set, get) => ({
  cachedTimeSlots: {},
  loading: {},
  
  // Hilfsfunktion zum Erstellen des Cache-Schlüssels
  generateCacheKey: (shopId, serviceId, staffId, date) => {
    // Formatiere das Datum als YYYY-MM-DD
    const adjustedDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    const dateString = adjustedDate.toISOString().split('T')[0];
    return `${shopId}_${serviceId}_${staffId || 'null'}_${dateString}`;
  },
  
  // Extrahiere das Datum aus einem Cache-Schlüssel
  getDateFromCacheKey: (cacheKey) => {
    const parts = cacheKey.split('_');
    if (parts.length >= 4) {
      return parts[3]; // Das Datum ist der vierte Teil (Index 3)
    }
    return null;
  },
  
  // Cache für einen bestimmten Schlüssel invalidieren
  invalidateCacheKey: (cacheKey) => {
    console.log(`Invalidating cache for key: ${cacheKey}`);
    set(state => {
      const newCachedTimeSlots = { ...state.cachedTimeSlots };
      delete newCachedTimeSlots[cacheKey];
      return { cachedTimeSlots: newCachedTimeSlots };
    });
  },
  
  // Cache für einen bestimmten Shop und ein Datum invalidieren
  invalidateCache: (shopId, date) => {
    const dateString = date.toISOString().split('T')[0];
    console.log(`Invalidating cache for shop ${shopId} and date ${dateString}`);
    
    // Finde alle passenden Cache-Schlüssel und lösche sie
    set(state => {
      const keysToInvalidate = Object.keys(state.cachedTimeSlots).filter(key => {
        // Prüfe, ob der Schlüssel den Shop-ID enthält
        const keyParts = key.split('_');
        if (keyParts.length < 2 || keyParts[0] !== shopId) return false;
        
        // Prüfe, ob der Schlüssel das Datum enthält
        const keyDate = get().getDateFromCacheKey(key);
        return keyDate === dateString;
      });
      
      if (keysToInvalidate.length === 0) {
        console.log(`No matching cache entries found for shop ${shopId} and date ${dateString}`);
        return state;
      }
      
      console.log(`Invalidating ${keysToInvalidate.length} cache entries for shop ${shopId} and date ${dateString}:`);
      keysToInvalidate.forEach(key => console.log(` - ${key}`));
      
      // Erstelle eine neue Cache-Map ohne die zu invalidierenden Schlüssel
      const newCachedTimeSlots = { ...state.cachedTimeSlots };
      keysToInvalidate.forEach(key => {
        delete newCachedTimeSlots[key];
      });
      
      // Emit cache invalidation event
      try {
        useEventStore.getState().publish({
          type: AppEventType.CACHE_INVALIDATED,
          payload: {
            shopId,
            date: dateString,
            keys: keysToInvalidate
          },
          timestamp: Date.now()
        });
        
        // Auch das Backend über Cache-Invalidierung informieren
        try {
          brain.get_available_timeslots({
            shop_id: shopId,
            service_id: "force_refresh", // Dummy service ID
            staff_id: null,
            date: dateString,
            force_refresh: true
          }, { secure: firebaseAuth.currentUser !== null }).catch(e => console.error('Error notifying backend of cache invalidation:', e));
        } catch (e) {
          console.error('Error notifying backend of cache invalidation:', e);
        }
      } catch (error) {
        console.error('Error publishing cache invalidation event:', error);
      }
      
      return { cachedTimeSlots: newCachedTimeSlots };
    });
  },
  
  // Cache für einen bestimmten Mitarbeiter invalidieren
  invalidateStaffCache: (shopId, staffId, date) => {
    
    console.log(`Invalidating cache for staff ${staffId} in shop ${shopId}${date ? ` on date ${date.toISOString().split('T')[0]}` : ''}`);
    
    // Finde alle passenden Cache-Schlüssel und lösche sie
    set(state => {
      const keysToInvalidate = Object.keys(state.cachedTimeSlots).filter(key => {
        // Prüfe, ob der Schlüssel den Shop-ID enthält
        const keyParts = key.split('_');
        if (keyParts.length < 4 || keyParts[0] !== shopId) return false;
        
        // Prüfe, ob der Schlüssel den Staff-ID enthält
        const keyStaffId = keyParts[2];
        const staffIdString = staffId ? String(staffId) : 'null';
        const staffIdMatches = keyStaffId === staffIdString;
        
        // Wenn ein Datum angegeben ist, prüfe auch das
        if (date) {
          const keyDate = get().getDateFromCacheKey(key);
          const dateString = date.toISOString().split('T')[0];
          return staffIdMatches && keyDate === dateString;
        }
        
        // Andernfalls nur nach Shop und Staff filtern
        return staffIdMatches;
      });
      
      if (keysToInvalidate.length === 0) {
        console.log(`No matching staff cache entries found`);
        return state;
      }
      
      console.log(`Invalidating ${keysToInvalidate.length} staff cache entries:`);
      keysToInvalidate.forEach(key => console.log(` - ${key}`));
      
      // Erstelle eine neue Cache-Map ohne die zu invalidierenden Schlüssel
      const newCachedTimeSlots = { ...state.cachedTimeSlots };
      keysToInvalidate.forEach(key => {
        delete newCachedTimeSlots[key];
      });
      
      // Emit cache invalidation event
      try {
        useEventStore.getState().publish({
          type: AppEventType.CACHE_INVALIDATED,
          payload: {
            shopId,
            staffId,
            date: date ? date.toISOString().split('T')[0] : null,
            keys: keysToInvalidate
          },
          timestamp: Date.now()
        });
        
        // Auch das Backend über Cache-Invalidierung für Mitarbeiter informieren
        if (date) {
          const dateString = date.toISOString().split('T')[0];
          try {
            brain.get_available_timeslots({
              shop_id: shopId,
              service_id: "force_refresh", // Dummy service ID
              staff_id: staffId,
              date: dateString,
              force_refresh: true
            }, { secure: firebaseAuth.currentUser !== null }).catch(e => console.error('Error notifying backend of staff cache invalidation:', e));
          } catch (e) {
            console.error('Error notifying backend of staff cache invalidation:', e);
          }
        }
      } catch (error) {
        console.error('Error publishing staff cache invalidation event:', error);
      }
      
      return { cachedTimeSlots: newCachedTimeSlots };
    });
  },
  
  // Hauptfunktion zum Abrufen von Zeitslots mit Caching
  getTimeSlots: async (shopId, serviceId, staffId, date, forceRefresh = false, isAuthenticatedArg?: boolean) => {
    // forceRefresh kann nun ein boolean oder ein timestamp sein
    const shouldRefresh = forceRefresh !== false;
    // Bestimme Authentifizierungsstatus, wenn nicht explizit übergeben
    const isAuthenticated = isAuthenticatedArg !== undefined ? isAuthenticatedArg : !!firebaseAuth.currentUser;
    
    // Wenn Parameter fehlen, leere Liste zurückgeben
    if (!shopId || !serviceId) {
      console.log('Invalid parameters for getTimeSlots');
      return [];
    }
    
    // Cache-Schlüssel generieren
    const cacheKey = get().generateCacheKey(shopId, serviceId, staffId, date);
    
    // Aktuelle Zeit für Cache-Prüfung
    const now = Date.now();
    
    // Prüfe Cache, wenn kein Refresh erzwungen wird
    if (
      !shouldRefresh && 
      get().cachedTimeSlots[cacheKey] && 
      now - get().cachedTimeSlots[cacheKey].timestamp < CACHE_EXPIRY
    ) {
      console.log(`Using cached timeslots for ${cacheKey}`);
      return get().cachedTimeSlots[cacheKey].data;
    }
    
    // Wenn bereits eine Anfrage läuft, warte auf diese
    if (get().loading[cacheKey]) {
      console.log(`Request for ${cacheKey} already in progress, waiting...`);
      // Warte auf Abschluss der laufenden Anfrage
      while (get().loading[cacheKey]) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return get().cachedTimeSlots[cacheKey]?.data || [];
    }
    
    // Markiere als "wird geladen"
    set(state => ({
      loading: { ...state.loading, [cacheKey]: true }
    }));
    
    try {
      console.log(`Fetching timeslots for ${cacheKey}`);
      
      // Vermeide Zeitzonen-Probleme beim Erstellen des Datumsstrings
      const adjustedDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      const dateStr = adjustedDate.toISOString().split('T')[0];
      
      // API-Aufruf - mit oder ohne Authentifizierung
      const requestPayload = {
        shop_id: shopId,
        service_id: serviceId,
        staff_id: staffId,
        date: dateStr,
        force_refresh: shouldRefresh
      };
      
      let timeSlots;
      if (isAuthenticated) {
        // Authentifizierter Benutzer - verwende normalen Endpunkt
        console.log('Using authenticated endpoint for timeslots');
        try {
          const response = await brain.get_available_timeslots(requestPayload);
          
          let data;
          // Verify if response has json method (might already be data)
          if (typeof response.json === 'function') {
            data = await response.json();
          } else {
            data = response;
          }
          
          // Konvertiere API-Response in TimeSlot-Objekte
          timeSlots = data.timeslots.map((slot: any) => ({
            start: new Date(slot.start_time),
            end: new Date(slot.end_time),
            isAvailable: slot.is_available
          }));
        } catch (apiError) {
          console.error("Authenticated API failed, falling back to direct Firestore access", apiError);
          timeSlots = await getAvailableTimeslotsDirect(shopId, serviceId, staffId, dateStr);
          console.log(`Found ${timeSlots?.length || 0} slots via direct Firestore access:`, timeSlots);
        }
      } else {
        // Nicht authentifiziert - verwende den dedizierten öffentlichen Endpunkt OHNE Authentifizierungs-Header
        console.log('Using endpoint for unauthenticated user timeslots with secure:false');
        try {
          const response = await brain.get_public_available_timeslots(requestPayload, { secure: false });
          let data;
          if (typeof response.json === 'function') {
            data = await response.json();
          } else {
            data = response;
          }
          timeSlots = data.timeslots.map((slot: any) => ({
            start: new Date(slot.start_time),
            end: new Date(slot.end_time),
            isAvailable: slot.is_available
          }));
          console.log(`Found ${timeSlots.length} slots via Brain API structure access`);
        } catch (apiError) {
          console.error("Direct API failed, falling back to direct Firestore access", apiError);
          timeSlots = await getAvailableTimeslotsDirect(shopId, serviceId, staffId, dateStr);
          console.log(`Found ${timeSlots.length} slots via direct Firestore access:`, timeSlots);
        }
      }
      
      // Speichere im Cache
      set(state => ({
        cachedTimeSlots: {
          ...state.cachedTimeSlots,
          [cacheKey]: {
            timestamp: now,
            data: timeSlots
          }
        },
        loading: { ...state.loading, [cacheKey]: false }
      }));
      
      return timeSlots;
    } catch (error) {
      console.error(`Error fetching timeslots for ${cacheKey}:`, error);
      // Fehler-Status setzen
      set(state => ({
        loading: { ...state.loading, [cacheKey]: false }
      }));
      return [];
    }
  }
}));

export default useTimeSlotStore;
