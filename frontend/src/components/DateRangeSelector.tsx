import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, format, isToday, startOfDay, subDays } from 'date-fns';
import { de } from 'date-fns/locale';

interface Props {
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

/** Tag(e) blättern und Zeitraum wählen */
export const DateRangeSelector = ({ startDate, numDays, onDateChange, onNumDaysChange }: Props) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => onDateChange(subDays(startDate, numDays))} aria-label="Zurück">
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </Button>
      <p className="min-w-[9.5rem] text-center font-display text-lg font-bold">
        {format(startDate, 'EEE d. MMM', { locale: de })}
        {numDays > 1 && ` – ${format(addDays(startDate, numDays - 1), 'EEE d. MMM', { locale: de })}`}
      </p>
      <Button variant="ghost" size="icon" onClick={() => onDateChange(addDays(startDate, numDays))} aria-label="Weiter">
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
    {!isToday(startDate) && (
      <Button variant="outline" size="sm" onClick={() => onDateChange(startOfDay(new Date()))}>
        Heute
      </Button>
    )}
    <Select value={numDays.toString()} onValueChange={(value) => onNumDaysChange(parseInt(value))}>
      <SelectTrigger className="h-9 w-28" aria-label="Zeitraum">
        <SelectValue />
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
