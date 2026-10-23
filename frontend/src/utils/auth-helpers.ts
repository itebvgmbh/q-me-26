import { firebaseAuth } from 'app';
import { createUserWithEmailAndPassword, User } from 'firebase/auth';
import { createUserProfile } from './user-profile-service';
import { UserRole } from './types';

// Ob eine E-Mail im Team schon vorkommt, prüft findTeamMemberByEmail (utils/firestore/staff.ts) –
// nur im eigenen Laden. Kundenkonten und andere Läden sperren eine Einladung nicht mehr.

/** Grobe Prüfung, ob etwas wie eine E-Mail-Adresse aussieht */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

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
