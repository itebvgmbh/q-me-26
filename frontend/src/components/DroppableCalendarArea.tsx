import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DroppableCalendarAreaProps {
  className: string;
  date: Date;
  onClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

/**
 * Eine ablegbare Fläche für Drag & Drop-Operationen im Kalender
 */
export const DroppableCalendarArea = ({
  className,
  date,
  onClick,
  children,
}: DroppableCalendarAreaProps) => {
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
