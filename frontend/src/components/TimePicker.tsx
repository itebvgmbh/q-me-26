import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '../utils/cn';

interface TimePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export const TimePicker = ({ id, value, onChange, className, disabled = false }: TimePickerProps) => {
  const [hours, setHours] = useState<string>('09');
  const [minutes, setMinutes] = useState<string>('00');

  // Extract hours and minutes from the initial value
  useEffect(() => {
    if (value) {
      const [hoursPart, minutesPart] = value.split(':');
      setHours(hoursPart);
      setMinutes(minutesPart);
    }
  }, [value]);

  // Update the time when hours or minutes change
  const updateTime = (newHours: string, newMinutes: string) => {
    const formattedTime = `${newHours}:${newMinutes}`;
    onChange(formattedTime);
  };

  // Handle hours change
  const handleHoursChange = (newHours: string) => {
    setHours(newHours);
    updateTime(newHours, minutes);
  };

  // Handle minutes change
  const handleMinutesChange = (newMinutes: string) => {
    setMinutes(newMinutes);
    updateTime(hours, newMinutes);
  };

  // Generate hours options (00-23)
  const hoursOptions = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return (
      <SelectItem key={`hour-${hour}`} value={hour}>
        {hour}
      </SelectItem>
    );
  });

  // Generate minutes options (00, 15, 30, 45)
  const minutesOptions = ['00', '15', '30', '45'].map((minute) => (
    <SelectItem key={`minute-${minute}`} value={minute}>
      {minute}
    </SelectItem>
  ));

  return (
    <div className={cn('flex space-x-2 items-center', className)}>
      {/* Hours select */}
      <Select
        disabled={disabled}
        value={hours}
        onValueChange={handleHoursChange}
      >
        <SelectTrigger className="w-[70px]" id={id ? `${id}-hours` : undefined}>
          <SelectValue placeholder="Std" />
        </SelectTrigger>
        <SelectContent>
          {hoursOptions}
        </SelectContent>
      </Select>

      <span>:</span>

      {/* Minutes select */}
      <Select
        disabled={disabled}
        value={minutes}
        onValueChange={handleMinutesChange}
      >
        <SelectTrigger className="w-[70px]" id={id ? `${id}-minutes` : undefined}>
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent>
          {minutesOptions}
        </SelectContent>
      </Select>
    </div>
  );
};
