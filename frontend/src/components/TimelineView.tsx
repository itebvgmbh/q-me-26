import { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, useDraggable, useDroppable, MouseSensor, TouchSensor, useSensor, useSensors, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { Staff, Appointment, updateAppointment, Service } from '../utils/firestore';
import { RecurringBreak } from '../utils/firestore/recurring-breaks';
import { Timestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, addDays, addMinutes, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { CreateAppointmentDialog } from './CreateAppointmentDialog';
import useTimeSlotStore from '../utils/timeSlotStore';

const HOURS = Array.from({ length: 9 }, (_, i) => i + 9); // 9:00 - 17:00

interface DraggableAppointmentProps {
  appointment: Appointment;
  style: { top: string; height: string };
  statusColor: string;
  services: Service[];
  onClick: (e: React.MouseEvent) => void;
}

const DraggableAppointment = ({
  appointment,
  style,
  statusColor,
  services,
  onClick,
}: DraggableAppointmentProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: appointment,
  });

  const draggableStyle = {
    ...style,
    ...(isDragging ? {
      transform: `translate3d(${transform?.x}px, ${transform?.y}px, 0)`,
      zIndex: 999,
      opacity: 0.8,
      cursor: 'grabbing',
    } : {
      cursor: 'grab',
    })
  };

  const durationMinutes = (appointment.endTime.toDate().getTime() - appointment.startTime.toDate().getTime()) / 60000;
  
  let textClass = 'text-sm font-medium';
  if (durationMinutes <= 15) {
    textClass = 'text-[9px] leading-[10px] font-medium tracking-tighter';
  } else if (durationMinutes < 30) {
    textClass = 'text-xs leading-tight font-medium';
  }

  return (
    <div
      ref={setNodeRef}
      className={`absolute left-0 right-0 px-1 rounded-md ${statusColor} cursor-move transition-colors group overflow-hidden flex items-center shadow-sm`}
      style={{
        ...draggableStyle,
        paddingTop: 0,
        paddingBottom: 0
      }}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <div className="flex justify-between items-center w-full min-w-0 h-full">
        <div className={`${textClass} truncate flex-1 flex items-center h-full`} title={`${format(appointment.startTime.toDate(), 'HH:mm')}-${format(appointment.endTime.toDate(), 'HH:mm')} | ${appointment.customerName} | ${services.find(s => s.id === appointment.serviceId)?.name}`}>
          {format(appointment.startTime.toDate(), 'HH:mm')}-
          {format(appointment.endTime.toDate(), 'HH:mm')} | {appointment.customerName} | 
          {services.find(s => s.id === appointment.serviceId)?.name}
        </div>
        <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/40 rounded pl-1 ml-1 flex-shrink-0 ${durationMinutes <= 15 ? 'scale-75 origin-right' : ''}`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 md:h-5 md:w-5"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            🕒
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 md:h-5 md:w-5"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            ▶️
          </Button>
          <Button
             variant="ghost"
             size="icon"
             className="h-4 w-4 md:h-5 md:w-5"
             onClick={(e) => {
               e.stopPropagation();
             }}
           >
             ✅
           </Button>
           <Button
             variant="ghost"
             size="icon"
             className="h-4 w-4 md:h-5 md:w-5"
             onClick={(e) => {
               e.stopPropagation();
             }}
           >
             ❌
           </Button>
        </div>
      </div>
    </div>
  );
};



interface DroppableAreaProps {
  className: string;
  date: Date;
  onDrop: (appointment: Appointment, dropPoint: { x: number, y: number }) => void;
  onClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

const DroppableArea = ({
  className,
  date,
  onDrop,
  onClick,
  children,
}: DroppableAreaProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `droppable-${date.toISOString()}`,
  });

  return (
    <div
      data-testid={`calendar-drop-area-${date.toISOString()}`}
      ref={setNodeRef}
      className={`${className} ${isOver ? 'bg-blue-100/50' : ''} relative`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

interface DragPreview {
  startTime: Date;
  endTime: Date;
}

interface DayViewProps {
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

const DayView: React.FC<DayViewProps> = ({
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
  
  // Zugriff auf die Cache-Invalidierungsfunktion
  const invalidateCache = useTimeSlotStore(state => state.invalidateCache);

  const handleStatusChange = async (status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled') => {
    if (!selectedAppointment) return;

    try {
      const updatedAppointment = await updateAppointment(selectedAppointment.id, { status });
      onAppointmentUpdate(updatedAppointment);
      
      // Cache für diesen Shop und Datum invalidieren
      invalidateCache(employee.shopId, selectedAppointment.startTime.toDate());
      
      toast.success('Status erfolgreich aktualisiert');
      setShowStatusDialog(false);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error('Fehler beim Aktualisieren des Status');
    }
  };

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

  // Function to get breaks for this specific day
  const getBreaksForDay = (date: Date) => {
    if (!recurringBreaks || recurringBreaks.length === 0) return [];
    
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
    return recurringBreaks.filter(breakItem => breakItem.dayOfWeek === dayOfWeek);
  };

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

  const getBreakTypeLabel = (type?: string): string => {
    switch (type) {
      case 'lunch': return 'Mittagspause';
      case 'coffee': return 'Kaffeepause';
      case 'personal': return 'Persönliche Pause';
      case 'other': return 'Sonstige Pause';
      default: return 'Pause';
    }
  };

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

  const isCurrentDay = (date: Date) => {
    const now = new Date();
    return (
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  };

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
            {/* Preview des Zeitraums während des Drags */}
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

interface Props {
  employee: Staff;
  appointments: Appointment[];
  services: Service[];
  startDate: Date;
  numDays: number;
  onAppointmentUpdate: (appointment: Appointment) => void;
  onAppointmentCreate?: () => void;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
  recurringBreaks?: RecurringBreak[];
}

export const TimelineView = ({
  employee,
  appointments,
  services,
  startDate,
  numDays,
  onAppointmentUpdate,
  onAppointmentCreate,
  recurringBreaks = [],
}: Props) => {
  // State für Drag-and-Drop zwischen Tagen
  const [draggedAppointment, setDraggedAppointment] = useState<Appointment | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Zugriff auf die Cache-Invalidierungsfunktion
  const invalidateCache = useTimeSlotStore(state => state.invalidateCache);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Sensoren für Drag & Drop
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

  const getDayAppointments = (date: Date) => {
    const dayStart = startOfDay(date);
    const dayEnd = addDays(dayStart, 1);
    return appointments.filter(apt => {
      const aptTime = apt.startTime.toDate();
      return aptTime >= dayStart && aptTime < dayEnd;
    });
  };

  const renderDays = () => {
    const days = [];
    for (let i = 0; i < numDays; i++) {
      const date = addDays(startDate, i);
      days.push(
        <DayView
          key={date.toISOString()}
          employee={employee}
          appointments={getDayAppointments(date)}
          services={services}
          date={date}
          onAppointmentUpdate={onAppointmentUpdate}
          onAppointmentCreate={onAppointmentCreate}
          draggedAppointment={draggedAppointment}
          dragPreview={dragPreview}
          recurringBreaks={recurringBreaks}
        />
      );
    }
    return days;
  };

  return (
    <div className="overflow-x-auto">
      <DndContext
        sensors={sensors}
        onDragStart={(event) => {
          console.log('DragStart:', event);
          const appointment = appointments.find(apt => apt.id === event.active.id);
          if (!appointment) {
            console.log('No appointment found for id:', event.active.id);
            return;
          }
          console.log('Setting dragged appointment:', appointment);
          setDraggedAppointment(appointment);
        }}
        onDragMove={(event) => {
          if (!draggedAppointment || !event.over) {
            console.log('No dragged appointment or over event');
            return;
          }

          // Extrahiere die Datum-Information aus der Drop-Area-ID
          const overElementId = event.over.id as string;
          const dateMatch = overElementId.match(/droppable-(.+)/);
          if (!dateMatch) {
            console.log('No date found in drop area ID');
            return;
          }
          
          // Parse das Zieldatum aus der ID
          const targetDateString = dateMatch[1];
          const targetDate = new Date(targetDateString);
          
          // Finde die richtige Drop-Area für die Positionsberechnung
          const dropArea = document.querySelector(`[data-testid="calendar-drop-area-${targetDateString}"]`);
          if (!dropArea) {
            console.log('No drop area found');
            return;
          }

          const rect = dropArea.getBoundingClientRect();
          
          // Bei Drag innerhalb eines Kalenders, den y-Offset berücksichtigen
          const offsetY = event.over.rect.top - dropArea.getBoundingClientRect().top;
          const yPosition = event.active.rect.current.translated?.top ?? 0;
          const yPositionRelative = yPosition - event.over.rect.top + offsetY;

          console.log('Position Debug:', {
            offsetY,
            yPosition,
            yPositionRelative,
            activeRect: event.active.rect,
            overRect: event.over.rect
          });

          // Konvertiere in Minuten (15-Minuten-Intervalle)
          const minutesPerPixel = (8 * 60) / rect.height; // 8 Stunden = 480 Minuten
          const totalMinutes = Math.round((yPositionRelative * minutesPerPixel) / 15) * 15;

          // Berechne die Stunde basierend auf der Position im Kalender
          const newHour = Math.floor(totalMinutes / 60) + 9; // 9 Uhr ist der Start
          const newMinutes = totalMinutes % 60;

          console.log('Time Calculation:', {
            totalMinutes,
            newHour,
            newMinutes
          });

          // Erstelle Preview mit neuem Datum
          const previewStartTime = new Date(targetDate);
          previewStartTime.setHours(newHour, newMinutes, 0, 0);
          const duration = draggedAppointment.endTime.toDate().getTime() - draggedAppointment.startTime.toDate().getTime();
          const previewEndTime = new Date(previewStartTime.getTime() + duration);

          // Prüfe ob der Termin innerhalb der Arbeitszeiten liegt
          if (previewStartTime.getHours() >= 9 && 
              (previewEndTime.getHours() < 17 || 
               (previewEndTime.getHours() === 17 && previewEndTime.getMinutes() === 0))) {
            console.log('Setting preview:', { previewStartTime, previewEndTime });
            setDragPreview({ startTime: previewStartTime, endTime: previewEndTime });
          } else {
            console.log('Preview außerhalb der Arbeitszeiten');
            setDragPreview(null);
          }
        }}
        onDragEnd={(event) => {
          // Wenn keine gültige Preview existiert, breche ab
          if (!dragPreview) {
            setDraggedAppointment(null);
            return;
          }
          const { active, over } = event;
          if (!over) {
            setDraggedAppointment(null);
            setDragPreview(null);
            return;
          }

          const appointment = appointments.find(apt => apt.id === active.id);
          if (!appointment) {
            setDraggedAppointment(null);
            setDragPreview(null);
            return;
          }

          // Extrahiere die Datum-Information aus der Drop-Area-ID
          const overElementId = over.id as string;
          const dateMatch = overElementId.match(/droppable-(.+)/);
          if (!dateMatch) {
            console.log('No date found in drop area ID');
            setDraggedAppointment(null);
            setDragPreview(null);
            return;
          }
          
          // Updaten des Termins mit den neuen Zeiten
          updateAppointment(draggedAppointment.id, {
            startTime: Timestamp.fromDate(dragPreview.startTime),
            endTime: Timestamp.fromDate(dragPreview.endTime),
          })
            .then((updatedAppointment) => {
              onAppointmentUpdate(updatedAppointment);
              
              // Cache für diesen Shop und Datum invalidieren
              // Invalidiere sowohl das alte als auch das neue Datum
              invalidateCache(employee.shopId, draggedAppointment.startTime.toDate());
              invalidateCache(employee.shopId, dragPreview.startTime);
              
              // Zeige unterschiedliche Erfolgsbenachrichtigungen je nachdem, ob der Tag geändert wurde
              const oldDate = draggedAppointment.startTime.toDate().toDateString();
              const newDate = dragPreview.startTime.toDateString();
              
              if (oldDate !== newDate) {
                toast.success(`Termin erfolgreich auf ${format(dragPreview.startTime, 'dd.MM.yyyy')} verschoben`);
              } else {
                toast.success('Termin erfolgreich verschoben');
              }
              
              // Zurücksetzen der States
              setDraggedAppointment(null);
              setDragPreview(null);
            })
            .catch((error) => {
              console.error('Error updating appointment time:', error);
              toast.error('Fehler beim Verschieben des Termins');
              setDraggedAppointment(null);
              setDragPreview(null);
            });
        }}
      >
        <div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 min-w-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(numDays, 4)}, minmax(350px, 1fr))`,
          }}
        >
          {renderDays()}
        </div>
      </DndContext>
    </div>
  );
};
