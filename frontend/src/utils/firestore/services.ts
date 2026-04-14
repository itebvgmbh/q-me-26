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