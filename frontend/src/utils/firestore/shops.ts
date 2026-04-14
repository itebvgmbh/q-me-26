import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, addDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Shop } from './types';

export const getShopById = async (shopId: string): Promise<Shop | null> => {
  try {
    const db = getFirestore(firebaseApp);
    const shopRef = doc(db, 'shops', shopId);
    const shopDoc = await getDoc(shopRef);
    
    if (!shopDoc.exists()) {
      return null;
    }

    return { id: shopDoc.id, ...shopDoc.data() } as Shop;
  } catch (error) {
    console.error('Error getting shop by ID:', error);
    return null;
  }
};

export const getShopByOwner = async (idOrOwner: string): Promise<Shop | null> => {
  console.log('Getting shop by id or owner:', idOrOwner);
  const db = getFirestore(firebaseApp);
  const shopsRef = collection(db, 'shops');
  
  try {
    // Try to get shop by ID first
    const shopDoc = await getDoc(doc(db, 'shops', idOrOwner));
    if (shopDoc.exists()) {
      return { id: shopDoc.id, ...shopDoc.data() } as Shop;
    }

    // If not found, try to get by owner
    const q = query(shopsRef, where('owner', '==', idOrOwner));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    const shopData = snapshot.docs[0];
    return { id: shopData.id, ...shopData.data() } as Shop;
  } catch (error) {
    console.error('Error getting shop:', error);
    return null;
  }
};

export const createShop = async (ownerId: string, shopData: Omit<Shop, 'id' | 'owner' | 'createdAt' | 'updatedAt'>): Promise<Shop> => {
  console.log('Starting shop creation...');
  try {
    const db = getFirestore(firebaseApp);
    const shopsCollection = collection(db, 'shops');
    
    const now = Timestamp.now();
    const newShop = {
      ...shopData,
      owner: ownerId,
      createdAt: now,
      updatedAt: now
    };

    // Create a new document with auto-generated ID
    const docRef = await addDoc(shopsCollection, newShop);
    console.log('Shop document created with ID:', docRef.id);

    return {
      id: docRef.id,
      ...newShop
    } as Shop;
  } catch (error) {
    console.error('Error in createShop:', error);
    throw error;
  }
};

export const updateShop = async (shopId: string, shopData: Partial<Omit<Shop, 'id' | 'owner' | 'createdAt' | 'updatedAt'>>): Promise<Shop> => {
  console.log('Updating shop...', { shopId, shopData });
  try {
    const db = getFirestore(firebaseApp);
    const shopRef = doc(db, 'shops', shopId);
    
    const now = Timestamp.now();
    const updateData = {
      ...shopData,
      updatedAt: now
    };

    await setDoc(shopRef, updateData, { merge: true });
    console.log('Shop updated successfully');

    // Fetch the updated document
    const updatedDoc = await getDoc(shopRef);
    if (!updatedDoc.exists()) {
      throw new Error('Shop not found after update');
    }

    return { id: updatedDoc.id, ...updatedDoc.data() } as Shop;
  } catch (error) {
    console.error('Error in updateShop:', error);
    throw error;
  }
};

// Get all shops for a specific owner
export const getShopsByOwnerId = async (ownerId: string): Promise<Shop[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const shopsRef = collection(db, 'shops');
    console.log('Getting shops for owner:', ownerId);
    const q = query(shopsRef, where('owner', '==', ownerId));
    console.log('Query:', q);
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Shop[];
  } catch (error) {
    console.error('Error getting shops by owner:', error);
    return [];
  }
};

export const getShops = async (): Promise<Shop[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const shopsRef = collection(db, 'shops');
    const querySnapshot = await getDocs(shopsRef);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Shop[];
  } catch (error) {
    console.error('Error getting shops:', error);
    throw error;
  }
};