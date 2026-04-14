import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import brain from 'brain';
import type { UpdateUserIdRequest } from '../brain/data-contracts';
import { firestore } from './firestore-client';
import type { EarlierSlotNotificationType } from './types';

/**
 * Load notifications about earlier available slots for a user
 * 
 * @param userId The ID of the user to load notifications for
 * @returns An array of notifications
 */
export const loadUserNotifications = async (userId: string): Promise<EarlierSlotNotificationType[]> => {
  console.log('Loading notifications for user ID:', userId);
  try {
    // First, check if there are any unknown_user notifications that might belong to this user
    try {
      const unknownResponse = await brain.get_unknown_user_notifications();
      if (unknownResponse.ok) {
        const unknownData = await unknownResponse.json();
        console.log('Found unknown user notifications:', unknownData.length);
        
        // For each unknown notification, check if the appointment belongs to the current user
        for (const notification of unknownData) {
          // Get the appointment ID from the notification
          const appointmentId = notification.appointmentId;
          if (!appointmentId) continue;
          
          // Check if this appointment belongs to the current user using Firestore query
          const appointmentRef = doc(firestore, 'appointments', appointmentId);
          const appointmentDoc = await getDoc(appointmentRef);
          
          if (appointmentDoc.exists()) {
            const appointmentData = appointmentDoc.data();
            if (appointmentData.customerId === userId) {
              // This appointment belongs to the current user, update the notification
              console.log('Found unknown notification that belongs to this user:', notification.id);
              
              // Create the request payload for the API
              const payload: UpdateUserIdRequest = {
                appointment_id: appointmentId,
                new_user_id: userId
              };
              
              const updateResponse = await brain.update_notification_user_id(payload);
              if (updateResponse.ok) {
                console.log('Updated notification with correct user ID');
              } else {
                console.error('Error updating notification:', await updateResponse.text());
              }
            }
          }
        }
      }
    } catch (unknownErr) {
      console.error('Error checking unknown user notifications:', unknownErr);
      // Continue with normal flow, this is just an additional check
    }
    
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
    }).filter(Boolean); // Remove null values from failed parsing
    
    console.log('Parsed notifications count:', parsedNotifications.length);
    console.log('Active notifications:', parsedNotifications.filter(n => !n.isAccepted).length);
    
    // Show toast if active notifications are available
    const activeNotifications = parsedNotifications.filter(n => !n.isAccepted);
    if (activeNotifications.length > 0) {
      toast.info(`${activeNotifications.length} frühere Terminoptionen verfügbar!`, {
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
