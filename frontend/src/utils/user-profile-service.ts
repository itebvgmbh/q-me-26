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


// Benachrichtigt die Navigation, sobald ein Profil angelegt wurde (sonst fehlt nach der
// Registrierung die Rolle, weil das Profil vor dem Speichern schon einmal gelesen wurde)
type ProfileListener = (uid: string, profile: UserProfile) => void;
const profileListeners = new Set<ProfileListener>();
export const onProfileSaved = (listener: ProfileListener) => {
  profileListeners.add(listener);
  return () => {
    profileListeners.delete(listener);
  };
};
export const emitProfileSaved = (uid: string, profile: UserProfile) => profileListeners.forEach((listener) => listener(uid, profile));

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
    return null;
  } catch (error: any) {
    // Kein Toast: Aufrufer (Navigation, Login) entscheiden selbst, was angezeigt wird
    console.error('Error getting user profile:', error);
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
  emitProfileSaved(uid, profile);
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
      return '/my-bookings';
    default:
      return '/';
  }
};
