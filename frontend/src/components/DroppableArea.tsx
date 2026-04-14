import React from 'react';
import { useDroppable } from '@dnd-kit/core';

/**
 * Props for the DroppableArea component
 */
export interface DroppableAreaProps {
  /** CSS classes to apply to the droppable area */
  className: string;
  /** Date associated with this droppable area */
  date: Date;
  /** Handler called when something is dropped on this area */
  onDrop: (appointment: any, dropPoint: { x: number, y: number }) => void;
  /** Handler called when this area is clicked */
  onClick: (e: React.MouseEvent) => void;
  /** Child content to render inside the droppable area */
  children?: React.ReactNode;
}

/**
 * DroppableArea component creates a drop zone for drag and drop operations in the calendar
 * 
 * @param className - CSS classes to apply to the droppable area
 * @param date - Date associated with this droppable area
 * @param onDrop - Handler called when something is dropped on this area
 * @param onClick - Handler called when this area is clicked
 * @param children - Child content to render inside the droppable area
 */
export const DroppableArea = ({
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
