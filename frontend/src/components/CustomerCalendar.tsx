import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, addDays, startOfWeek, addMinutes, parseISO, isToday } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarTimeSlot, TimeSlot } from '../utils/types';
import useTimeSlotStore from '../utils/timeSlotStore';

interface Props {
  shopId: string;
  serviceId: string;
  staffId?: string;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  forceRefresh?: boolean;
}

export const CustomerCalendar = ({ shopId, serviceId, staffId, onTimeSlotSelect, forceRefresh = false }: Props) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the start of the current week (Monday)
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });

  // Generate array of dates for the week
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  
  // Verwende den zentralen TimeSlotStore
  const getTimeSlots = useTimeSlotStore(state => state.getTimeSlots);
  
  // Konvertiere forceRefresh in booleschen Wert für Konsistenz
  const shouldForceRefresh = forceRefresh !== false;

  useEffect(() => {
    if (!selectedDate || !shopId || !serviceId) return;
    
    const fetchAvailableSlots = async () => {
      setLoading(true);
      setError(null);
      
      try {
        console.log(`Fetching available slots for date: ${selectedDate.toISOString()}`);
        console.log(`Parameters: shopId=${shopId}, serviceId=${serviceId}${staffId ? `, staffId=${staffId}` : ''}`);
        
        // Verwende den zentralen Store statt direktem API-Aufruf
        const timeSlots = await getTimeSlots(shopId, serviceId, staffId || null, selectedDate, shouldForceRefresh);
        
        // Konvertiere die TimeSlot-Objekte in das Format, das diese Komponente verwendet
        const convertedSlots = timeSlots.map(slot => ({
          start_time: slot.start.toISOString(),
          end_time: slot.end.toISOString(),
          is_available: slot.isAvailable
        }));
        
        setAvailableSlots(convertedSlots);
      } catch (err) {
        console.error('Error fetching available slots:', err);
        setError('Fehler beim Laden der verfügbaren Zeiten');
      } finally {
        setLoading(false);
      }
    };
    
    fetchAvailableSlots();
  }, [selectedDate, shopId, serviceId, staffId, getTimeSlots]);

  const navigateWeek = (forward: boolean) => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setDate(newDate.getDate() + (forward ? 7 : -7));
      return newDate;
    });
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const handleTimeSelect = (timeSlot: TimeSlot) => {
    if (!timeSlot.is_available) return;
    
    onTimeSlotSelect({
      start: parseISO(timeSlot.start_time),
      end: parseISO(timeSlot.end_time)
    });
  };

  const renderDateHeader = () => {
    return (
      <div className="flex justify-between items-center mb-4">
        <Button variant="outline" size="sm" onClick={() => navigateWeek(false)}>
          ← Vorherige Woche
        </Button>
        
        <CardTitle className="text-lg">
          {format(weekStart, 'dd.MM.yyyy', { locale: de })} - {format(addDays(weekStart, 6), 'dd.MM.yyyy', { locale: de })}
        </CardTitle>
        
        <Button variant="outline" size="sm" onClick={() => navigateWeek(true)}>
          Nächste Woche →
        </Button>
      </div>
    );
  };

  const renderWeekDays = () => {
    return (
      <div className="grid grid-cols-7 gap-2 mb-4">
        {weekDays.map((day, index) => {
          const dayOfWeek = format(day, 'EEE', { locale: de });
          const dayOfMonth = format(day, 'dd');
          const isSelected = selectedDate && 
            selectedDate.getDate() === day.getDate() && 
            selectedDate.getMonth() === day.getMonth() && 
            selectedDate.getFullYear() === day.getFullYear();
          
          // Disable dates in the past
          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));
          
          return (
            <Button
              key={index}
              variant={isSelected ? "default" : "outline"}
              className={`h-20 flex flex-col items-center justify-center ${isPast ? 'opacity-50 cursor-not-allowed' : ''} ${isToday(day) ? 'border-blue-500' : ''}`}
              onClick={() => !isPast && handleDateSelect(day)}
              disabled={isPast}
            >
              <div className="text-xs uppercase">{dayOfWeek}</div>
              <div className="text-lg font-bold">{dayOfMonth}</div>
            </Button>
          );
        })}
      </div>
    );
  };

  const renderTimeSlots = () => {
    if (!selectedDate) {
      return (
        <div className="py-4 text-center text-gray-500">
          Bitte wählen Sie einen Tag aus, um verfügbare Zeiten zu sehen.
        </div>
      );
    }

    if (loading) {
      return (
        <div className="py-4 text-center text-gray-500">
          Lade verfügbare Zeiten...
        </div>
      );
    }

    if (error) {
      return (
        <div className="py-4 text-center text-red-500">
          {error}
        </div>
      );
    }

    if (availableSlots.length === 0) {
      return (
        <div className="py-4 text-center text-gray-500">
          Keine Termine für diesen Tag verfügbar.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
        {availableSlots.map((slot, index) => {
          const startTime = parseISO(slot.start_time);
          const endTime = parseISO(slot.end_time);
          
          return (
            <Button
              key={index}
              variant={slot.is_available ? "outline" : "ghost"}
              className={`${slot.is_available ? 'bg-green-100 hover:bg-green-200 text-green-800 border-green-300 font-medium' : 'bg-gray-100 text-gray-500 cursor-not-allowed border-gray-200 opacity-70'}`}
              disabled={!slot.is_available}
              onClick={() => handleTimeSelect(slot)}
            >
              {format(startTime, 'HH:mm')} - {format(endTime, 'HH:mm')}
            </Button>
          );
        })}
      </div>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        {renderDateHeader()}
      </CardHeader>
      <CardContent>
        {renderWeekDays()}
        {renderTimeSlots()}
      </CardContent>
    </Card>
  );
};
