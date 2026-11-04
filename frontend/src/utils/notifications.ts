import { toast } from 'sonner';
import type { EarlierSlotNotificationType } from './types';
import { eigeneAngebote } from './konto';
import { tn } from '@/i18n';

/**
 * Offene Angebote „Früher dran“ des angemeldeten Kontos (über das Backend, utils/konto.ts)
 *
 * @param _userId nur das eigene Konto geht
 * @returns An array of notifications
 */
export const loadUserNotifications = async (_userId: string): Promise<EarlierSlotNotificationType[]> => {
  try {
    const data = await eigeneAngebote();
    if (data.length === 0) return [];

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
