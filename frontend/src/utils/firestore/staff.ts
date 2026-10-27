import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, where, Timestamp, setDoc, writeBatch } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseAuth } from 'app';
import { Staff, WorkingHours } from './types';
import { createUserProfile } from '../user-profile-service';
import { contactRef, splitContact, withContacts } from './staff-contacts';
import { t } from '@/i18n';

export const getShopStaff = async (shopId: string): Promise<Staff[]> => {
  const db = getFirestore(firebaseApp);
  const staffRef = collection(db, 'staff');
  const q = query(staffRef, where('shopId', '==', shopId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Staff));
};

// E-Mail und Telefon gehen nicht an den öffentlichen Eintrag, sondern zu den Kontaktdaten des Ladens (staff-contacts.ts)
export const createStaff = async (staffData: Omit<Staff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Staff> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(collection(db, 'staff'));
    
    const now = Timestamp.now();
    const { rest, contact } = splitContact(staffData);
    const entry = {
      id: staffRef.id,
      ...rest,
      createdAt: now,
      updatedAt: now,
      status: 'available' as const,
    };
    const batch = writeBatch(db);
    batch.set(staffRef, entry);
    if (contact) batch.set(contactRef(db, staffData.shopId, staffRef.id), { ...contact, updatedAt: now });
    await batch.commit();
    return { ...entry, email: contact?.email ?? '', phone: contact?.phone ?? '' } as Staff;
  } catch (error) {
    console.error('Error creating staff:', error);
    throw error;
  }
};

export const updateStaff = async (staffId: string, updates: Partial<Omit<Staff, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Staff> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(db, 'staff', staffId);
    
    const now = Timestamp.now();
    const { rest, contact } = splitContact(updates);
    const batch = writeBatch(db);
    if (contact) {
      const shopId = updates.shopId ?? (await getDoc(staffRef)).data()?.shopId;
      if (!shopId) throw new Error('Staff not found for update');
      batch.set(contactRef(db, shopId, staffId), { ...contact, updatedAt: now }, { merge: true });
      // Kontaktdaten von früher am öffentlichen Eintrag gleich mit entfernen
      batch.set(staffRef, { ...rest, email: deleteField(), phone: deleteField(), updatedAt: now }, { merge: true });
    } else {
      batch.set(staffRef, { ...rest, updatedAt: now }, { merge: true });
    }
    await batch.commit();

    const updatedDoc = await getDoc(staffRef);
    if (!updatedDoc.exists()) {
      throw new Error('Staff not found after update');
    }

    return { id: updatedDoc.id, ...updatedDoc.data(), ...(contact ?? {}) } as Staff;
  } catch (error) {
    console.error('Error updating staff:', error);
    throw error;
  }
};

export const updateStaffWorkingHours = async (staffId: string, workingHours: WorkingHours[]): Promise<Staff> => {
  console.log('Updating staff working hours...', { staffId, workingHours });
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(db, 'staff', staffId);
    
    const now = Timestamp.now();
    const updateData = {
      workingHours,
      updatedAt: now
    };

    await setDoc(staffRef, updateData, { merge: true });
    console.log('Staff working hours updated successfully');

    // Fetch the updated document
    const updatedDoc = await getDoc(staffRef);
    if (!updatedDoc.exists()) {
      throw new Error('Staff not found after update');
    }

    return { id: updatedDoc.id, ...updatedDoc.data() } as Staff;
  } catch (error) {
    console.error('Error in updateStaffWorkingHours:', error);
    throw error;
  }
};

/**
 * Team-Vermerk shops/{shopId}/members/{uid} für die Firestore-Regeln (firestore.rules, isMember; backend/app/libs/team.py):
 * Ohne ihn sieht eine Person mit Konto die Kundenliste nicht und trägt keine Termine ein. Das Backend setzt ihn beim
 * Annehmen der Einladung und gleicht beim Start ab; hier pflegt ihn der Inhaber beim Deaktivieren und Zurückholen.
 */
const syncTeamMember = async (staffId: string, active: boolean): Promise<void> => {
  const db = getFirestore(firebaseApp);
  const staff = (await getDoc(doc(db, 'staff', staffId))).data();
  if (!staff?.userId || !staff?.shopId) return;
  const ref = doc(db, 'shops', staff.shopId, 'members', staff.userId);
  try {
    if (active) await setDoc(ref, { staffId, at: Timestamp.now() });
    else await deleteDoc(ref);
  } catch (error) {
    // Das Backend gleicht beim nächsten Start ab; die Person selbst ist schon geändert
    console.warn('Team-Vermerk nicht geändert:', error);
  }
};

export const deleteStaff = async (staffId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(db, 'staff', staffId);
    await setDoc(staffRef, { isActive: false, updatedAt: Timestamp.now() }, { merge: true });
    await syncTeamMember(staffId, false);
  } catch (error) {
    console.error('Error deleting staff:', error);
    throw error;
  }
};

export const getStaffByShopId = async (shopId: string): Promise<Staff[]> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = collection(db, 'staff');
    const q = query(staffRef, where('shopId', '==', shopId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Staff[];
  } catch (error) {
    console.error('Error getting staff:', error);
    throw error;
  }
};

/** Deaktivierte Person wieder ins Team holen (Konto und Termine sind noch verbunden) */
export const reactivateStaff = async (staffId: string): Promise<void> => {
  const db = getFirestore(firebaseApp);
  await setDoc(doc(db, 'staff', staffId), { isActive: true, updatedAt: Timestamp.now() }, { merge: true });
  await syncTeamMember(staffId, true);
};

/** Aktive Einträge eines Kontos – in mehreren Läden kann es mehrere geben. Deaktivierte sehen "Mein Tag" nicht mehr. */
export const getStaffEntriesByUserId = async (userId: string): Promise<Staff[]> => {
  const db = getFirestore(firebaseApp);
  const snapshot = await getDocs(query(collection(db, 'staff'), where('userId', '==', userId)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Staff)).filter((s) => s.isActive !== false);
};

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

/** Personen eines Ladens mit E-Mail und Telefon – nur für den Inhaber (Team verwalten) */
export const getStaffWithContacts = async (shopId: string): Promise<Staff[]> =>
  withContacts(getFirestore(firebaseApp), shopId, await getStaffByShopId(shopId));

/** Meldung, wenn findTeamMemberByEmail jemanden findet */
export const teamEmailMessage = (existing: Staff) =>
  existing.isActive === false
    ? t('{name} mit dieser E-Mail ist deaktiviert. Hol sie unten unter „Deaktiviert“ zurück ins Team.', { name: existing.name })
    : t('{name} hat diese E-Mail schon im Team.', { name: existing.name });

// Utility function to ensure staff has a user profile
export const ensureStaffUserProfile = async (staff: Staff): Promise<void> => {
  try {
    if (!staff.userId) {
      console.log('Staff has no userId, cannot create user profile:', staff.id);
      return;
    }

    // Check if user profile already exists
    const db = getFirestore(firebaseApp);
    const userDoc = await getDoc(doc(db, 'users', staff.userId));
    
    if (!userDoc.exists()) {
      console.log('Creating missing user profile for staff member:', staff.name);
      // Create the user profile with employee role
      // Das eigene Profil: die E-Mail kommt aus der Anmeldung (die Kontaktdaten der Person liest nur der Inhaber)
      await createUserProfile(staff.userId, staff.email || firebaseAuth.currentUser?.email || '', 'employee');
      console.log('User profile created successfully for staff ID:', staff.id);
    } else {
      console.log('User profile already exists for staff member:', staff.name);
    }
  } catch (error) {
    console.error('Error ensuring staff user profile:', error);
  }
};

// Function to ensure all staff members have user profiles
export const ensureAllStaffUserProfiles = async (): Promise<{ success: boolean, created: number, errors: number }> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = collection(db, 'staff');
    const q = query(staffRef, where('userId', '!=', null));
    const querySnapshot = await getDocs(q);
    
    let created = 0;
    let errors = 0;
    
    for (const doc of querySnapshot.docs) {
      const staff = { id: doc.id, ...doc.data() } as Staff;
      try {
        await ensureStaffUserProfile(staff);
        created++;
      } catch (error) {
        console.error(`Error creating user profile for staff ${staff.id}:`, error);
        errors++;
      }
    }
    
    return { success: true, created, errors };
  } catch (error) {
    console.error('Error ensuring all staff user profiles:', error);
    return { success: false, created: 0, errors: 1 };
  }
};
