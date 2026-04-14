import { Staff } from '../utils/firestore';
import { DateRangeSelector } from './DateRangeSelector';

interface Props {
  employee: Staff;
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

/**
 * Header component for the employee dashboard
 */
export const EmployeeHeader = ({ 
  employee, 
  startDate, 
  numDays, 
  onDateChange, 
  onNumDaysChange 
}: Props) => {
  return (
    <div className="flex flex-col space-y-6 sm:space-y-0 sm:flex-row sm:justify-between sm:items-start mb-6">
      <div>
        <h1 className="text-2xl font-bold">{employee.name}</h1>
        <p className="text-muted-foreground">Mitarbeiter Dashboard</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
        <DateRangeSelector
          startDate={startDate}
          numDays={numDays}
          onDateChange={onDateChange}
          onNumDaysChange={onNumDaysChange}
        />
      </div>
    </div>
  );
};
