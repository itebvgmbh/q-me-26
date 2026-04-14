import { useState, useEffect, useMemo } from 'react';
import { Service } from '../utils/firestore';
import useTimeSlotStore from '../utils/timeSlotStore';
import { Button } from '@/components/ui/button';
import { format, addDays } from 'date-fns';
import { CalendarTimeSlot } from '../utils/types';
import { CalendarDayView } from './CalendarDayView';

/**
 * Die CustomerTimelineView ist nun schlanker und fungiert hauptsächlich als Container-Komponente,
 * die die Kalenderansicht für mehrere Tage orchestriert.
 */

interface CustomerTimelineViewProps {
  shopId: string;
  serviceId: string;
  staffId: string | null;
  services: Service[];
  startDate: Date;
  numDays?: number;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  onDateChange?: (date: Date) => void;
  forceRefresh?: boolean;
}

export const CustomerTimelineView = ({
  shopId,
  serviceId,
  staffId,
  services,
  startDate,
  numDays = 4,
  onTimeSlotSelect,
  onDateChange,
  forceRefresh,
}: CustomerTimelineViewProps) => {
  // State für das aktuelle angezeigte Datum
  const [currentViewDate, setCurrentViewDate] = useState<Date>(startDate);
  
  // Wenn das startDate von außen geändert wird, aktualisiere currentViewDate
  useEffect(() => {
    setCurrentViewDate(startDate);
  }, [startDate]);
  
  // Handler für Datumsnavigation
  const handlePreviousDay = () => {
    const newDate = new Date(currentViewDate);
    newDate.setDate(newDate.getDate() - 1);
    setCurrentViewDate(newDate);
    
    // Informiere die übergeordnete Komponente über die Änderung
    if (onDateChange) {
      onDateChange(newDate);
    }
  };
  
  const handleNextDay = () => {
    const newDate = new Date(currentViewDate);
    newDate.setDate(newDate.getDate() + 1);
    setCurrentViewDate(newDate);
    
    // Informiere die übergeordnete Komponente über die Änderung
    if (onDateChange) {
      onDateChange(newDate);
    }
  };

  // Verwende useMemo, um die Kalendertage nur bei Änderungen neu zu rendern
  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < numDays; i++) {
      const date = addDays(currentViewDate, i);
      days.push(
        <CalendarDayView
          key={date.toISOString()}
          date={date}
          shopId={shopId}
          serviceId={serviceId}
          staffId={staffId}
          services={services}
          onTimeSlotSelect={onTimeSlotSelect}
          forceRefresh={forceRefresh}
        />
      );
    }
    return days;
  }, [currentViewDate, numDays, shopId, serviceId, staffId, services, onTimeSlotSelect, forceRefresh]);

  return (
    <div>
      {/* Datumsnavigation */}
      <div className="flex justify-between items-center mb-4">
        <Button 
          variant="outline" 
          onClick={handlePreviousDay}
          className="flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Vorheriger Tag
        </Button>
        
        <div className="text-lg font-semibold">
          {format(currentViewDate, 'EEEE, dd.MM.yyyy')}
        </div>
        
        <Button 
          variant="outline" 
          onClick={handleNextDay}
          className="flex items-center gap-2"
        >
          Nächster Tag
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 min-w-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(numDays, 4)}, minmax(350px, 1fr))`,
          }}
        >
          {calendarDays}
        </div>
      </div>
    </div>
  );
};
