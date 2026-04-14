import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import brain from 'brain';
import { AvailableTimeslotsRequest } from '../brain/data-contracts';

interface AvailableTimeSlotPickerProps {
  shopId: string;
  serviceId: string;
  staffId: string;
  date: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const AvailableTimeSlotPicker = ({
  shopId,
  serviceId,
  staffId,
  date,
  value,
  onChange,
  disabled = false
}: AvailableTimeSlotPickerProps) => {
  const [loading, setLoading] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<{ time: string; disabled: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Nur laden, wenn alle benötigten Werte vorhanden sind
    if (!shopId || !serviceId || !date) return;

    const loadAvailableSlots = async () => {
      setLoading(true);
      setError(null);

      try {
        // Datum in das richtige Format bringen
        const dateObj = new Date(date);
        dateObj.setHours(12, 0, 0, 0); // Setze auf Mittag für konsistente Ergebnisse

        const request: AvailableTimeslotsRequest = {
          shop_id: shopId,
          service_id: serviceId,
          staff_id: staffId || null,
          date: dateObj.toISOString()
        };

        const response = await brain.get_available_timeslots(request);
        const data = await response.json();

        if (data.timeslots.length === 0) {
          // Wenn keine Slots verfügbar sind, zeige eine Nachricht und füge Standard-Zeitoptionen hinzu
          setError('Keine Termine verfügbar an diesem Tag. Möglicherweise ist der Shop geschlossen.');
          
          // Generiere alle Zeitoptionen für den Tag (deaktiviert)
          const allHours = Array.from({ length: 24 }, (_, hour) => {
            return {
              time: `${hour.toString().padStart(2, '0')}:00`,
              disabled: true
            };
          });
          setAvailableSlots(allHours);
        } else {
          // Formatiere die verfügbaren Zeitslots
          const formattedSlots = data.timeslots.map(slot => ({
            time: format(parseISO(slot.start_time), 'HH:mm'),
            disabled: !slot.is_available
          }));
          setAvailableSlots(formattedSlots);
        }
      } catch (error) {
        console.error('Error loading available time slots:', error);
        setError('Fehler beim Laden der verfügbaren Zeitslots');
        toast.error('Fehler beim Laden der verfügbaren Zeitslots');
      } finally {
        setLoading(false);
      }
    };

    loadAvailableSlots();
  }, [shopId, serviceId, staffId, date]);

  return (
    <div>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger className="w-full">
          {loading ? (
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Lade Zeiten...</span>
            </div>
          ) : (
            <SelectValue placeholder="Uhrzeit auswählen" />
          )}
        </SelectTrigger>
        <SelectContent>
          {error ? (
            <div className="px-2 py-1 text-sm text-red-500">{error}</div>
          ) : availableSlots.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Verfügbare Zeiten</SelectLabel>
              {availableSlots.map((slot) => (
                <SelectItem 
                  key={slot.time} 
                  value={slot.time}
                  disabled={slot.disabled}
                >
                  {slot.time} Uhr {slot.disabled && '(nicht verfügbar)'}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            <div className="px-2 py-1 text-sm text-gray-500">Bitte wählen Sie Service, Mitarbeiter und Datum</div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};
