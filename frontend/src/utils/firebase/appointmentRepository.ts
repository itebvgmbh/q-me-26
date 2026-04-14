import { doc, getDoc, updateDoc, collection, addDoc, Timestamp } from 'firebase/firestore';
import { firestore } from '../firestore-client';
import { AppEventType, emitAppointmentUpdated, useEventStore } from './event-system';
import useTimeSlotStore from '../timeSlotStore';
import { safelyConvertToDate } from '../datetime';
import brain from 'brain';

/**
 * Accept an earlier appointment slot from a notification.
 * This function handles both the API call and local cache invalidation.
 * 
 * @param notificationId The ID of the notification to accept
 * @returns A promise that resolves when the operation is complete
 */
export const acceptEarlierAppointmentSlot = async (notificationId: string): Promise<boolean> => {
  try {
    console.log('Accepting earlier slot with notification ID:', notificationId);
    
    // Get notification details before making the API call to have the shop ID and timestamps
    const notificationRef = doc(firestore, 'earlier_slot_notifications', notificationId);
    const notificationDoc = await getDoc(notificationRef);
    if (!notificationDoc.exists()) {
      throw new Error('Notification not found');
    }
    
    // Store notification data for cache invalidation and event emitting
    const notificationData = notificationDoc.data();
    
    // Make the API call to accept the slot using the Brain client instead of fetch
    // This properly handles authentication tokens
    // The endpoint only needs the notification ID as a path parameter
    // The auth token is handled automatically by the Brain client
    const brainResponse = await brain.accept_earlier_slot({ 
      notificationId // The notification ID for the path parameter
    });
    
    // Handle the Brain client response format (differs from fetch API)
    const response = {
      ok: brainResponse.status >= 200 && brainResponse.status < 300,
      status: brainResponse.status,
      statusText: brainResponse.statusText,
      headers: new Headers(brainResponse.headers),
      json: async () => brainResponse.data
    };
    
    
    if (!response.ok) {
      console.error(`Error response from server: ${response.status} ${response.statusText}`);
      // Try to get error details if available
      let errorDetail = 'Unknown error';
      try {
        // Only try to parse response as JSON if it's JSON content type
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          errorDetail = errorData.detail || errorData.message || 'Unknown error';
        } else {
          // For non-JSON responses, just use the status text
          errorDetail = response.statusText;
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
      }
      throw new Error(`Failed to accept earlier slot: ${errorDetail}`);
    }
    
    // Parse the successful response
    let responseData;
    try {
      responseData = await response.json();
      console.log('Successfully accepted earlier slot:', responseData);
    } catch (parseError) {
      console.error('Error parsing success response:', parseError);
      // Continue even if we can't parse the response - the operation might have succeeded
    }
    
    // Comprehensive cache invalidation
    if (notificationData && notificationData.shopId) {
      const invalidateCache = useTimeSlotStore.getState().invalidateCache;
      const invalidateStaffCache = useTimeSlotStore.getState().invalidateStaffCache;
      
      // Convert dates from Firestore timestamps or strings
      const originalDate = safelyConvertToDate(notificationData.originalStartTime);
      const earlierDate = safelyConvertToDate(notificationData.earlierStartTime);
      
      // Shop-wide cache invalidation for both dates
      if (originalDate) {
        console.log('Invalidating shop-wide cache for original appointment date:', originalDate);
        invalidateCache(notificationData.shopId, originalDate);
      }
      
      if (earlierDate) {
        console.log('Invalidating shop-wide cache for new appointment date:', earlierDate);
        invalidateCache(notificationData.shopId, earlierDate);
      }
      
      // Staff-specific cache invalidation
      if (notificationData.staffId) {
        console.log(`Invalidating staff-specific cache for staff ${notificationData.staffId}:`);
        
        if (originalDate) {
          invalidateStaffCache(notificationData.shopId, notificationData.staffId, originalDate);
        }
        
        if (earlierDate) {
          invalidateStaffCache(notificationData.shopId, notificationData.staffId, earlierDate);
        }
      }
      
      // Emit event to update all subscribers
      const store = useEventStore.getState();
      store.publish({
        type: AppEventType.APPOINTMENT_UPDATED,
        payload: {
          appointmentId: notificationData.appointmentId,
          shopId: notificationData.shopId,
          staffId: notificationData.staffId,
          originalDate,
          newDate: earlierDate,
          isEarlierSlot: true
        },
        timestamp: Date.now()
      });
      
      // Also emit a specific EARLIER_SLOT_ACCEPTED event
      store.publish({
        type: AppEventType.EARLIER_SLOT_ACCEPTED,
        payload: {
          appointmentId: notificationData.appointmentId,
          shopId: notificationData.shopId,
          staffId: notificationData.staffId,
          originalDate,
          newDate: earlierDate,
          notificationId
        },
        timestamp: Date.now()
      });
    }
    
    // Mark notification as accepted locally
    try {
      await updateDoc(notificationRef, {
        isAccepted: true,
        isRead: true,
        acceptedAt: Timestamp.now()
      });
    } catch (updateError) {
      console.error('Error updating notification state:', updateError);
      // Continue since the backend already processed the acceptance
    }
    
    return true;
  } catch (error) {
    console.error('Error accepting earlier slot:', error);
    throw error;
  }
};
