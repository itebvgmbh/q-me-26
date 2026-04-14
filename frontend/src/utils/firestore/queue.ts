import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, orderBy } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { QueueEntry } from './types';

// Queue management functions
export const addToQueue = async (data: Omit<QueueEntry, 'id' | 'joinedAt' | 'status' | 'createdAt' | 'updatedAt'>): Promise<QueueEntry> => {
  console.log('Adding customer to queue with data:', data);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = doc(collection(db, 'queue'));
    
    const now = Timestamp.now();
    const queueData: QueueEntry = {
      id: queueRef.id,
      ...data,
      joinedAt: now,
      status: 'waiting',
      createdAt: now,
      updatedAt: now
    };
    
    await setDoc(queueRef, queueData);
    return queueData;
  } catch (error) {
    console.error('Error adding to queue:', error);
    throw error;
  }
};

export const getShopQueue = async (shopId: string): Promise<QueueEntry[]> => {
  console.log('Getting queue for shop:', shopId);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = collection(db, 'queue');
    const q = query(
      queueRef,
      where('shopId', '==', shopId),
      where('status', '==', 'waiting'),
      orderBy('joinedAt', 'asc')
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as QueueEntry[];
  } catch (error) {
    console.error('Error getting shop queue:', error);
    return [];
  }
};

export const getCustomerQueueStatus = async (customerId: string): Promise<QueueEntry | null> => {
  console.log('Getting queue status for customer:', customerId);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = collection(db, 'queue');
    const q = query(
      queueRef,
      where('customerId', '==', customerId),
      where('status', '==', 'waiting')
    );
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }
    
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as QueueEntry;
  } catch (error) {
    console.error('Error getting customer queue status:', error);
    return null;
  }
};

export const updateQueueEntryStatus = async (entryId: string, status: 'waiting' | 'served' | 'cancelled'): Promise<QueueEntry> => {
  console.log(`Updating queue entry ${entryId} status to ${status}`);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = doc(db, 'queue', entryId);
    
    const now = Timestamp.now();
    const updateData = {
      status,
      updatedAt: now
    };
    
    await setDoc(queueRef, updateData, { merge: true });
    
    const updatedDoc = await getDoc(queueRef);
    if (!updatedDoc.exists()) {
      throw new Error('Queue entry not found after update');
    }
    
    return { id: updatedDoc.id, ...updatedDoc.data() } as QueueEntry;
  } catch (error) {
    console.error('Error updating queue status:', error);
    throw error;
  }
};

export const removeFromQueue = async (entryId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = doc(db, 'queue', entryId);
    await setDoc(queueRef, { status: 'cancelled', updatedAt: Timestamp.now() }, { merge: true });
  } catch (error) {
    console.error('Error removing from queue:', error);
    throw error;
  }
};

export const getQueuePosition = async (shopId: string, customerId: string): Promise<number> => {
  console.log(`Getting queue position for customer ${customerId} in shop ${shopId}`);
  try {
    const shopQueue = await getShopQueue(shopId);
    const position = shopQueue.findIndex(entry => entry.customerId === customerId);
    return position === -1 ? -1 : position + 1; // Return 1-based position or -1 if not found
  } catch (error) {
    console.error('Error getting queue position:', error);
    return -1;
  }
};

export const getCustomerActiveQueues = async (customerId: string): Promise<QueueEntry[]> => {
  console.log('Getting active queues for customer:', customerId);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = collection(db, 'queue');
    const q = query(
      queueRef,
      where('customerId', '==', customerId),
      where('status', '==', 'waiting')
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as QueueEntry[];
  } catch (error) {
    console.error('Error getting customer active queues:', error);
    return [];
  }
};

export const isCustomerInQueue = async (shopId: string, customerId: string): Promise<boolean> => {
  console.log(`Checking if customer ${customerId} is in queue for shop ${shopId}`);
  try {
    const db = getFirestore(firebaseApp);
    const queueRef = collection(db, 'queue');
    const q = query(
      queueRef,
      where('shopId', '==', shopId),
      where('customerId', '==', customerId),
      where('status', '==', 'waiting')
    );
    
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    console.error('Error checking if customer is in queue:', error);
    return false;
  }
};