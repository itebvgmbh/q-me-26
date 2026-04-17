import { doc, getDoc, updateDoc, setDoc, Timestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { UserProfile, UserRole } from './types';
import { getStaffByUserId } from './firestore';

export interface UpdateProfileData {
  displayName: string;
  email: string;
  phone: string;
}

import { toast } from 'sonner';

export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  console.log('Getting user profile for:', userId);
  try {
    const db = getFirestore(firebaseApp);
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      console.log('User profile found:', userDoc.data());
      return userDoc.data() as UserProfile;
    }
    console.log('No user profile found');
    toast.error('Kein Profil in der Datenbank gefunden! Bitte registrieren Sie sich.');
    return null;
  } catch (error: any) {
    console.error('Error getting user profile:', error);
    toast.error('Fehler beim Laden des Profils (Firestore): ' + (error.message || 'Unbekannt'));
    return null;
  }
};

export const createUserProfile = async (uid: string, email: string, role: UserRole): Promise<UserProfile> => {
  const db = getFirestore(firebaseApp);
  const now = Timestamp.now();
  
  const profile: UserProfile = {
    uid,
    email,
    role,
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, 'users', uid), profile);
  return profile;
};

export const updateUserProfile = async (userId: string, data: UpdateProfileData) => {
  try {
    const db = getFirestore(firebaseApp);
    const userRef = doc(db, 'users', userId);
    
    // Update user profile in Firestore
    await updateDoc(userRef, {
      displayName: data.displayName,
      email: data.email,
      phone: data.phone,
      updatedAt: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
};

export const getRedirectPath = async (userId: string): Promise<string> => {
  console.log('Getting redirect path for:', userId);
  const profile = await getUserProfile(userId);
  
  if (!profile) {
    console.log('No profile found, redirecting to role selection');
    return '/role-selection'; // Existing auth user needs to select role
  }

  // Redirect based on role
  console.log('Profile found, redirecting based on role:', profile.role);
  switch (profile.role) {
    case 'shopOwner':
      return '/shop-dashboard';
    case 'employee':
      const staff = await getStaffByUserId(userId);
      return staff ? '/employee-dashboard' : '/';
    case 'customer':
      return '/customer-dashboard';
    default:
      return '/';
  }
};
