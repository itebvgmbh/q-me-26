import React, { useState, useEffect } from 'react';
import { Timestamp, collection, doc, getFirestore, setDoc } from 'firebase/firestore';
import { firebaseApp, useCurrentUser } from 'app';
import { createCustomer, isTimeSlotAvailable } from '../utils/firestore';
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { AppointmentBlock, CalendarTimeSlot, Service, TimeSlot } from '../utils/types';
import useTimeSlotStore from '../utils/timeSlotStore';
import { DroppableCalendarArea } from './DroppableCalendarArea';
import { DraggableAppointment } from './DraggableAppointment';
import { HOURS, isCurrentDay, getCurrentTimePosition, getAppointmentStyle } from '../utils/calendarUtils';

interface CalendarDayViewProps {
  forceRefresh?: boolean | number;
  date: Date;
  shopId: string;
  serviceId: string;
  staffId: string | null;
  services: Service[];
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
}

/**
 * Zeigt einen einzelnen Tag im Kalender mit Zeitslots an
 */
export const CalendarDayView: React.FC<CalendarDayViewProps> = ({
  date,
  shopId,
  serviceId,
  staffId,
  services,
  onTimeSlotSelect,
  forceRefresh = false,
}: CalendarDayViewProps) => {
  const navigate = useNavigate();
  const [appointmentBlocks, setAppointmentBlocks] = useState<AppointmentBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentBlock | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [checkEarlierOptions, setCheckEarlierOptions] = useState(false);

  // Nutze den Store statt direkter API-Aufrufe
  const getTimeSlots = useTimeSlotStore(state => state.getTimeSlots);

  useEffect(() => {
    const fetchTimeSlots = async () => {
      if (!shopId || !serviceId) return;

      setLoading(true);
      try {
        // Verwende den zentralen Store zum Laden der Daten
        const slots = await getTimeSlots(shopId, serviceId, staffId, date, !!forceRefresh);

        // Convert response to appointment blocks format
        const blocks: AppointmentBlock[] = slots.map((slot: TimeSlot, index: number) => ({
          id: `slot-${index}-${slot.start.toISOString()}`,
          startTime: slot.start,
          endTime: slot.end,
          title: slot.isAvailable ? 'Verfügbar' : 'Nicht verfügbar',
          isAvailable: slot.isAvailable,
          type: 'availableSlot',
        }));

        setAppointmentBlocks(blocks);
      } catch (error) {
        console.error('Error fetching available slots:', error);
        toast.error('Fehler beim Laden der verfügbaren Zeiten');
      } finally {
        setLoading(false);
      }
    };

    fetchTimeSlots();
  }, [shopId, serviceId, staffId, date, getTimeSlots, forceRefresh]);

  // Konfiguriere die Sensoren für Drag & Drop
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 10, // Mindestdistanz in Pixeln, bevor Drag startet
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250, // Verzögerung in ms, bevor Touch-Drag startet
      tolerance: 5, // Toleranz für unbeabsichtigte Bewegungen
    },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const handleSelectAppointment = (appointment: AppointmentBlock) => {
    if (!appointment.isAvailable) return;
    
    setSelectedAppointment(appointment);
    setCheckEarlierOptions(false);
    setShowConfirmDialog(true);
  };

  const { user } = useCurrentUser();

  // Direkter Aufruf der Firestore-Funktion zur Zeitslot-Verfügbarkeit
  const checkDirectAvailability = async (shopId: string, staffId: string | null, startTime: Date, endTime: Date): Promise<boolean> => {
    try {
      console.log(`Direct availability check for ${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`);
      if (!staffId) return false;
      
      return await isTimeSlotAvailable(
        shopId,
        staffId,
        Timestamp.fromDate(startTime),
        Timestamp.fromDate(endTime)
      );
    } catch (error) {
      console.error('Error in direct availability check:', error);
      return false;
    }
  };

  const handleBookAppointment = async () => {
    if (!selectedAppointment) return;
    if (!user) {
      toast.error('Bitte melden Sie sich an, um zu buchen');
      setShowConfirmDialog(false);
      navigate('/login');
      return;
    }

    // Specific validation checks with clear error messages
    if (!shopId) {
      toast.error('Bitte wählen Sie einen Shop aus');
      setShowConfirmDialog(false);
      return;
    }
    
    if (!staffId) {
      toast.error('Bitte wählen Sie einen Mitarbeiter aus');
      setShowConfirmDialog(false);
      return;
    }
    
    if (!serviceId) {
      toast.error('Bitte wählen Sie einen Service aus');
      setShowConfirmDialog(false);
      return;
    }

    try {
      console.log('Starting booking process...');
      const startTime = selectedAppointment.startTime;
      const endTime = selectedAppointment.endTime;
      
      console.log(`Selected slot: ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`);

      // Direkte Verfügbarkeitsüberprüfung vor dem Buchungsversuch
      console.log('Checking direct availability...');
      const isAvailable = await checkDirectAvailability(shopId, staffId, startTime, endTime);
      
      if (!isAvailable) {
        console.log('Direct availability check failed - slot is not available');
        toast.error('Dieser Zeitslot ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen Termin.');
        
        // Force refresh of time slots
        if (shopId && serviceId) {
          await getTimeSlots(shopId, serviceId, staffId, date, true);
          setSelectedAppointment(null);
        }
        setShowConfirmDialog(false);
        return;
      }
      
      console.log('Slot is available, proceeding with booking...');
      
      console.log('Creating customer record...');
      // Create customer record if this is their first appointment
      await createCustomer({
        shopId: shopId,
        name: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
        email: user.email || '',
      }).catch(err => {
        console.log('Customer may already exist, continuing...', err);
      });

      console.log('Creating appointment...');
      try {
        // Skip redundant availability check in createAppointment
        const db = getFirestore(firebaseApp);
        const appointmentRef = doc(collection(db, 'appointments'));
        
        // Calculate the timezone offset in minutes to adjust for timezone differences
        // No longer needed: Timestamp.fromDate() will natively calculate local time for the UTC string
        const adjustedStartTime = startTime;
        const adjustedEndTime = endTime;
        
        console.log(`Original times: ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`);
        
        const appointmentData = {
          id: appointmentRef.id,
          shopId: shopId,
          staffId: staffId,
          customerId: user.uid,
          // Gemäß Task QME-61: Verwende IMMER users.displayName
          // Verbesserte Namensermittlung mit mehreren Fallbacks
          customerName: user.displayName || 
                       (user.email ? user.email.split('@')[0] : null) || 
                       user.providerData?.[0]?.displayName || 
                       'Unbekannt',
          serviceId: serviceId,
          startTime: Timestamp.fromDate(adjustedStartTime),
          endTime: Timestamp.fromDate(adjustedEndTime),
          status: 'scheduled',
          type: 'booked',
          checkEarlierOptions: checkEarlierOptions,
          ...(checkEarlierOptions ? { checkEarlierOptionsCreatedAt: Timestamp.now() } : {}),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        };
        
        console.log('Saving appointment to Firestore:', appointmentData);
        await setDoc(appointmentRef, appointmentData);
        console.log('Appointment saved successfully with ID:', appointmentRef.id);

        console.log('Invalidating cache...');
        // Invalidate the cache for this date to ensure other users see updated availability
        useTimeSlotStore.getState().invalidateCache(shopId, startTime);

        console.log('Booking successful!');
        toast.success('Termin erfolgreich gebucht');

        // Optimistisches UI-Update: Entferne den gebuchten Zeitslot sofort aus der Ansicht!
        setAppointmentBlocks(prev => prev.filter(block => block.id !== selectedAppointment.id));
        
        // Also pass the selected time slot to parent component for UI updates
        onTimeSlotSelect({
          start: selectedAppointment.startTime,
          end: selectedAppointment.endTime,
        });
      } catch (appointmentError) {
        console.error('Error creating appointment:', appointmentError);
        toast.error('Fehler beim Buchen des Termins');
      }
    } catch (error) {
      console.error('Error in booking process:', error);
      toast.error('Fehler beim Buchen des Termins');
    } finally {
      setShowConfirmDialog(false);
    }
  };

  const handleConfirmSelection = () => {
    if (!selectedAppointment) return;
    
    // Instead of just selecting the time slot, book the appointment right away
    handleBookAppointment();
  };

  return (
    <DndContext sensors={sensors}>
      <div className="relative bg-white rounded-lg shadow h-[600px] overflow-hidden">
        <div className="absolute left-0 right-0 px-4 py-2 border-b bg-white rounded-t-lg z-10">
          <div className="flex justify-between items-center">
            <div className="font-medium">{format(date, 'EEEE, dd.MM.yyyy')}</div>
          </div>
        </div>

        <div className="absolute left-0 right-0 px-4 bg-white z-30">
            {/* Infotext komplett getrennt vom Zeitraster */}
            <div className="ml-16 text-sm text-gray-500 py-2">
              {loading ? "Lade verfügbare Zeitslots..." :
               appointmentBlocks.length === 0 ? "Keine verfügbaren Zeitslots für diesen Tag" :
               "Klicken Sie auf einen grünen Zeitslot, um einen Termin auszuwählen"}
            </div>
        </div>
        
        <div className="pt-12 pb-4 px-4 h-full overflow-y-auto">
          <div className="relative">
            {/* Time grid */}
            <div className="absolute inset-0 ml-16 pointer-events-none z-0">
              {/* Hour lines */}
              {HOURS.map((hour) => (
                <div
                  key={`hour-${hour}`}
                  className="absolute left-0 right-0 border-t-2 border-gray-300"
                  style={{ top: `${(hour - 9) * 60}px` }}
                />
              ))}
              {/* Half hour lines */}
              {HOURS.map((hour) => (
                <div
                  key={`half-${hour}`}
                  className="absolute left-0 right-0 border-t border-gray-200"
                  style={{ top: `${(hour - 9) * 60 + 30}px` }}
                />
              ))}
              {/* Quarter hour lines */}
              {HOURS.map((hour) => [
                <div
                  key={`quarter1-${hour}`}
                  className="absolute left-0 right-0 border-t border-dotted border-gray-200"
                  style={{ top: `${(hour - 9) * 60 + 15}px` }}
                />,
                <div
                  key={`quarter2-${hour}`}
                  className="absolute left-0 right-0 border-t border-dotted border-gray-200"
                  style={{ top: `${(hour - 9) * 60 + 45}px` }}
                />,
              ])}
            </div>

            {/* Time labels */}
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 text-sm text-gray-500"
                style={{ top: `${(hour - 9) * 60}px` }}
              >
                {`${hour}:00`}
              </div>
            ))}

            {/* Current time indicator */}
            {isCurrentDay(date) && (
              <div
                className="absolute left-16 right-0 border-t-2 border-red-500 z-10"
                style={getCurrentTimePosition()}
              />
            )}

            {/* Appointment blocks */}
            <DroppableCalendarArea
              className="ml-16 relative min-h-[480px] bg-white hover:bg-blue-50/10 transition-colors cursor-pointer z-20 mt-0"
              date={date}
              onClick={() => {}}
            >
              {appointmentBlocks.map((block) => (
                <DraggableAppointment
                  key={block.id}
                  appointment={block}
                  style={getAppointmentStyle(block.startTime, block.endTime)}
                  onClick={() => handleSelectAppointment(block)}
                />
              ))}
            </DroppableCalendarArea>
          </div>
        </div>

        {/* Confirmation dialog */}
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Termin buchen</DialogTitle>
            </DialogHeader>
            <div className="p-4">
              {selectedAppointment && (
                <div className="space-y-4">
                  <p>
                    Möchten Sie diesen Termin buchen?
                    <br />
                    <strong>
                      {format(selectedAppointment.startTime, 'dd.MM.yyyy')} von{' '}
                      {format(selectedAppointment.startTime, 'HH:mm')} bis{' '}
                      {format(selectedAppointment.endTime, 'HH:mm')} Uhr
                    </strong>
                  </p>

                  <div className="flex items-center space-x-2 mt-3 mb-4">
                    <Checkbox 
                      id="check-earlier-options" 
                      checked={checkEarlierOptions} 
                      onCheckedChange={checked => setCheckEarlierOptions(checked === true)}
                    />
                    <label 
                      htmlFor="check-earlier-options"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Bei früherer Option fragen
                    </label>
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                      Abbrechen
                    </Button>
                    <Button onClick={handleConfirmSelection}>Buchen</Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DndContext>
  );
};
