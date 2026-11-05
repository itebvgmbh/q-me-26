import { useCallback } from 'react';
import { useUserGuardContext } from 'app';

// Import utility hooks
import { useEmployeeData } from '../utils/hooks/useEmployeeData';
import { useAppointments } from '../utils/hooks/useAppointments';
import { useRecurringBreaks } from '../utils/hooks/useRecurringBreaks';
import { useDashboardState } from '../utils/hooks/useDashboardState';

// Import UI components
import { LoadingState } from '../components/LoadingState';
import { NotLoggedInState } from '../components/NotLoggedInState';
import { NoEmployeeState } from '../components/NoEmployeeState';
import { EmployeeNavigation } from '../components/EmployeeNavigation';

// Import dashboard components
import { DashboardHeader } from '../components/DashboardHeader';
import { DashboardTimeline } from '../components/DashboardTimeline';
import { DashboardDialogs } from '../components/DashboardDialogs';
import { TeamPushSchalter } from '../components/TeamPushSchalter';

/**
 * Employee dashboard component showing the employee's appointments and schedule
 */
const EmployeeDashboard = () => {
  const { user } = useUserGuardContext();
  
  // Use dashboard state hook to manage UI state
  const {
    startDate, setStartDate,
    numDays, setNumDays,
    showWorkingHoursDialog, setShowWorkingHoursDialog,
    showCreateCustomerDialog, setShowCreateCustomerDialog
  } = useDashboardState();
  
  // Use custom hooks to load data
  // Im Team mehrerer Läden: gewählt wird oben in der Kopfzeile
  const { employee, services, loading, setEmployee } = useEmployeeData(user);
  const { recurringBreaks } = useRecurringBreaks(employee);
  const { appointments, setAppointments, neuLaden } = useAppointments(employee, startDate, numDays);

  // Neuer Termin: gleich nachfragen statt auf das Ereignis vom Backend zu warten (utils/live.ts)
  const handleAppointmentCreate = useCallback(async () => {
    neuLaden();
  }, [neuLaden]);

  // Render loading state
  if (loading) {
    return <LoadingState user={user} />;
  }

  // Render not logged in state
  if (!user) {
    return <NotLoggedInState user={null} />;
  }

  // Render no employee state
  if (!employee) {
    return <NoEmployeeState user={user} />;
  }

  return (
    <div>
      {/* Navigation bar */}
      <EmployeeNavigation 
        user={user} 
        employee={employee} 
        showLogout={true} 
        userName={employee.name} 
      />
      
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        {/* Dashboard header with date selector and action buttons */}
        <DashboardHeader
          employee={employee}
          startDate={startDate}
          numDays={numDays}
          onDateChange={setStartDate}
          onNumDaysChange={setNumDays}
          onCreateCustomer={() => setShowCreateCustomerDialog(true)}
          onEditWorkingHours={() => setShowWorkingHoursDialog(true)}
        />

        {/* Timeline view for appointments */}
        <DashboardTimeline
          employee={employee}
          appointments={appointments}
          services={services}
          startDate={startDate}
          numDays={numDays}
          recurringBreaks={recurringBreaks}
          onAppointmentUpdate={(updatedAppointment) => {
            setAppointments(appointments.map(apt =>
              apt.id === updatedAppointment.id ? updatedAppointment : apt
            ));
          }}
          onAppointmentCreate={handleAppointmentCreate}
          onDateChange={setStartDate}
          onNumDaysChange={setNumDays}
        />

        {/* Benachrichtigung, wenn Kunden selbst buchen, eine Nummer ziehen oder absagen */}
        <TeamPushSchalter />

        {/* Dialogs for working hours and customer creation */}
        <DashboardDialogs
          employee={employee}
          showWorkingHoursDialog={showWorkingHoursDialog}
          showCreateCustomerDialog={showCreateCustomerDialog}
          setShowWorkingHoursDialog={setShowWorkingHoursDialog}
          setShowCreateCustomerDialog={setShowCreateCustomerDialog}
          onEmployeeUpdate={setEmployee}
        />
      </div>
    </div>
  );
};

export default EmployeeDashboard;