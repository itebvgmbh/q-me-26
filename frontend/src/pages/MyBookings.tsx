import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { EarlierSlotNotifications } from '../components/EarlierSlotNotifications';
import type { EarlierSlotNotificationType } from '../utils/types';
import { Navigation } from '../components/Navigation';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../utils/firestore-client';
import type { Appointment, Service, Shop, Staff } from '../utils/firestore';
import { cancelAppointment } from '../utils/firestore';
import { safelyConvertToDate } from '../utils/datetime';
import useTimeSlotStore from '../utils/timeSlotStore';
import { loadAppointmentsWithDetails } from '../utils/bookings';
import { loadUserNotifications } from '../utils/notifications';
import { AppointmentCard } from '../components/AppointmentCard';
import { CancelAppointmentDialog } from '../components/CancelAppointmentDialog';

/**
 * MyBookings page component for displaying user appointments 
 * and managing appointment cancellations/modifications
 */
const MyBookings = () => {
  // State management
  const [appointmentToCancel, setAppointmentToCancel] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { user } = useCurrentUser();
  const [appointments, setAppointments] = useState<(Appointment & { service?: Service; shop?: Shop; staff?: Staff; queuePosition?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<EarlierSlotNotificationType[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  /**
   * Load appointments with details (service, shop, staff)
   */
  const loadAppointments = async () => {
    setLoading(true);
    if (user) {
      try {
        const appointmentsWithDetails = await loadAppointmentsWithDetails(user.uid);
        setAppointments(appointmentsWithDetails);
      } catch (error) {
        console.error('Error loading appointments:', error);
      }
    }
    setLoading(false);
  };

  /**
   * Load notifications about earlier slots
   */
  const fetchNotifications = async () => {
    if (!user) {
      console.log('No user available to load notifications');
      return;
    }
    
    setLoadingNotifications(true);
    try {
      const userNotifications = await loadUserNotifications(user.uid);
      setNotifications(userNotifications);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
    } finally {
      setLoadingNotifications(false);
    }
  };

  /**
   * Handle accepting an earlier slot notification
   */
  const handleAcceptEarlierSlot = async (notificationId: string) => {
    try {
      // Use the repository function for better encapsulation and code reuse
      const { acceptEarlierAppointmentSlot } = await import('../utils/firebase/appointmentRepository');
      
      const success = await acceptEarlierAppointmentSlot(notificationId);
      
      if (success) {
        toast.success('Früherer Termin erfolgreich angenommen!');
        
        // Refresh both notifications and appointments
        await fetchNotifications();
        await loadAppointments();
        return true;
      }
      
      throw new Error('Failed to accept earlier slot');
    } catch (error) {
      console.error('Error accepting earlier slot:', error);
      toast.error('Fehler beim Annehmen des früheren Termins');
      throw error;
    }
  };

  /**
   * Load data on component mount and set up refresh interval
   */
  useEffect(() => {
    if (user) {
      loadAppointments();
      fetchNotifications();
      
      // Set up periodic refresh for notifications
      const refreshInterval = setInterval(() => {
        console.log('Periodic refresh of notifications');
        fetchNotifications();
      }, 30000); // refresh every 30 seconds
      
      return () => clearInterval(refreshInterval);
    }
  }, [user]);

  /**
   * Loading state display
   */
  if (loading) {
    return (
    <>
      <Navigation />
      <div className="container mx-auto py-8">
        <p>Lädt...</p>
      </div>
    </>
    );
  }

  /**
   * Handle appointment cancellation
   */
  const handleCancelAppointment = async () => {
    if (!appointmentToCancel) return;
    
    try {
      // Get the appointment data to extract shopId and date for cache invalidation
      const appointmentRef = doc(firestore, 'appointments', appointmentToCancel);
      const appointmentDoc = await getDoc(appointmentRef);
      const appointmentData = appointmentDoc.exists() ? appointmentDoc.data() : null;
      
      await cancelAppointment(appointmentToCancel);
      toast.success("Termin erfolgreich storniert");
      
      // Invalidate cache after cancellation
      if (appointmentData && appointmentData.shopId && appointmentData.startTime) {
        try {
          const invalidateCache = useTimeSlotStore.getState().invalidateCache;
          const date = safelyConvertToDate(appointmentData.startTime);
          console.log(`Invalidating cache for shop ${appointmentData.shopId} after cancellation on date ${date.toISOString()}`);
          invalidateCache(appointmentData.shopId, date);
        } catch (cacheError) {
          console.error('Error invalidating cache after cancellation:', cacheError);
        }
      }
      
      // Reload appointments to refresh the list
      loadAppointments();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      toast.error("Fehler beim Stornieren des Termins");
    } finally {
      setAppointmentToCancel(null);
      setIsDialogOpen(false);
    }
  };
  
  /**
   * Open the cancellation dialog for a specific appointment
   */
  const handleOpenCancelDialog = (appointmentId: string) => {
    setAppointmentToCancel(appointmentId);
    setIsDialogOpen(true);
  };
  
  /**
   * Close the cancellation dialog without cancelling
   */
  const handleCloseDialog = () => {
    setAppointmentToCancel(null);
    setIsDialogOpen(false);
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto py-8 space-y-8">
        {/* Display earlier slot notifications if available */}
        {!loadingNotifications && notifications.length > 0 && (
          <EarlierSlotNotifications 
            notifications={notifications} 
            onAccept={handleAcceptEarlierSlot}
            onRefresh={fetchNotifications}
          />
        )}
        
        {/* Page header */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Meine Buchungen</h1>
        </div>

        {/* List of appointments */}
        <div className="space-y-4">
          {appointments.length === 0 ? (
            <p>Keine Buchungen vorhanden</p>
          ) : (
            appointments.map(appointment => {
              // Find notification for this appointment if one exists
              const appointmentNotification = notifications.find(n => 
                n.appointmentId === appointment.id && 
                n.isAccepted !== true
              );
              
              return (
                <AppointmentCard 
                  key={appointment.id}
                  appointment={appointment}
                  notification={appointmentNotification}
                  onCancelClick={handleOpenCancelDialog}
                  onAcceptEarlierSlot={handleAcceptEarlierSlot}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Confirmation dialog for appointment cancellation */}
      <CancelAppointmentDialog 
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onCancel={handleCloseDialog}
        onConfirm={handleCancelAppointment}
      />
    </>
  );
};

export default MyBookings;