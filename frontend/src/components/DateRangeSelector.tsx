import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, format, startOfDay, subDays } from 'date-fns';
import { de } from 'date-fns/locale';

interface Props {
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

export const DateRangeSelector = ({
  startDate,
  numDays,
  onDateChange,
  onNumDaysChange,
}: Props) => {
  const handlePrevious = () => {
    onDateChange(subDays(startDate, numDays));
  };

  const handleNext = () => {
    onDateChange(addDays(startDate, numDays));
  };

  const handleToday = () => {
    onDateChange(startOfDay(new Date()));
  };

  return (
    <div className="flex items-center space-x-4">
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
        >
          ←
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToday}
        >
          Heute
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
        >
          →
        </Button>
      </div>

      <div className="text-lg font-medium">
        {format(startDate, 'dd. MMMM yyyy', { locale: de })}
        {numDays > 1 && ` - ${format(addDays(startDate, numDays - 1), 'dd. MMMM yyyy', { locale: de })}`}
      </div>

      <Select
        value={numDays.toString()}
        onValueChange={(value) => onNumDaysChange(parseInt(value))}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Zeitraum wählen" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">1 Tag</SelectItem>
          <SelectItem value="3">3 Tage</SelectItem>
          <SelectItem value="5">5 Tage</SelectItem>
          <SelectItem value="7">7 Tage</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
