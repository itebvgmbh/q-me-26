import { doc, getDoc, updateDoc, runTransaction, Timestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { UserProfile, UserRole } from './types';
import { listShopsOfOwner, getStaffByUserId } from './firestore';
import { sprache, spracheGewaehlt } from '@/i18n';

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

/** Profil laden: null nur, wenn es wirklich keins gibt. Ohne Verbindung zur Datenbank ein Fehler – das ist nicht
 * dasselbe wie "kein Profil" (sonst landet ein bestehendes Konto in der Rollenwahl, iPhone 27.10.2026). */
export const loadUserProfile = async (userId: string): Promise<UserProfile | null> => {
  const userDoc = await getDoc(doc(getFirestore(firebaseApp), 'users', userId));
  return userDoc.exists() ? (userDoc.data() as UserProfile) : null;
};

/** Wie loadUserProfile, aber jeder Fehler gilt als "kein Profil" – nur für Anzeigen, nie für Entscheidungen über die Rolle */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    return await loadUserProfile(userId);
  } catch (error: any) {
    // Kein Toast: Aufrufer (Navigation, Login) entscheiden selbst, was angezeigt wird
    console.error('Error getting user profile:', error);
    return null;
  }
};

/** Profil mit Rolle anlegen. Gibt es schon eins, bleibt es unverändert und wird zurückgegeben: In einer Transaktion,
 * damit ein Profil nie überschrieben wird und ohne Verbindung nichts für später vorgemerkt bleibt. */
export const createUserProfile = async (uid: string, email: string, role: UserRole): Promise<UserProfile> => {
  const db = getFirestore(firebaseApp);
  const ref = doc(db, 'users', uid);
  const now = Timestamp.now();
  const fresh: UserProfile = {
    uid,
    email,
    role,
    // E-Mails vom Backend an das Konto kommen in dieser Sprache (backend/app/i18n)
    language: sprache(),
    createdAt: now,
    updatedAt: now
  };

  const profile = await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) return existing.data() as UserProfile;
    tx.set(ref, fresh);
    return fresh;
  });
  emitProfileSaved(uid, profile);
  return profile;
};

/** Sprache im Profil an die gerade gewählte angleichen (beim Laden des Profils): Wer die Sprache wechselt, bekommt
 * die nächsten E-Mails vom Backend in der neuen. Schlägt es fehl, bleibt die alte – kein Grund für eine Meldung. */
export const syncProfileLanguage = async (userId: string, profile: UserProfile | null): Promise<void> => {
  if (!profile || profile.language === sprache() || !spracheGewaehlt()) return;
  try {
    await updateDoc(doc(getFirestore(firebaseApp), 'users', userId), { language: sprache() });
  } catch (error) {
    console.error('Sprache im Profil nicht gespeichert:', error);
  }
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
  let profile: UserProfile | null;
  try {
    profile = await loadUserProfile(userId);
  } catch (error) {
    // Ohne Verbindung nicht in die Rollenwahl, sondern auf die Startseite
    console.error('Profil für die Weiterleitung nicht geladen:', error);
    return '/';
  }

  if (!profile) {
    return '/role-selection'; // Konto ohne Profil (z. B. abgebrochene Registrierung)
  }

  // Redirect based on role
  console.log('Profile found, redirecting based on role:', profile.role);
  switch (profile.role) {
    case 'shopOwner':
      // Noch kein Laden: gleich in den Einrichtungsassistenten. Im Zweifel (Fehler beim Laden) an den
      // Tresen – sonst landet ein bestehender Betrieb im Assistenten und legt womöglich einen zweiten Laden an.
      try {
        return (await listShopsOfOwner(userId)).length > 0 ? '/shop-dashboard' : '/shop-setup';
      } catch (error) {
        console.error('Läden konnten nicht geladen werden:', error);
        return '/shop-dashboard';
      }
    case 'employee':
      const staff = await getStaffByUserId(userId);
      return staff ? '/employee-dashboard' : '/';
    case 'customer':
      return '/my-bookings';
    default:
      return '/';
  }
};
