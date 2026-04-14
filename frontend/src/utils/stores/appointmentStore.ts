import { create } from 'zustand';
import { collection, query, where, getDocs, doc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { firestore } from '../firestore-client';
import { createAppointment as createAppointmentRepo, updateAppointment as updateAppointmentRepo, deleteAppointment as deleteAppointmentRepo } from '../firebase/repository';
import { AppEventType, useEventStore } from '../firebase/event-system';
import { Appointment } from '../firestore/types';
import { useCurrentUser } from 'app';

interface AppointmentState {
  customerAppointments: Appointment[];
  shopAppointments: Appointment[];
  staffAppointments: Record<string, Appointment[]>;
  loadingCustomerAppointments: boolean;
  loadingShopAppointments: boolean;
  loadingStaffAppointments: Record<string, boolean>;
  loadCustomerAppointments: (customerId: string) => Promise<Appointment[]>;
  loadShopAppointments: (shopId: string) => Promise<Appointment[]>;
  loadStaffAppointments: (staffId: string) => Promise<Appointment[]>;
  getAppointment: (appointmentId: string) => Promise<Appointment | null>;
  createAppointment: (appointmentData: any) => Promise<Appointment>;
  updateAppointment: (appointmentId: string, appointmentData: any) => Promise<Appointment>;
  cancelAppointment: (appointmentId: string) => Promise<void>;
  resetStore: () => void;
  cleanup: () => void;
}

const useAppointmentStore = create<AppointmentState>((set, get) => {
  // Event-Listener Setup
  let unsubscribeEvent: (() => void) | null = null;
  let unsubscribeTypeEvents: (() => void) | null = null;
  
  // Helper-Funktion zum Abrufen eines Termins nach ID
  const getAppointmentById = async (appointmentId: string): Promise<Appointment | null> => {
    try {
      const appointmentDoc = await getDoc(doc(firestore, 'appointments', appointmentId));
      if (!appointmentDoc.exists()) {
        return null;
      }
      return { id: appointmentDoc.id, ...appointmentDoc.data() } as Appointment;
    } catch (error) {
      console.error('Fehler beim Abrufen des Termins:', error);
      return null;
    }
  };
  
  // Initialisierer für Event-Subscription
  const initEventSubscription = () => {
    // Clean up any existing subscription
    if (unsubscribeEvent) {
      unsubscribeEvent();
      unsubscribeEvent = null;
    }
    
    if (unsubscribeTypeEvents) {
      unsubscribeTypeEvents();
      unsubscribeTypeEvents = null;
    }
    
    // Subscribe to all events for backwards compatibility
    unsubscribeEvent = useEventStore.getState().subscribe((event) => {
      // Basic event handling for all events
      console.log(`[AppointmentStore] Received event: ${event.type}`);
    });
    
    // Subscribe to specific event types for more efficient handling
    unsubscribeTypeEvents = useEventStore.getState().subscribeToMany(
      [
        AppEventType.APPOINTMENT_CREATED,
        AppEventType.APPOINTMENT_UPDATED,
        AppEventType.APPOINTMENT_DELETED,
        AppEventType.APPOINTMENT_CANCELLED,
        AppEventType.EARLIER_SLOT_ACCEPTED,
        AppEventType.CACHE_INVALIDATED
      ],
      (event) => {
        console.log(`[AppointmentStore] Processing typed event: ${event.type}`, event.payload);
        const { payload } = event;
        
        // Handle different events differently
        switch (event.type) {
          case AppEventType.APPOINTMENT_CREATED:
          case AppEventType.APPOINTMENT_UPDATED:
          case AppEventType.APPOINTMENT_DELETED:
          case AppEventType.APPOINTMENT_CANCELLED:
          case AppEventType.EARLIER_SLOT_ACCEPTED:
            // Extract IDs for refresh from payload
            const { customerId, shopId, staffId, appointmentId } = payload;
            
            // Aktualisiere die betroffenen Appointment-Listen
            if (customerId) {
              const appointments = get().customerAppointments;
              if (appointments.length > 0) {
                // Aktualisiere den Cache nur, wenn wir bereits Termine für diesen Kunden geladen haben
                get().loadCustomerAppointments(customerId);
              }
            }
            
            if (shopId) {
              const appointments = get().shopAppointments;
              if (appointments.length > 0) {
                // Aktualisiere den Cache nur, wenn wir bereits Termine für diesen Shop geladen haben
                get().loadShopAppointments(shopId);
              }
            }
            
            if (staffId) {
              const appointments = get().staffAppointments[staffId];
              if (appointments && appointments.length > 0) {
                // Aktualisiere den Cache nur, wenn wir bereits Termine für diesen Mitarbeiter geladen haben
                get().loadStaffAppointments(staffId);
              }
            }
            
            // If we have an appointment ID but no other IDs, try to reload the specific appointment
            if (appointmentId && !customerId && !shopId && !staffId) {
              console.log(`[AppointmentStore] Reloading specific appointment: ${appointmentId}`);
              get().getAppointment(appointmentId);
            }
            break;
            
          case AppEventType.CACHE_INVALIDATED:
            // Handle cache invalidation events
            const { shopId: shopIdCache, staffId: staffIdCache } = payload;
            
            // Only refresh if we have store data for this shop/staff
            if (shopIdCache && get().shopAppointments.length > 0) {
              console.log(`[AppointmentStore] Refreshing shop appointments after cache invalidation: ${shopIdCache}`);
              get().loadShopAppointments(shopIdCache);
            }
            
            if (shopIdCache && staffIdCache && get().staffAppointments[staffIdCache]?.length > 0) {
              console.log(`[AppointmentStore] Refreshing staff appointments after cache invalidation: ${staffIdCache}`);
              get().loadStaffAppointments(staffIdCache);
            }
            break;
            
          default:
            // Ignore other events
            break;
        }
      }
    );
  };
  
  // Initialisiere die Event-Subscription
  initEventSubscription();
  
  return {
    customerAppointments: [],
    shopAppointments: [],
    staffAppointments: {},
    loadingCustomerAppointments: false,
    loadingShopAppointments: false,
    loadingStaffAppointments: {},
    
    // Kundenspezifische Termine laden
    loadCustomerAppointments: async (customerId: string) => {
      set(state => ({ ...state, loadingCustomerAppointments: true }));
      try {
        const appointmentsRef = collection(firestore, 'appointments');
        const q = query(appointmentsRef, where('customerId', '==', customerId));
        const querySnapshot = await getDocs(q);
        
        const appointments = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Appointment[];
        
        set(state => ({
          ...state,
          customerAppointments: appointments,
          loadingCustomerAppointments: false
        }));
        
        return appointments;
      } catch (error) {
        console.error('Fehler beim Laden der Kundentermine:', error);
        set(state => ({ ...state, loadingCustomerAppointments: false }));
        return [];
      }
    },
    
    // Shop-spezifische Termine laden
    loadShopAppointments: async (shopId: string) => {
      set(state => ({ ...state, loadingShopAppointments: true }));
      try {
        const appointmentsRef = collection(firestore, 'appointments');
        const q = query(appointmentsRef, where('shopId', '==', shopId));
        const querySnapshot = await getDocs(q);
        
        const appointments = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Appointment[];
        
        set(state => ({
          ...state,
          shopAppointments: appointments,
          loadingShopAppointments: false
        }));
        
        return appointments;
      } catch (error) {
        console.error('Fehler beim Laden der Shop-Termine:', error);
        set(state => ({ ...state, loadingShopAppointments: false }));
        return [];
      }
    },
    
    // Mitarbeiter-spezifische Termine laden
    loadStaffAppointments: async (staffId: string) => {
      set(state => ({
        ...state,
        loadingStaffAppointments: {
          ...state.loadingStaffAppointments,
          [staffId]: true
        }
      }));
      
      try {
        const appointmentsRef = collection(firestore, 'appointments');
        const q = query(appointmentsRef, where('staffId', '==', staffId));
        const querySnapshot = await getDocs(q);
        
        const appointments = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Appointment[];
        
        set(state => ({
          ...state,
          staffAppointments: {
            ...state.staffAppointments,
            [staffId]: appointments
          },
          loadingStaffAppointments: {
            ...state.loadingStaffAppointments,
            [staffId]: false
          }
        }));
        
        return appointments;
      } catch (error) {
        console.error(`Fehler beim Laden der Termine für Mitarbeiter ${staffId}:`, error);
        set(state => ({
          ...state,
          loadingStaffAppointments: {
            ...state.loadingStaffAppointments,
            [staffId]: false
          }
        }));
        return [];
      }
    },
    
    // Termin nach ID abrufen
    getAppointment: async (appointmentId: string) => {
      return await getAppointmentById(appointmentId);
    },
    
    // Neuen Termin erstellen
    createAppointment: async (appointmentData: any) => {
      try {
        // Verwende das Repository zum Erstellen eines Termins
        // Das Repository kümmert sich um das Emittieren von Events
        const appointment = await createAppointmentRepo(appointmentData);
        return appointment as Appointment;
      } catch (error) {
        console.error('Fehler beim Erstellen des Termins:', error);
        throw error;
      }
    },
    
    // Termin aktualisieren
    updateAppointment: async (appointmentId: string, appointmentData: any) => {
      try {
        // Verwende das Repository zum Aktualisieren eines Termins
        // Das Repository kümmert sich um das Emittieren von Events
        const appointment = await updateAppointmentRepo(appointmentId, appointmentData);
        return appointment as Appointment;
      } catch (error) {
        console.error('Fehler beim Aktualisieren des Termins:', error);
        throw error;
      }
    },
    
    // Termin stornieren
    cancelAppointment: async (appointmentId: string) => {
      try {
        // Lade zuerst die vollständigen Termindaten für Event-Emission
        const appointment = await getAppointmentById(appointmentId);
        if (!appointment) {
          throw new Error('Termin nicht gefunden');
        }
        
        // Aktualisiere den Status auf 'cancelled'
        await updateAppointmentRepo(appointmentId, {
          status: 'cancelled',
          updatedAt: new Date()
        });
      } catch (error) {
        console.error('Fehler beim Stornieren des Termins:', error);
        throw error;
      }
    },
    
    // Store zurücksetzen
    resetStore: () => {
      set({
        customerAppointments: [],
        shopAppointments: [],
        staffAppointments: {},
        loadingCustomerAppointments: false,
        loadingShopAppointments: false,
        loadingStaffAppointments: {}
      });
      
      // Reinitialize event subscriptions to ensure they're working correctly
      initEventSubscription();
    },
    
    // Helper methods for refreshing specific collections
    refreshCustomerAppointments: async (customerId: string) => {
      if (!customerId) return;
      
      try {
        set(state => ({ ...state, loadingCustomerAppointments: true }));
        const appointments = await get().loadCustomerAppointments(customerId);
        return appointments;
      } catch (error) {
        console.error('Error refreshing customer appointments:', error);
        set(state => ({ ...state, loadingCustomerAppointments: false }));
        return [];
      }
    },
    
    refreshShopAppointments: async (shopId: string) => {
      if (!shopId) return;
      
      try {
        set(state => ({ ...state, loadingShopAppointments: true }));
        const appointments = await get().loadShopAppointments(shopId);
        return appointments;
      } catch (error) {
        console.error('Error refreshing shop appointments:', error);
        set(state => ({ ...state, loadingShopAppointments: false }));
        return [];
      }
    },
    
    refreshStaffAppointments: async (staffId: string) => {
      if (!staffId) return;
      
      try {
        set(state => ({
          ...state,
          loadingStaffAppointments: { ...state.loadingStaffAppointments, [staffId]: true }
        }));
        const appointments = await get().loadStaffAppointments(staffId);
        return appointments;
      } catch (error) {
        console.error('Error refreshing staff appointments:', error);
        set(state => ({
          ...state,
          loadingStaffAppointments: { ...state.loadingStaffAppointments, [staffId]: false }
        }));
        return [];
      }
    },
    
    // Resourcen freigeben (beim Unmount der Komponente aufrufen)
    cleanup: () => {
      if (unsubscribeEvent) {
        unsubscribeEvent();
        unsubscribeEvent = null;
      }
      
      if (unsubscribeTypeEvents) {
        unsubscribeTypeEvents();
        unsubscribeTypeEvents = null;
      }
    }
  };
});

export default useAppointmentStore;
