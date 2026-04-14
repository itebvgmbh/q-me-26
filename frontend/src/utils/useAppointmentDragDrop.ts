import { useState } from 'react';
import { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { Appointment, updateAppointment } from './firestore';
import { format, addDays, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import useTimeSlotStore from './timeSlotStore';

/**
 * Interface for the preview data shown during appointment dragging
 */
export interface DragPreview {
  startTime: Date;
  endTime: Date;
}

/**
 * Props for useAppointmentDragDrop hook
 */
interface UseAppointmentDragDropProps {
  /**
   * List of all appointments
   */
  appointments: Appointment[];
  /**
   * Shop ID for cache invalidation
   */
  shopId: string;
  /**
   * Callback to update an appointment in the parent component
   */
  onAppointmentUpdate: (appointment: Appointment) => void;
}

/**
 * Custom hook to manage appointment drag and drop functionality
 * 
 * @param props - Hook configuration
 * @returns Functions and state for drag and drop operations
 */
export const useAppointmentDragDrop = ({
  appointments,
  shopId,
  onAppointmentUpdate
}: UseAppointmentDragDropProps) => {
  // State for drag-and-drop between days
  const [draggedAppointment, setDraggedAppointment] = useState<Appointment | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  
  // Access the cache invalidation function
  const invalidateCache = useTimeSlotStore(state => state.invalidateCache);

  /**
   * Filters appointments for a specific day
   * 
   * @param date - Day to get appointments for
   * @returns List of appointments for the specified day
   */
  const getDayAppointments = (date: Date) => {
    const dayStart = startOfDay(date);
    const dayEnd = addDays(dayStart, 1);
    return appointments.filter(apt => {
      const aptTime = apt.startTime.toDate();
      return aptTime >= dayStart && aptTime < dayEnd;
    });
  };

  /**
   * Handler for drag start events
   * 
   * @param event - Drag start event from dnd-kit
   */
  const handleDragStart = (event: DragStartEvent) => {
    console.log('DragStart:', event);
    const appointment = appointments.find(apt => apt.id === event.active.id);
    if (!appointment) {
      console.log('No appointment found for id:', event.active.id);
      return;
    }
    console.log('Setting dragged appointment:', appointment);
    setDraggedAppointment(appointment);
  };

  /**
   * Handler for drag move events, updates preview position
   * 
   * @param event - Drag move event from dnd-kit
   */
  const handleDragMove = (event: DragMoveEvent) => {
    if (!draggedAppointment || !event.over) {
      console.log('No dragged appointment or over event');
      return;
    }

    // Extract the date information from the drop area ID
    const overElementId = event.over.id as string;
    const dateMatch = overElementId.match(/droppable-(.+)/);
    if (!dateMatch) {
      console.log('No date found in drop area ID');
      return;
    }
    
    // Parse the target date from the ID
    const targetDateString = dateMatch[1];
    const targetDate = new Date(targetDateString);
    
    // Find the right drop area for position calculation
    const dropArea = document.querySelector(`[data-testid="calendar-drop-area-${targetDateString}"]`);
    if (!dropArea) {
      console.log('No drop area found');
      return;
    }

    const rect = dropArea.getBoundingClientRect();
    
    // When dragging within a calendar, consider the y-offset
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

    // Convert to minutes (15-minute intervals)
    const minutesPerPixel = (8 * 60) / rect.height; // 8 hours = 480 minutes
    const totalMinutes = Math.round((yPositionRelative * minutesPerPixel) / 15) * 15;

    // Calculate the hour based on the position in the calendar
    const newHour = Math.floor(totalMinutes / 60) + 9; // 9 AM is the start
    const newMinutes = totalMinutes % 60;

    console.log('Time Calculation:', {
      totalMinutes,
      newHour,
      newMinutes
    });

    // Create preview with new date
    const previewStartTime = new Date(targetDate);
    previewStartTime.setHours(newHour, newMinutes, 0, 0);
    const duration = draggedAppointment.endTime.toDate().getTime() - draggedAppointment.startTime.toDate().getTime();
    const previewEndTime = new Date(previewStartTime.getTime() + duration);

    // Check if the appointment is within working hours
    if (previewStartTime.getHours() >= 9 && 
        (previewEndTime.getHours() < 17 || 
         (previewEndTime.getHours() === 17 && previewEndTime.getMinutes() === 0))) {
      console.log('Setting preview:', { previewStartTime, previewEndTime });
      setDragPreview({ startTime: previewStartTime, endTime: previewEndTime });
    } else {
      console.log('Preview outside of working hours');
      setDragPreview(null);
    }
  };

  /**
   * Handler for drag end events, updates appointment time
   * 
   * @param event - Drag end event from dnd-kit
   */
  const handleDragEnd = async (event: DragEndEvent) => {
    // If no valid preview exists, abort
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

    // Extract the date information from the drop area ID
    const overElementId = over.id as string;
    const dateMatch = overElementId.match(/droppable-(.+)/);
    if (!dateMatch) {
      console.log('No date found in drop area ID');
      setDraggedAppointment(null);
      setDragPreview(null);
      return;
    }
    
    // Update the appointment with the new times
    try {
      const updatedAppointment = await updateAppointment(draggedAppointment.id, {
        startTime: dragPreview.startTime,
        endTime: dragPreview.endTime,
      });
      
      onAppointmentUpdate(updatedAppointment);
      
      // Invalidate cache for this shop and date
      // Invalidate both the old and new date
      invalidateCache(shopId, draggedAppointment.startTime.toDate());
      invalidateCache(shopId, dragPreview.startTime);
      
      // Show different success messages depending on whether the day changed
      const oldDate = draggedAppointment.startTime.toDate().toDateString();
      const newDate = dragPreview.startTime.toDateString();
      
      if (oldDate !== newDate) {
        toast.success(`Termin erfolgreich auf ${format(dragPreview.startTime, 'dd.MM.yyyy')} verschoben`);
      } else {
        toast.success('Termin erfolgreich verschoben');
      }
    } catch (error) {
      console.error('Error updating appointment time:', error);
      toast.error('Fehler beim Verschieben des Termins');
    } finally {
      // Reset the states
      setDraggedAppointment(null);
      setDragPreview(null);
    }
  };

  return {
    draggedAppointment,
    dragPreview,
    getDayAppointments,
    handleDragStart,
    handleDragMove,
    handleDragEnd
  };
};
