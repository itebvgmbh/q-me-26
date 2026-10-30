import { collection, doc, Firestore, getDocs } from 'firebase/firestore';
import type { Staff } from './types';

/**
 * Kontaktdaten der Personen im Team: shops/{shopId}/staff_contacts/{staffId} = { email, phone, inviteEmailTo }.
 *
 * Die Einträge in staff sind öffentlich – Buchen und Nummer ziehen ohne Anmeldung brauchen Name, Bild, Leistungen und
 * Arbeitszeiten. E-Mail und Telefon der Person und die Adresse, an die die Einladung ging, stehen deshalb hier: lesen
 * und pflegen darf sie nur der Inhaber (firestore.rules), inviteEmailTo schreibt das Backend
 * (app/apis/staff_invitation). Alte Einträge mit Kontaktdaten am staff-Eintrag zieht das Backend beim Start um
 * (app/libs/staff_contacts.py).
 */
export const STAFF_CONTACTS = 'staff_contacts';

/** Was der Inhaber an einer Person pflegt und nicht am öffentlichen Eintrag steht */
export const CONTACT_FIELDS = ['email', 'phone'] as const;

export type StaffContact = { email?: string; phone?: string; inviteEmailTo?: string };

export const contactRef = (db: Firestore, shopId: string, staffId: string) => doc(db, 'shops', shopId, STAFF_CONTACTS, staffId);

/** Teilt Felder für staff in den öffentlichen Teil und die Kontaktdaten (null = keine Kontaktfelder dabei) */
export const splitContact = <T extends Record<string, unknown>>(data: T): { rest: Omit<T, 'email' | 'phone'>; contact: StaffContact | null } => {
  const { email, phone, ...rest } = data as T & StaffContact;
  const contact: StaffContact = {};
  if (email !== undefined) contact.email = String(email ?? '').trim();
  if (phone !== undefined) contact.phone = String(phone ?? '').trim();
  return { rest: rest as Omit<T, 'email' | 'phone'>, contact: Object.keys(contact).length ? contact : null };
};

/** Kontaktdaten aller Personen eines Ladens (nur für den Inhaber; sonst leer) */
export const getStaffContacts = async (db: Firestore, shopId: string): Promise<Record<string, StaffContact>> => {
  try {
    const snap = await getDocs(collection(db, 'shops', shopId, STAFF_CONTACTS));
    return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as StaffContact]));
  } catch (error) {
    console.warn('Kontaktdaten des Teams nicht gelesen:', error);
    return {};
  }
};

/** Personen mit ihren Kontaktdaten (Team verwalten, Einladen, „E-Mail schon im Team?“) */
export const withContacts = async (db: Firestore, shopId: string, staff: Staff[]): Promise<Staff[]> => {
  const contacts = await getStaffContacts(db, shopId);
  return staff.map((s) => {
    const c = contacts[s.id];
    return c ? { ...s, email: c.email ?? s.email ?? '', phone: c.phone ?? s.phone ?? '', inviteEmailTo: c.inviteEmailTo ?? s.inviteEmailTo } : s;
  });
};
