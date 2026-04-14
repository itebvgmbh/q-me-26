import { format } from 'date-fns';
import { CalendarTimeSlot } from '../utils/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useNavigate } from 'react-router-dom';

interface Props {
  timeSlot: CalendarTimeSlot;
  checkEarlierOptions: boolean;
  onCheckEarlierOptionsChange: (checked: boolean) => void;
}

export function BookingConfirmation({ 
  timeSlot,
  checkEarlierOptions, 
  onCheckEarlierOptionsChange 
}: Props) {
  const navigate = useNavigate();

  return (
    <div className="p-4 bg-green-50 rounded-md">
      <p className="font-medium">Gebuchter Termin:</p>
      <p>
        Datum: {format(timeSlot.start, 'dd.MM.yyyy')}<br/>
        Uhrzeit: {format(timeSlot.start, 'HH:mm')} - {format(timeSlot.end, 'HH:mm')} Uhr
      </p>
      
      <div className="flex items-center space-x-2 mt-3">
        <Checkbox 
          id="check-earlier-options" 
          checked={checkEarlierOptions} 
          onCheckedChange={checked => onCheckEarlierOptionsChange(checked === true)}
        />
        <label 
          htmlFor="check-earlier-options"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Bei früherer Option fragen
        </label>
      </div>
      <Button
        className="mt-4"
        onClick={() => navigate('/my-bookings')}
      >
        Zu meinen Terminen
      </Button>
    </div>
  );
}
