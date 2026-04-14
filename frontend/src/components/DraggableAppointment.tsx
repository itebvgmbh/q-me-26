import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { getSlotDisplayProperties, formatTimeSlot } from '../utils/calendarUtils';
import { AppointmentBlock } from '../utils/types';

interface DraggableAppointmentProps {
  appointment: AppointmentBlock;
  style: { top: string; height: string };
  onClick: (e: React.MouseEvent) => void;
}

/**
 * Eine verschiebbare Terminkomponente für Kalenderansichten
 */
export const DraggableAppointment = ({
  appointment,
  style,
  onClick,
}: DraggableAppointmentProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    data: appointment,
  });

  // Klarere visuelle Unterscheidung zwischen verfügbaren und nicht verfügbaren Slots
  const backgroundColor = appointment.isAvailable
    ? 'bg-green-200 hover:bg-green-300'
    : 'bg-gray-200 cursor-not-allowed opacity-70';
  
  // Deutlichere Abgrenzung für verfügbare Slots
  const borderStyle = appointment.isAvailable ? 'border border-green-500' : '';

  // Schriftgröße und Anzeigeart basierend auf der Slothöhe anpassen
  const { fontSize, shouldShowText } = getSlotDisplayProperties(
    appointment.startTime, 
    appointment.endTime
  );

  const draggableStyle = {
    ...style,
    ...(isDragging
      ? {
          transform: `translate3d(${transform?.x}px, ${transform?.y}px, 0)`,
          zIndex: 999,
          opacity: 0.8,
          cursor: 'grabbing',
        }
      : {
          cursor: appointment.isAvailable ? 'pointer' : 'default',
        }),
  };

  // Format the time for display
  const timeText = formatTimeSlot(appointment.startTime, appointment.endTime);

  return (
    <div
      ref={setNodeRef}
      className={`absolute left-0 right-0 ${borderStyle} ${backgroundColor} transition-colors group flex items-center justify-center overflow-hidden`}
      style={draggableStyle}
      onClick={onClick}
      {...(appointment.isAvailable ? { ...listeners, ...attributes } : {})}
    >
      {/* Zeit immer anzeigen bei verfügbaren Slots */}
      {appointment.isAvailable && (
        <div 
          className={`${fontSize} font-medium text-green-800 px-1 truncate w-full text-center
            ${shouldShowText ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}
        >
          {timeText}
        </div>
      )}
    </div>
  );
};
