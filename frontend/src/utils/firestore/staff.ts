import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc, addDoc, updateDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { firebaseApp, APP_BASE_PATH } from 'app';
import { Staff, StaffInvitation, WorkingHours } from './types';
import brain from 'brain';
import { createUserProfile } from '../user-profile-service';

export const getShopStaff = async (shopId: string): Promise<Staff[]> => {
  const db = getFirestore(firebaseApp);
  const staffRef = collection(db, 'staff');
  const q = query(staffRef, where('shopId', '==', shopId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Staff));
};

export const createStaff = async (staffData: Omit<Staff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Staff> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(collection(db, 'staff'));
    
    const now = Timestamp.now();
    const newStaff: Staff = {
      id: staffRef.id,
      ...staffData,
      createdAt: now,
      updatedAt: now,
      status: 'available',
    };
    
    await setDoc(staffRef, newStaff);
    return newStaff;
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
    const updateData = {
      ...updates,
      updatedAt: now
    };

    await setDoc(staffRef, updateData, { merge: true });

    const updatedDoc = await getDoc(staffRef);
    if (!updatedDoc.exists()) {
      throw new Error('Staff not found after update');
    }

    return { id: updatedDoc.id, ...updatedDoc.data() } as Staff;
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

export const deleteStaff = async (staffId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = doc(db, 'staff', staffId);
    await setDoc(staffRef, { isActive: false, updatedAt: Timestamp.now() }, { merge: true });
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

export const getStaffByUserId = async (userId: string): Promise<Staff | null> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = collection(db, 'staff');
    const q = query(staffRef, where('userId', '==', userId));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const staffDoc = querySnapshot.docs[0];
    return { id: staffDoc.id, ...staffDoc.data() } as Staff;
  } catch (error) {
    console.error('Error getting staff by user ID:', error);
    return null;
  }
};

// New function to update staff with user ID after authentication
export const updateStaffWithUserId = async (email: string, userId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const staffRef = collection(db, 'staff');
    const q = query(staffRef, where('email', '==', email));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const staffDoc = querySnapshot.docs[0];
      await updateDoc(doc(db, 'staff', staffDoc.id), {
        userId: userId,
        updatedAt: Timestamp.now()
      });
      console.log('Staff record updated with user ID');
    } else {
      console.error('No staff record found with email:', email);
    }
  } catch (error) {
    console.error('Error updating staff with user ID:', error);
    throw error;
  }
};

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
      await createUserProfile(staff.userId, staff.email, 'employee');
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

// Staff Invitation Functions
export const createStaffInvitation = async (shopId: string, email: string, sendEmail: boolean = true): Promise<StaffInvitation> => {
  try {
    const db = getFirestore(firebaseApp);
    const invitationRef = doc(collection(db, 'staff-invitations'));
    
    // Generate a unique token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    
    const now = Timestamp.now();
    // Set expiration to 7 days from now
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    
    const invitationData: StaffInvitation = {
      id: invitationRef.id,
      shopId,
      email,
      token,
      status: 'pending',
      expiresAt,
      createdAt: now,
      updatedAt: now,
      emailSent: false
    };
    
    await setDoc(invitationRef, invitationData);
    
    // Stellen Sie sicher, dass der Link domainunabhängig funktioniert
    // Prüfe, ob APP_BASE_PATH definiert und nicht leer ist
    let basePath = APP_BASE_PATH && APP_BASE_PATH !== '/' ? APP_BASE_PATH : '';
    
    // Stelle sicher, dass keine doppelten Slashes entstehen
    if (basePath && !basePath.endsWith('/')) {
      basePath += '/';
    } else if (!basePath) {
      basePath = '/';
    }
    
    const registrationLink = `${window.location.origin}${basePath}staff-registration?token=${token}`;
    console.log('Generated registration link:', registrationLink);
    
    // Send invitation email if requested
    if (sendEmail) {
      try {
        // Verwende den brain-Client anstelle von fetch
        const response = await brain.send_staff_invitation({
          invitation_id: invitationRef.id,
          shop_id: shopId,
          email: email,
          invitation_link: registrationLink
        });
        
        if (!response.ok) {
          console.error('Failed to send invitation email:', await response.text());
        } else {
          console.log('Invitation email sent successfully');
          
          // Aktualisiere den Einladungsdatensatz, um zu speichern, dass die E-Mail gesendet wurde
          // Überspringe das Update, wenn eine Platzhalter-ID verwendet wird (beginnt mit "temp-")
          if (!invitationRef.id.startsWith('temp-')) {
            await setDoc(invitationRef, {
              emailSent: true,
              emailSentAt: Timestamp.now()
            }, { merge: true });
          }
        }
      } catch (emailError) {
        console.error('Error sending invitation email:', emailError);
        // Continue even if email sending fails
      }
    }
    
    return invitationData;
  } catch (error) {
    console.error('Error creating staff invitation:', error);
    throw error;
  }
};

export const getStaffInvitation = async (token: string): Promise<StaffInvitation | null> => {
  try {
    const db = getFirestore(firebaseApp);
    const invitationsRef = collection(db, 'staff-invitations');
    const q = query(invitationsRef, where('token', '==', token));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const doc = querySnapshot.docs[0];
    const invitation = { id: doc.id, ...doc.data() } as StaffInvitation;

    // Check if invitation is expired
    if (invitation.expiresAt.toDate() < new Date()) {
      return null;
    }

    // Check if invitation is already used
    if (invitation.status === 'used') {
      return null;
    }

    return invitation;
  } catch (error) {
    console.error('Error getting staff invitation:', error);
    return null;
  }
};

export const useStaffInvitation = async (invitationId: string): Promise<void> => {
  try {
    const db = getFirestore(firebaseApp);
    const invitationRef = doc(db, 'staff-invitations', invitationId);
    
    await setDoc(invitationRef, {
      status: 'used',
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    console.error('Error using staff invitation:', error);
    throw error;
  }
};