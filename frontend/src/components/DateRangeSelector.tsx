import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, format, isToday, startOfDay, subDays } from 'date-fns';
import { datumsLocale, t, tn } from '@/i18n';

interface Props {
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

/**
 * Tag(e) blättern und Zeitraum wählen.
 * Ein neuer Zeitraum beginnt heute; die Pfeile schieben ihn um je einen Tag.
 */
export const DateRangeSelector = ({ startDate, numDays, onDateChange, onNumDaysChange }: Props) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => onDateChange(subDays(startDate, 1))} aria-label={t('Einen Tag zurück')}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </Button>
      <p className="min-w-[9.5rem] text-center font-display text-lg font-bold">
        {format(startDate, t('EEE d. MMM'), { locale: datumsLocale() })}
        {numDays > 1 && ` – ${format(addDays(startDate, numDays - 1), t('EEE d. MMM'), { locale: datumsLocale() })}`}
      </p>
      <Button variant="ghost" size="icon" onClick={() => onDateChange(addDays(startDate, 1))} aria-label={t('Einen Tag weiter')}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
    {!isToday(startDate) && (
      <Button variant="outline" size="sm" onClick={() => onDateChange(startOfDay(new Date()))}>
        {t('Heute')}
      </Button>
    )}
    <Select
      value={numDays.toString()}
      onValueChange={(value) => {
        onNumDaysChange(parseInt(value));
        onDateChange(startOfDay(new Date()));
      }}
    >
      <SelectTrigger className="h-9 w-28" aria-label={t('Zeitraum')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 3, 5, 7].map((tage) => (
          <SelectItem key={tage} value={String(tage)}>
            {tn(tage, '{n} Tag', '{n} Tage')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
