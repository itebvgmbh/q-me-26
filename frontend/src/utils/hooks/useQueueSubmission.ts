import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Timestamp } from 'firebase/firestore';
import { TimeSlot } from '../types';
import { createAppointment, createCustomer, isCustomerInQueue } from '../firestore';

/**
 * Hook to handle queue submission logic
 * @returns Function to handle joining the queue
 */
export const useQueueSubmission = () => {
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  /**
   * Handle joining the queue
   * @param params Queue submission parameters
   */
  const handleJoinQueue = async (params: {
    user: any;
    selectedShop: string;
    selectedService: string;
    selectedStaffForSlot: string;
    nextAvailableSlot: TimeSlot;
    checkEarlierOptions: boolean;
  }) => {
    const { user, selectedShop, selectedService, selectedStaffForSlot, nextAvailableSlot, checkEarlierOptions } = params;
    
    if (!user) {
      toast.error('Bitte melden Sie sich an');
      return;
    }

    if (!selectedShop || !selectedService || !nextAvailableSlot || !selectedStaffForSlot) {
      toast.error('Bitte füllen Sie alle Felder aus und warten Sie, bis ein verfügbarer Zeitslot gefunden wurde');
      return;
    }
    
    setSubmitting(true);
    try {
      // Check if the customer is already in the queue for this shop
      const alreadyInQueue = await isCustomerInQueue(selectedShop, user.uid);
      if (alreadyInQueue) {
        toast.error('Sie befinden sich bereits in der Warteschlange dieses Shops');
        return;
      }
      
      const startTime = nextAvailableSlot.start;
      const endTime = nextAvailableSlot.end;

      // Create customer record if this is their first interaction
      await createCustomer({
        shopId: selectedShop,
        name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
        email: user.email || '',
      });

      // Create a queue appointment
      await createAppointment({
        shopId: selectedShop,
        staffId: selectedStaffForSlot,
        customerId: user.uid,
        // Use users.displayName as per Task QME-61
        // Improved name determination with multiple fallbacks
        customerName: user.displayName || 
                     (user.email ? user.email.split('@')[0] : null) || 
                     user.providerData?.[0]?.displayName || 
                     'Unbekannt',
        serviceId: selectedService,
        startTime: Timestamp.fromDate(startTime),
        endTime: Timestamp.fromDate(endTime),
        status: 'scheduled',
        type: 'queue', // Mark as queue appointment
        checkEarlierOptions: checkEarlierOptions,
        checkEarlierOptionsCreatedAt: checkEarlierOptions ? Timestamp.now() : undefined
      });

      toast.success('Sie wurden erfolgreich in die Warteschlange eingereiht');
      
      // Navigate to MyBookings page after successful booking
      navigate('/my-bookings');
    } catch (error) {
      console.error('Error joining queue:', error);
      toast.error('Fehler beim Einreihen in die Warteschlange');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    handleJoinQueue,
    submitting
  };
};
