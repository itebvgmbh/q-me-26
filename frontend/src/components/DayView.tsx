import React, { useState } from 'react';
import { format, startOfDay } from 'date-fns';
import { Staff, Appointment, updateAppointment, Service } from '../utils/firestore';
import { RecurringBreak } from '../utils/firestore/recurring-breaks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { CreateAppointmentDialog } from './CreateAppointmentDialog';
import useTimeSlotStore from '../utils/timeSlotStore';
import { DroppableArea } from './DroppableArea';
import { DraggableAppointment } from './DraggableAppointment';

// Standard hours for the calendar (9:00 - 17:00)
const HOURS = Array.from({ length: 9 }, (_, i) => i + 9);

/**
 * Interface for drag preview data shown during appointment dragging
 */
export interface DragPreview {
  startTime: Date;
  endTime: Date;
}

/**
 * Props for the DayView component
 */
export interface DayViewProps {
  employee: Staff;
  appointments: Appointment[];
  services: Service[];
  date: Date;
  onAppointmentUpdate: (appointment: Appointment) => void;
  onAppointmentCreate?: () => void;
  dragPreview?: DragPreview | null;
  draggedAppointment?: Appointment | null;
  recurringBreaks?: RecurringBreak[];
}

/**
 * DayView component displays a single day in the calendar with appointment slots
 * and provides functionality for managing appointments.
 *
 * @param employee - The staff member whose schedule is being displayed
 * @param appointments - List of appointments for the day
 * @param services - List of available services
 * @param date - The date being displayed
 * @param onAppointmentUpdate - Handler for when an appointment is updated
 * @param onAppointmentCreate - Handler for when a new appointment is created
 * @param dragPreview - Preview data for dragged appointments
 * @param draggedAppointment - Currently dragged appointment
 * @param recurringBreaks - List of recurring breaks for this employee
 */
export const DayView: React.FC<DayViewProps> = ({
  employee,
  appointments,
  services,
  date,
  onAppointmentUpdate,
  onAppointmentCreate,
  dragPreview,
  draggedAppointment,
  recurringBreaks = [],
}: DayViewProps) => {
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newAppointmentTime, setNewAppointmentTime] = useState<Date | null>(null);
  
  // Access the cache invalidation function
  const invalidateCache = useTimeSlotStore(state => state.invalidateCache);

  /**
   * Updates an appointment's status and handles related UI updates
   * 
   * @param status - The new status for the appointment
   */
  const handleStatusChange = async (status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => {
    if (!selectedAppointment) return;

    try {
      const updatedAppointment = await updateAppointment(selectedAppointment.id, { status });
      onAppointmentUpdate(updatedAppointment);
      
      // Invalidate the cache for this shop and date
      invalidateCache(employee.shopId, selectedAppointment.startTime.toDate());
      
      toast.success('Status erfolgreich aktualisiert');
      setShowStatusDialog(false);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error('Fehler beim Aktualisieren des Status');
    }
  };

  /**
   * Calculates the CSS style for positioning an appointment in the calendar
   * 
   * @param appointment - The appointment to position
   * @returns Object with top and height CSS properties
   */
  const getAppointmentStyle = (appointment: Appointment) => {
    const startHour = appointment.startTime.toDate().getHours();
    const startMinutes = appointment.startTime.toDate().getMinutes();
    const endHour = appointment.endTime.toDate().getHours();
    const endMinutes = appointment.endTime.toDate().getMinutes();

    const top = (startHour - 9) * 60 + startMinutes;
    const height = (endHour - startHour) * 60 + (endMinutes - startMinutes);

    return {
      top: `${top}px`,
      height: `${height}px`,
    };
  };

  /**
   * Filters recurring breaks for the specified day
   * 
   * @param date - The date to get breaks for
   * @returns Array of breaks for the specified day
   */
  const getBreaksForDay = (date: Date) => {
    if (!recurringBreaks || recurringBreaks.length === 0) return [];
    
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
    return recurringBreaks.filter(breakItem => breakItem.dayOfWeek === dayOfWeek);
  };

  /**
   * Calculates the CSS style for positioning a break in the calendar
   * 
   * @param breakItem - The break to position
   * @returns Object with top and height CSS properties
   */
  const getBreakStyle = (breakItem: RecurringBreak) => {
    const [startHour, startMinute] = breakItem.startTime.split(':').map(Number);
    const [endHour, endMinute] = breakItem.endTime.split(':').map(Number);

    const top = (startHour - 9) * 60 + startMinute;
    const height = (endHour - startHour) * 60 + (endMinute - startMinute);

    return {
      top: `${top}px`,
      height: `${height}px`,
    };
  };

  /**
   * Returns a human-readable label for a break type
   * 
   * @param type - The break type
   * @returns Formatted break type label
   */
  const getBreakTypeLabel = (type?: string): string => {
    switch (type) {
      case 'lunch': return 'Mittagspause';
      case 'coffee': return 'Kaffeepause';
      case 'personal': return 'Persönliche Pause';
      case 'other': return 'Sonstige Pause';
      default: return 'Pause';
    }
  };

  /**
   * Returns a CSS class for styling an appointment based on its status
   * 
   * @param status - The appointment status
   * @returns CSS class for the appointment's status
   */
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 hover:bg-blue-200';
      case 'in-progress':
        return 'bg-yellow-100 hover:bg-yellow-200';
      case 'completed':
        return 'bg-green-100 hover:bg-green-200';
      case 'cancelled':
        return 'bg-red-100 hover:bg-red-200';
      default:
        return 'bg-gray-100 hover:bg-gray-200';
    }
  };

  /**
   * Checks if the given date is today
   * 
   * @param date - Date to check
   * @returns True if the date is today
   */
  const isCurrentDay = (date: Date) => {
    const now = new Date();
    return (
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  };

  /**
   * Calculates the position for the current time indicator
   * 
   * @returns CSS style object with top property
   */
  const getCurrentTimePosition = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const top = (hours - 9) * 60 + minutes;
    return { top: `${top}px` };
  };

  return (
    <div className="relative bg-white rounded-lg shadow h-[600px] overflow-hidden">
      <div className="absolute left-0 right-0 px-4 py-2 border-b bg-white rounded-t-lg z-10">
        <div className="flex justify-between items-center">
          <div className="font-medium">
            {format(date, 'EEEE, dd.MM.yyyy')}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-sm"
            onClick={() => {
              const now = new Date();
              const hour = now.getHours();
              const roundedMinutes = Math.ceil(now.getMinutes() / 15) * 15;
              const newTime = new Date(date);
              newTime.setHours(hour, roundedMinutes, 0, 0);
              setNewAppointmentTime(newTime);
              setShowCreateDialog(true);
            }}
          >
            + Termin anlegen
          </Button>
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
              />
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
          
          {/* Break indicators */}
          {getBreaksForDay(date).map((breakItem) => (
            <div
              key={breakItem.id}
              className="absolute left-16 right-0 bg-yellow-200 bg-opacity-70 border border-yellow-300 z-5"
              style={getBreakStyle(breakItem)}
              title={getBreakTypeLabel(breakItem.type)}
            >
              <div className="px-2 py-1 text-xs text-yellow-800 font-medium truncate">
                {getBreakTypeLabel(breakItem.type)}
              </div>
            </div>
          ))}

          {/* Create appointment hint */}
          <div className="ml-16 mb-2 text-sm text-gray-500">
            Klicken Sie auf einen freien Zeitslot, um einen neuen Termin anzulegen
          </div>

          {/* Appointment blocks */}
          <DroppableArea
            className="ml-16 relative min-h-[480px] bg-blue-50/30 hover:bg-blue-50/50 transition-colors cursor-pointer z-20"
            date={date}
            onDrop={() => {}}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const hour = Math.floor(y / 60) + 9;
              const minutes = Math.floor((y % 60) / 15) * 15;
              const newTime = new Date(date);
              newTime.setHours(hour, minutes, 0, 0);

              // Only allow creating appointments during working hours
              if (hour >= 9 && hour < 17) {
                setNewAppointmentTime(newTime);
                setShowCreateDialog(true);
              }
            }}
          >
            {/* Preview of time range during drag */}
            {dragPreview && draggedAppointment && dragPreview.startTime.toDateString() === date.toDateString() && (
              <div
                className="absolute left-0 right-0 bg-blue-200/50 border-2 border-blue-400 border-dashed rounded-md pointer-events-none transition-all duration-150"
                style={{
                  top: `${(dragPreview.startTime.getHours() - 9) * 60 + dragPreview.startTime.getMinutes()}px`,
                  height: `${(dragPreview.endTime.getTime() - dragPreview.startTime.getTime()) / (1000 * 60)}px`,
                }}
              >
                <div className="p-2 text-sm font-medium text-blue-800">
                  {format(dragPreview.startTime, 'HH:mm')}-
                  {format(dragPreview.endTime, 'HH:mm')} | {draggedAppointment.customerName}
                </div>
              </div>
            )}

            {appointments.map((appointment) => (
              <DraggableAppointment
                key={appointment.id}
                appointment={appointment}
                style={getAppointmentStyle(appointment)}
                statusColor={getStatusColor(appointment.status)}
                services={services}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAppointment(appointment);
                  setShowStatusDialog(true);
                }}
              />
            ))}
          </DroppableArea>
        </div>
      </div>

      {/* Create appointment dialog */}
      {showCreateDialog && newAppointmentTime && (
        <CreateAppointmentDialog
          isOpen={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          startTime={newAppointmentTime}
          employee={employee}
          services={services}
          onAppointmentCreated={() => {
            setShowCreateDialog(false);
            if (onAppointmentCreate) {
              onAppointmentCreate();
            }
          }}
        />
      )}

      {/* Status change dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminstatus ändern</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 p-4">
            <Button
              variant="outline"
              onClick={() => handleStatusChange('scheduled')}
              className="bg-blue-100 hover:bg-blue-200"
            >
              Geplant
            </Button>
            <Button
              variant="outline"
              onClick={() => handleStatusChange('in-progress')}
              className="bg-yellow-100 hover:bg-yellow-200"
            >
              In Bearbeitung
            </Button>
            <Button
              variant="outline"
              onClick={() => handleStatusChange('completed')}
              className="bg-green-100 hover:bg-green-200"
            >
              Abgeschlossen
            </Button>
            <Button
              variant="outline"
              onClick={() => handleStatusChange('cancelled')}
              className="bg-red-100 hover:bg-red-200"
            >
              Storniert
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
