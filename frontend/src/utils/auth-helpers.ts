import { collection, query, where, getDocs } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseAuth } from 'app';
import { createUserWithEmailAndPassword, User } from 'firebase/auth';
import { createUserProfile } from './user-profile-service';
import { UserRole } from './types';

/**
 * Prüft, ob eine E-Mail schon als Mitarbeiter, Einladung oder Profil hinterlegt ist
 * (für die Mitarbeiterverwaltung). Kann Firestore nicht gelesen werden, gilt die
 * E-Mail als frei – vorher blockierte jeder Lesefehler das Anlegen komplett.
 */
export const isEmailInUse = async (email: string): Promise<boolean> => {
  const db = getFirestore(firebaseApp);
  try {
    for (const name of ['users', 'staff', 'staff-invitations']) {
      const snapshot = await getDocs(query(collection(db, name), where('email', '==', email)));
      if (!snapshot.empty) return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking email uniqueness:', error);
    return false;
  }
};

/**
 * Legt das Firebase-Konto an. Ob die E-Mail schon vergeben ist, entscheidet Firebase Auth
 * selbst (auth/email-already-in-use). Die frühere Vorprüfung in Firestore sperrte auch
 * Kunden, die schon einmal gebucht hatten, und Mitarbeiter mit offener Einladung.
 */
export const createFirebaseUser = async (email: string, password: string): Promise<User> => {
  const userCredential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  return userCredential.user;
};

/**
 * Konto anlegen und Profil mit Rolle speichern. Schlägt das Profil fehl, wird das Konto
 * wieder gelöscht – sonst wäre die E-Mail verbraucht und ein neuer Versuch unmöglich.
 */
export const registerWithRole = async (email: string, password: string, role: UserRole): Promise<User> => {
  const user = await createFirebaseUser(email, password);
  try {
    await createUserProfile(user.uid, email, role);
  } catch (error) {
    await user.delete().catch((deleteError) => console.error('Rollback of auth user failed:', deleteError));
    throw error;
  }
  return user;
};
