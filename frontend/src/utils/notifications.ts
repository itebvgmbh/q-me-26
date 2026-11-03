import { collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';
import { firestore } from './firestore-client';
import type { EarlierSlotNotificationType } from './types';
import { tn } from '@/i18n';

/**
 * Load notifications about earlier available slots for a user
 * 
 * @param userId The ID of the user to load notifications for
 * @returns An array of notifications
 */
export const loadUserNotifications = async (userId: string): Promise<EarlierSlotNotificationType[]> => {
  console.log('Loading notifications for user ID:', userId);
  try {
    // Query notifications from Firestore
    const notificationsRef = collection(firestore, 'earlier_slot_notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', userId),
      where('isAccepted', '==', false)
    );
    
    console.log('Firestore query for notifications for user:', userId);
    
    const querySnapshot = await getDocs(q);
    const data = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    console.log('Found notifications:', data.length);
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.log('No notifications received from Firestore');
      return [];
    }

    // Convert Firestore data to notification objects with proper date handling
    const parsedNotifications = data.map((notification: any) => {
      try {
        // Make sure all fields are present
        return {
          ...notification,
          // Timestamp objects don't need conversion as safelyConvertToDate
          // already handles Firestore timestamps
          originalStartTime: notification.originalStartTime,
          originalEndTime: notification.originalEndTime,
          earlierStartTime: notification.earlierStartTime,
          earlierEndTime: notification.earlierEndTime,
          createdAt: notification.createdAt,
          isAccepted: notification.isAccepted === true, // Ensure boolean value
          isRead: notification.isRead === true
        };
      } catch (parseError) {
        console.error('Error parsing notification:', parseError, notification);
        return null;
      }
    }).filter(Boolean) // Remove null values from failed parsing
      // Abgelaufene Angebote gehören schon der nächsten Person in der Reihe
      .filter((n: any) => {
        if (n.status === 'expired') return false;
        const expires = n.expiresAt?.toDate ? n.expiresAt.toDate() : n.expiresAt ? new Date(n.expiresAt) : null;
        return !expires || expires.getTime() > Date.now();
      });
    
    console.log('Parsed notifications count:', parsedNotifications.length);
    console.log('Active notifications:', parsedNotifications.filter(n => !n.isAccepted).length);
    
    // Show toast if active notifications are available
    const activeNotifications = parsedNotifications.filter(n => !n.isAccepted);
    if (activeNotifications.length > 0) {
      toast.info(tn(activeNotifications.length, 'Ein früherer Platz ist frei geworden.', '{n} frühere Plätze sind frei geworden.'), {
        duration: 5000,
        id: 'earlier-slots-notification' // Prevent duplicate toasts
      });
    }
    
    return parsedNotifications;
  } catch (error) {
    console.error('Error loading notifications:', error);
    return [];
  }
};
