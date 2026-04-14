import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Staff, WorkingHours, updateStaffWorkingHours } from '../utils/firestore';

interface Props {
  employee: Staff;
  onUpdate: (updatedEmployee: Staff) => void;
  onCancel: () => void;
}

const DAYS_OF_WEEK = [
  { name: 'Sonntag', value: 0 },
  { name: 'Montag', value: 1 },
  { name: 'Dienstag', value: 2 },
  { name: 'Mittwoch', value: 3 },
  { name: 'Donnerstag', value: 4 },
  { name: 'Freitag', value: 5 },
  { name: 'Samstag', value: 6 },
];

export const WorkingHoursForm = ({ employee, onUpdate, onCancel }: Props) => {
  console.log('WorkingHoursForm:', { employee });

  console.log('Initializing working hours');
  const [workingHours, setWorkingHours] = useState<WorkingHours[]>(

    (employee.workingHours && employee.workingHours.length > 0) ? employee.workingHours : DAYS_OF_WEEK.map(day => ({
      dayOfWeek: day.value,
      startTime: '09:00',
      endTime: '17:00',
      isWorking: day.value > 0 && day.value < 6, // Mon-Fri by default
    }))
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleWorkingDayToggle = (dayOfWeek: number) => {
    setWorkingHours(prev =>
      prev.map(day =>
        day.dayOfWeek === dayOfWeek
          ? { ...day, isWorking: !day.isWorking }
          : day
      )
    );
  };

  const handleTimeChange = (dayOfWeek: number, field: 'startTime' | 'endTime', value: string) => {
    setWorkingHours(prev =>
      prev.map(day =>
        day.dayOfWeek === dayOfWeek
          ? { ...day, [field]: value }
          : day
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const updatedEmployee = await updateStaffWorkingHours(employee.id, workingHours);
      onUpdate(updatedEmployee);
      toast.success('Arbeitszeiten erfolgreich aktualisiert');
    } catch (error: any) {
      console.error('Error updating working hours:', error);
      toast.error('Fehler beim Aktualisieren: ' + (error.message || 'Unbekannter Fehler'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-4">
      <div className="space-y-6">
      {DAYS_OF_WEEK.map(day => {
        const dayHours = workingHours.find(h => h.dayOfWeek === day.value);
        if (!dayHours) return null;

        return (
          <div key={day.value} className="flex items-center space-x-4">
            <div className="w-32">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={dayHours.isWorking}
                  onCheckedChange={() => handleWorkingDayToggle(day.value)}
                />
                <Label>{day.name}</Label>
              </div>
            </div>

            {dayHours.isWorking && (
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`start-${day.value}`}>Von</Label>
                  <Input
                    id={`start-${day.value}`}
                    type="time"
                    value={dayHours.startTime}
                    onChange={(e) => handleTimeChange(day.value, 'startTime', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`end-${day.value}`}>Bis</Label>
                  <Input
                    id={`end-${day.value}`}
                    type="time"
                    value={dayHours.endTime}
                    onChange={(e) => handleTimeChange(day.value, 'endTime', e.target.value)}
                    required
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      </div>
      <div className="flex justify-end space-x-2 pt-6 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Speichern...' : 'Änderungen speichern'}
        </Button>
      </div>
    </form>
  );
};
