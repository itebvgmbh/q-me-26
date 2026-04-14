// Central utility for accessing initialized Firestore instance
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';

// Export the initialized firestore instance
export const firestore = getFirestore(firebaseApp);
