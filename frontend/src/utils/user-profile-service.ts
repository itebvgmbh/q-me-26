import { UserProfile, UserRole } from './types';
import { backendSenden, liveLesen } from './live';
import { listShopsOfOwner, getStaffByUserId } from './firestore';
import { gespeichertesGeraet, startseite } from './geraet';
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

/** Profil des angemeldeten Kontos über das Backend (GET /routes/konto/profil; Stufe 2, backend/app/libs/laeden.py).
 * null nur, wenn es wirklich keins gibt. Ohne Verbindung ein Fehler – das ist nicht dasselbe wie "kein Profil" (sonst
 * landet ein bestehendes Konto in der Rollenwahl, iPhone 27.10.2026). userId: nur das eigene Konto geht. */
export const loadUserProfile = async (_userId: string): Promise<UserProfile | null> =>
  (await liveLesen<{ profil: UserProfile | null }>('konto/profil', true)).profil;

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

/** Profil mit Rolle anlegen. Gibt es schon eins, bleibt es unverändert und wird zurückgegeben (das Backend legt es in
 * einer Transaktion an, damit ein Profil nie überschrieben wird). E-Mails vom Backend kommen in der gewählten Sprache. */
export const createUserProfile = async (uid: string, email: string, role: UserRole): Promise<UserProfile> => {
  const { profil } = await backendSenden<{ profil: UserProfile }>('konto/profil/anlegen', { email, role, language: sprache() });
  emitProfileSaved(uid, profil);
  return profil;
};

/** Eigenes Profil ändern (Name, Handynummer, Sprache …) */
export const saveOwnProfile = async (aenderung: Partial<UserProfile> & Record<string, unknown>): Promise<UserProfile> =>
  (await backendSenden<{ profil: UserProfile }>('konto/profil', { aenderung })).profil;

/** Sprache im Profil an die gerade gewählte angleichen (beim Laden des Profils): Wer die Sprache wechselt, bekommt
 * die nächsten E-Mails vom Backend in der neuen. Schlägt es fehl, bleibt die alte – kein Grund für eine Meldung. */
export const syncProfileLanguage = async (_userId: string, profile: UserProfile | null): Promise<void> => {
  if (!profile || profile.language === sprache() || !spracheGewaehlt()) return;
  try {
    await saveOwnProfile({ language: sprache() });
  } catch (error) {
    console.error('Sprache im Profil nicht gespeichert:', error);
  }
};

export const updateUserProfile = async (_userId: string, data: UpdateProfileData) => {
  await saveOwnProfile({ displayName: data.displayName, email: data.email, phone: data.phone });
  return true;
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
        if ((await listShopsOfOwner(userId)).length === 0) return '/shop-setup';
        // Das Gerät weiß, wofür es da ist (Tresen, eigenes Handy, Büro – utils/geraet.ts)
        const geraet = gespeichertesGeraet();
        return geraet ? startseite(geraet, true) : '/shop-dashboard';
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
