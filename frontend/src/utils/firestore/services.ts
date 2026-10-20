import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, addDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Service } from './types';

export const getServicesByShopId = async (shopId: string): Promise<Service[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const servicesRef = collection(db, 'services');
    const q = query(servicesRef, where('shopId', '==', shopId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Service[];
  } catch (error) {
    console.error('Error getting services:', error);
    throw error;
  }
};

export const getServiceById = async (shopId: string, serviceId: string): Promise<Service | null> => {
  try {
    const db = getFirestore(firebaseApp);
    const serviceRef = doc(db, 'services', serviceId);
    const serviceDoc = await getDoc(serviceRef);
    
    if (!serviceDoc.exists()) {
      return null;
    }
    
    const data = serviceDoc.data();
    // Überprüfen, ob der Service zum angegebenen Shop gehört
    if (data.shopId !== shopId) {
      console.warn('Service gefunden, gehört aber nicht zum angegebenen Shop');
      return null;
    }

    return { id: serviceDoc.id, ...data } as Service;
  } catch (error) {
    console.error('Error getting service by shopId and serviceId:', error);
    return null;
  }
};

// Alte Funktion für Abwärtskompatibilität
export const getServiceByIdLegacy = async (serviceId: string): Promise<Service | null> => {
  try {
    const db = getFirestore(firebaseApp);
    const serviceRef = doc(db, 'services', serviceId);
    const serviceDoc = await getDoc(serviceRef);
    
    if (!serviceDoc.exists()) {
      return null;
    }

    return { id: serviceDoc.id, ...serviceDoc.data() } as Service;
  } catch (error) {
    console.error('Error getting service:', error);
    throw error;
  }
};

export const createService = async (data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service> => {
  try {
    const db = getFirestore(firebaseApp);
    const serviceRef = doc(collection(db, 'services'));
    
    const now = Timestamp.now();
    const serviceData = {
      id: serviceRef.id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    
    await setDoc(serviceRef, serviceData);
    return serviceData;
  } catch (error) {
    console.error('Error creating service:', error);
    throw error;
  }
};

export const updateService = async (serviceId: string, updates: Partial<Omit<Service, 'id' | 'shopId' | 'createdAt' | 'updatedAt'>>): Promise<Service> => {
  try {
    const db = getFirestore(firebaseApp);
    const serviceRef = doc(db, 'services', serviceId);
    
    const now = Timestamp.now();
    const updateData = {
      ...updates,
      updatedAt: now
    };

    await setDoc(serviceRef, updateData, { merge: true });

    const updatedDoc = await getDoc(serviceRef);
    if (!updatedDoc.exists()) {
      throw new Error('Service not found after update');
    }

    return { id: updatedDoc.id, ...updatedDoc.data() } as Service;
  } catch (error) {
    console.error('Error updating service:', error);
    throw error;
  }
};

/**
 * Leistung löschen heißt: ausblenden. Termine verweisen mit serviceId auf die Leistung (Name, Dauer, Preis
 * in Tresen, Auswertung, Meine Termine) – würde das Dokument verschwinden, stünde dort nur noch "Leistung".
 * Ausgeblendete Leistungen bietet keine Auswahl mehr an; die Zuordnung bei Personen (staff.serviceIds) bleibt
 * stehen, damit beim Wiederherstellen alles wie vorher ist.
 */
export const isOffered = (service: Pick<Service, 'archived'>) => !service.archived;

/** Nur die Leistungen, die man buchen und zuordnen kann */
export const offeredServices = <T extends Pick<Service, 'archived'>>(services: T[]): T[] => services.filter(isOffered);

export const archiveService = async (serviceId: string): Promise<void> => {
  const db = getFirestore(firebaseApp);
  const now = Timestamp.now();
  await setDoc(doc(db, 'services', serviceId), { archived: true, archivedAt: now, updatedAt: now }, { merge: true });
};

export const restoreService = async (serviceId: string): Promise<void> => {
  const db = getFirestore(firebaseApp);
  await setDoc(doc(db, 'services', serviceId), { archived: false, updatedAt: Timestamp.now() }, { merge: true });
};

/** Wie viele kommende, nicht abgesagte Termine diese Leistung haben (für die Rückfrage beim Löschen) */
export const countUpcomingAppointmentsWithService = async (shopId: string, serviceId: string): Promise<number> => {
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(query(collection(db, 'appointments'), where('shopId', '==', shopId), where('serviceId', '==', serviceId)));
  const now = Date.now();
  return snapshot.docs.filter((d) => {
    const data = d.data();
    const end = data.endTime?.toMillis?.() ?? data.startTime?.toMillis?.() ?? 0;
    return end > now && data.status !== 'cancelled' && data.status !== 'completed';
  }).length;
};
