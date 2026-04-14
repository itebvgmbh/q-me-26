import { collection, query, where, getDocs } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseAuth } from 'app';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { toast } from 'sonner';

/**
 * Checks if an email is already in use by any user (via Firebase Auth)
 * and in our custom user collections (staff, customers, users)
 */
export const isEmailInUse = async (email: string): Promise<boolean> => {
  try {
    console.log('Checking if email is in use:', email);
    
    // Check in users collection (for all user types)
    const db = getFirestore(firebaseApp);
    const usersRef = collection(db, 'users');
    const usersQuery = query(usersRef, where('email', '==', email));
    const usersSnapshot = await getDocs(usersQuery);
    
    if (!usersSnapshot.empty) {
      console.log('Email found in users collection');
      return true; // Email exists in users collection
    }

    // Check in staff collection
    const staffRef = collection(db, 'staff');
    const staffQuery = query(staffRef, where('email', '==', email));
    const staffSnapshot = await getDocs(staffQuery);
    
    if (!staffSnapshot.empty) {
      console.log('Email found in staff collection');
      return true; // Email exists in staff collection
    }

    // Check in staff-invitations collection
    const invitationsRef = collection(db, 'staff-invitations');
    const invitationsQuery = query(invitationsRef, where('email', '==', email));
    const invitationsSnapshot = await getDocs(invitationsQuery);
    
    if (!invitationsSnapshot.empty) {
      console.log('Email found in staff-invitations collection');
      return true; // Email exists in staff-invitations collection
    }

    // Check in customers collection
    const customersRef = collection(db, 'customers');
    const customersQuery = query(customersRef, where('email', '==', email));
    const customersSnapshot = await getDocs(customersQuery);
    
    if (!customersSnapshot.empty) {
      console.log('Email found in customers collection');
      return true; // Email exists in customers collection
    }

    console.log('Email is not in use');
    return false; // Email not found in any collection
  } catch (error) {
    console.error('Error checking email uniqueness:', error);
    // If there's an error, we should assume the email might be in use
    // to prevent potential duplicates
    return true;
  }
};

/**
 * Creates a Firebase Auth user with the given email and password
 * after checking if the email is already in use
 */
export const createFirebaseUser = async (email: string, password: string) => {
  // First check if email is already in use
  const emailInUse = await isEmailInUse(email);
  
  if (emailInUse) {
    throw new Error('Diese E-Mail-Adresse wird bereits verwendet.');
  }
  
  // Email is not in use, create Firebase Auth user
  try {
    const userCredential = await createUserWithEmailAndPassword(
      firebaseAuth,
      email,
      password
    );
    
    return userCredential.user;
  } catch (error: any) {
    // Handle Firebase Auth specific errors
    if (error.code === 'auth/email-already-in-use') {
      throw new Error('Diese E-Mail-Adresse wird bereits verwendet.');
    }
    throw error;
  }
};
