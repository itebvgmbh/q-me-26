import { doc, getDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseAuth } from 'app';
import { Staff, WorkingHours } from './types';
import { createUserProfile } from '../user-profile-service';
import { backendSenden, liveLesen } from '../live';
import { t } from '@/i18n';

/**
 * Personen eines Ladens über das Backend (requirements/eigene-datenbank.md, Stufe 2; backend/app/apis/team_laden und
 * backend/app/apis/live). Die Rechte sind dieselben wie bisher in firestore.rules: Anlegen, Ändern, Deaktivieren nur
 * der Inhaber, die Person selbst nur ihre Arbeitszeiten; Kontaktdaten (E-Mail, Telefon) liest und pflegt nur der
 * Inhaber (backend/app/libs/team_laden.py).
 *
 * Lesen gibt es in zwei Fassungen:
 * - getShopStaff / getStaffByShopId: öffentlich, für Buchen, Nummer ziehen und die Ladenseite – ohne Konto-ID,
 *   Einladung und Kontaktdaten.
 * - getTeamStaff / getStaffWithContacts: für Inhaber und Team – mit Konto-ID und Einladung, Kontaktdaten nur für den
 *   Inhaber.
 */

const personenPfad = (shopId: string) => `live/laden/${encodeURIComponent(shopId)}/personen`;
const teamPfad = (shopId: string) => `team/laden/${encodeURIComponent(shopId)}/personen`;

/** Öffentlich: alle Personen des Ladens, auch deaktivierte (die Aufrufer filtern selbst) */
export const getShopStaff = async (shopId: string): Promise<Staff[]> =>
  (await liveLesen<{ personen: Staff[] }>(personenPfad(shopId))).personen;

export const getStaffByShopId = getShopStaff;

/** Für Inhaber und Team: mit Konto-ID (z. B. „Nur ich“ am Tresen) und Stand der Einladung */
export const getTeamStaff = async (shopId: string): Promise<Staff[]> =>
  (await liveLesen<{ personen: Staff[] }>(teamPfad(shopId), true)).personen;

/** Personen eines Ladens mit E-Mail und Telefon – die Kontaktdaten bekommt nur der Inhaber (Team verwalten) */
export const getStaffWithContacts = getTeamStaff;

// E-Mail und Telefon gehen nicht an den öffentlichen Eintrag, sondern zu den Kontaktdaten des Ladens (das Backend trennt)
export const createStaff = async (staffData: Omit<Staff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Staff> =>
  (await backendSenden<{ person: Staff }>('team/personen', { person: staffData })).person;

export const updateStaff = async (staffId: string, updates: Partial<Omit<Staff, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Staff> =>
  (await backendSenden<{ person: Staff }>(`team/personen/${encodeURIComponent(staffId)}`, { aenderung: updates })).person;

/** Arbeitszeiten: darf der Inhaber und die Person selbst */
export const updateStaffWorkingHours = async (staffId: string, workingHours: WorkingHours[]): Promise<Staff> =>
  updateStaff(staffId, { workingHours });

/** Deaktivieren (Termine und Konto bleiben verbunden); den Team-Vermerk nimmt das Backend mit weg */
export const deleteStaff = async (staffId: string): Promise<void> => {
  await backendSenden(`team/personen/${encodeURIComponent(staffId)}/aktiv`, { aktiv: false });
};

/** Deaktivierte Person wieder ins Team holen (Konto und Termine sind noch verbunden) */
export const reactivateStaff = async (staffId: string): Promise<void> => {
  await backendSenden(`team/personen/${encodeURIComponent(staffId)}/aktiv`, { aktiv: true });
};

/** Aktive Einträge des angemeldeten Kontos – in mehreren Läden kann es mehrere geben. Deaktivierte sehen "Mein Tag" nicht mehr. */
export const getStaffEntriesByUserId = async (_userId: string): Promise<Staff[]> =>
  (await liveLesen<{ personen: Staff[] }>('team/ich/personen', true)).personen;

export const getStaffByUserId = async (userId: string): Promise<Staff | null> => {
  try {
    return (await getStaffEntriesByUserId(userId))[0] ?? null;
  } catch (error) {
    console.error('Error getting staff by user ID:', error);
    return null;
  }
};

/**
 * Gibt es diese E-Mail im Team dieses Ladens schon (auch deaktiviert)? Groß-/Kleinschreibung zählt nicht.
 * Andere Läden und Kundenkonten spielen keine Rolle: Wer schon ein Konto hat, meldet sich beim Einladungslink damit an.
 */
export const findTeamMemberByEmail = async (shopId: string, email: string, exceptStaffId?: string): Promise<Staff | null> => {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const team = await getStaffWithContacts(shopId);
  return team.find((s) => s.id !== exceptStaffId && (s.email || '').trim().toLowerCase() === wanted) ?? null;
};

/** Meldung, wenn findTeamMemberByEmail jemanden findet */
export const teamEmailMessage = (existing: Staff) =>
  existing.isActive === false
    ? t('{name} mit dieser E-Mail ist deaktiviert. Hol sie unten unter „Deaktiviert“ zurück ins Team.', { name: existing.name })
    : t('{name} hat diese E-Mail schon im Team.', { name: existing.name });

// Eigenes Profil anlegen, falls es fehlt (Bereich „Profil“ folgt; bis dahin direkt in Firestore wie bisher)
export const ensureStaffUserProfile = async (staff: Staff): Promise<void> => {
  try {
    if (!staff.userId) {
      console.log('Staff has no userId, cannot create user profile:', staff.id);
      return;
    }
    const db = getFirestore(firebaseApp);
    const userDoc = await getDoc(doc(db, 'users', staff.userId));
    if (!userDoc.exists()) {
      // Das eigene Profil: die E-Mail kommt aus der Anmeldung (die Kontaktdaten der Person liest nur der Inhaber)
      await createUserProfile(staff.userId, staff.email || firebaseAuth.currentUser?.email || '', 'employee');
    }
  } catch (error) {
    console.error('Error ensuring staff user profile:', error);
  }
};
