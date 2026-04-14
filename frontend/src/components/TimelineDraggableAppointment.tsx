import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Appointment, Service } from '../utils/firestore';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';

/**
 * Props for the TimelineDraggableAppointment component
 */
export interface TimelineDraggableAppointmentProps {
  /** Appointment data to display */
  appointment: Appointment;
  /** CSS positioning style for the appointment */
  style: { top: string; height: string };
  /** CSS class for appointment status color */
  statusColor: string;
  /** Available services to display the service name */
  services: Service[];
  /** Handler for appointment click */
  onClick: (e: React.MouseEvent) => void;
}

/**
 * TimelineDraggableAppointment creates a draggable UI element for an appointment 
 * in the timeline calendar view
 * 
 * @param appointment - Appointment data to display
 * @param style - CSS positioning style (top and height)
 * @param statusColor - CSS class for the appointment's status color
 * @param services - Available services to display the service name
 * @param onClick - Handler for when the appointment is clicked
 */
export const TimelineDraggableAppointment = ({
  appointment,
  style,
  statusColor,
  services,
  onClick,
}: TimelineDraggableAppointmentProps) => {
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

  return (
    <div
      ref={setNodeRef}
      className={`absolute left-0 right-0 p-2 rounded-md ${statusColor} cursor-move transition-colors group`}
      style={draggableStyle}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <div className="flex justify-between items-center">
        <div className="text-sm font-medium">
          {format(appointment.startTime.toDate(), 'HH:mm')}-
          {format(appointment.endTime.toDate(), 'HH:mm')} | {appointment.customerName} | 
          {services.find(s => s.id === appointment.serviceId)?.name}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              // handleStatusChange('scheduled');
            }}
          >
            🕒
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              // handleStatusChange('in-progress');
            }}
          >
            ▶️
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              // handleStatusChange('completed');
            }}
          >
            ✅
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              // handleStatusChange('cancelled');
            }}
          >
            ❌
          </Button>
        </div>
      </div>
    </div>
  );
};
