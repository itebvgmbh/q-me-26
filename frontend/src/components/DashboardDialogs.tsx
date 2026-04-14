import React from 'react';
import { Staff } from '../utils/firestore';
import { WorkingHoursDialog, CreateCustomerDialog } from './EmployeeDialogs';

interface DashboardDialogsProps {
  employee: Staff;
  showWorkingHoursDialog: boolean;
  showCreateCustomerDialog: boolean;
  setShowWorkingHoursDialog: (show: boolean) => void;
  setShowCreateCustomerDialog: (show: boolean) => void;
  onEmployeeUpdate: (updatedEmployee: Staff) => void;
}

/**
 * Component to handle all dialog components used in the employee dashboard
 */
export const DashboardDialogs = ({
  employee,
  showWorkingHoursDialog,
  showCreateCustomerDialog,
  setShowWorkingHoursDialog,
  setShowCreateCustomerDialog,
  onEmployeeUpdate
}: DashboardDialogsProps) => {
  return (
    <>
      {/* Working hours dialog */}
      <WorkingHoursDialog 
        employee={employee}
        open={showWorkingHoursDialog}
        onOpenChange={setShowWorkingHoursDialog}
        onUpdate={onEmployeeUpdate}
      />

      {/* Create customer dialog */}
      <CreateCustomerDialog 
        shopId={employee.shopId}
        open={showCreateCustomerDialog}
        onOpenChange={setShowCreateCustomerDialog}
        onCustomerCreated={() => {
          console.log('Customer created');
          setShowCreateCustomerDialog(false);
        }}
      />
    </>
  );
};
