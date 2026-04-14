import { create } from 'zustand';

// Definiere Ereignistypen für das Event-System
export enum AppEventType {
  TIME_SLOT_CHANGED = 'TIME_SLOT_CHANGED',
  APPOINTMENT_CREATED = 'APPOINTMENT_CREATED',
  APPOINTMENT_UPDATED = 'APPOINTMENT_UPDATED',
  APPOINTMENT_DELETED = 'APPOINTMENT_DELETED',
  APPOINTMENT_CANCELLED = 'APPOINTMENT_CANCELLED',
  TIMESLOT_CHANGED = 'TIMESLOT_CHANGED',
  EARLIER_SLOT_ACCEPTED = 'EARLIER_SLOT_ACCEPTED',
  CACHE_INVALIDATED = 'CACHE_INVALIDATED',
}

// Event-Interface
export interface AppEvent {
  type: AppEventType;
  payload: any;
  timestamp: number;
}

// Store für Events
interface EventState {
  events: AppEvent[];
  subscribe: (callback: (event: AppEvent) => void) => () => void;
  publish: (event: AppEvent) => void;
  clear: () => void;
}

// Event-Store erstellen
export const useEventStore = create<EventState>((set, get) => {
  const subscribers: ((event: AppEvent) => void)[] = [];
  const typeSubscribers: Record<AppEventType, ((event: AppEvent) => void)[]> = {
    [AppEventType.TIME_SLOT_CHANGED]: [],
    [AppEventType.APPOINTMENT_CREATED]: [],
    [AppEventType.APPOINTMENT_UPDATED]: [],
    [AppEventType.APPOINTMENT_DELETED]: [],
    [AppEventType.APPOINTMENT_CANCELLED]: [],
    [AppEventType.TIMESLOT_CHANGED]: [],
    [AppEventType.EARLIER_SLOT_ACCEPTED]: [],
    [AppEventType.CACHE_INVALIDATED]: [],
  };
  
  return {
    events: [],
    
    // Methode zum Abonnieren von Events
    subscribe: (callback) => {
      subscribers.push(callback);
      return () => {
        const index = subscribers.indexOf(callback);
        if (index > -1) {
          subscribers.splice(index, 1);
        }
      };
    },
    
    // Methode zum Abonnieren von bestimmten Event-Typen
    subscribeToType: (type: AppEventType, callback: (event: AppEvent) => void) => {
      typeSubscribers[type].push(callback);
      return () => {
        const index = typeSubscribers[type].indexOf(callback);
        if (index > -1) {
          typeSubscribers[type].splice(index, 1);
        }
      };
    },

    // Methode zum Abonnieren von mehreren Event-Typen
    subscribeToMany: (types: AppEventType[], callback: (event: AppEvent) => void) => {
      const unsubscribers: (() => void)[] = [];
      types.forEach(type => {
        unsubscribers.push(useEventStore.getState().subscribeToType(type, callback));
      });
      
      // Rückgabe einer Funktion zum Abmelden aller Abonnements
      return () => {
        unsubscribers.forEach(unsubscribe => unsubscribe());
      };
    },
    
    // Methode zum Veröffentlichen von Events
    publish: (event) => {
      set((state) => ({
        events: [...state.events, event],
      }));
      
      // Benachrichtige alle Abonnenten
      subscribers.forEach((callback) => callback(event));
      
      // Benachrichtige die typspezifischen Abonnenten
      if (typeSubscribers[event.type]) {
        typeSubscribers[event.type].forEach((callback) => callback(event));
      }
    },
    
    // Methode zum Löschen aller Events
    clear: () => set({ events: [] }),
  };
});

// Helper-Funktionen zum Emittieren spezifischer Events
export const emitTimeSlotChanged = (payload: any) => {
  const store = useEventStore.getState();
  store.publish({
    type: AppEventType.TIME_SLOT_CHANGED,
    payload,
    timestamp: Date.now(),
  });
};

export const emitAppointmentCreated = (payload: any) => {
  const store = useEventStore.getState();
  store.publish({
    type: AppEventType.APPOINTMENT_CREATED,
    payload,
    timestamp: Date.now(),
  });
};

export const emitAppointmentUpdated = (payload: any) => {
  const store = useEventStore.getState();
  store.publish({
    type: AppEventType.APPOINTMENT_UPDATED,
    payload,
    timestamp: Date.now(),
  });
};

export const emitAppointmentDeleted = (payload: any) => {
  const store = useEventStore.getState();
  store.publish({
    type: AppEventType.APPOINTMENT_DELETED,
    payload,
    timestamp: Date.now(),
  });
};
