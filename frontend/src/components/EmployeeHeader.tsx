import { Staff } from '../utils/firestore';
import { DateRangeSelector } from './DateRangeSelector';

interface Props {
  employee: Staff;
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

/** Kopf von "Mein Tag": Name und Datumswahl */
export const EmployeeHeader = ({ employee, startDate, numDays, onDateChange, onNumDaysChange }: Props) => (
  <div className="flex flex-col gap-1">
    <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Hallo {employee.name}</p>
    <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Mein Tag</h1>
    <div className="mt-2">
      <DateRangeSelector startDate={startDate} numDays={numDays} onDateChange={onDateChange} onNumDaysChange={onNumDaysChange} />
    </div>
  </div>
);
