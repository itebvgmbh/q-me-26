import React from 'react';
import { Staff } from '../utils/firestore';
import { EmployeeHeader } from './EmployeeHeader';
import { EmployeeActionButtons } from './EmployeeActionButtons';

interface DashboardHeaderProps {
  employee: Staff;
  startDate: Date;
  numDays: number;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
  onCreateCustomer: () => void;
  onEditWorkingHours: () => void;
}

/**
 * Combined header component for the employee dashboard
 * Contains both the employee info and action buttons
 */
export const DashboardHeader = ({
  employee,
  startDate,
  numDays,
  onDateChange,
  onNumDaysChange,
  onCreateCustomer,
  onEditWorkingHours
}: DashboardHeaderProps) => {
  return (
    <>
      {/* Dashboard header with employee name and date selector */}
      <EmployeeHeader 
        employee={employee}
        startDate={startDate}
        numDays={numDays}
        onDateChange={onDateChange}
        onNumDaysChange={onNumDaysChange}
      />
      
      {/* Action buttons */}
      <EmployeeActionButtons 
        onCreateCustomer={onCreateCustomer}
        onEditWorkingHours={onEditWorkingHours}
      />
    </>
  );
};
