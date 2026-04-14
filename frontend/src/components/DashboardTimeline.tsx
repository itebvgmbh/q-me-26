import React from 'react';
import { Staff, Appointment, Service, RecurringBreak } from '../utils/firestore';
import { TimelineView } from './TimelineView';

interface DashboardTimelineProps {
  employee: Staff;
  appointments: Appointment[];
  services: Service[];
  startDate: Date;
  numDays: number;
  recurringBreaks: RecurringBreak[];
  onAppointmentUpdate: (updatedAppointment: Appointment) => void;
  onAppointmentCreate: () => void;
  onDateChange: (date: Date) => void;
  onNumDaysChange: (days: number) => void;
}

/**
 * Timeline component wrapper for the employee dashboard
 * Handles displaying the appointment timeline
 */
export const DashboardTimeline = ({
  employee,
  appointments,
  services,
  startDate,
  numDays,
  recurringBreaks,
  onAppointmentUpdate,
  onAppointmentCreate,
  onDateChange,
  onNumDaysChange
}: DashboardTimelineProps) => {
  return (
    <div className="mt-6">
      <TimelineView
        employee={employee}
        appointments={appointments}
        services={services}
        startDate={startDate}
        numDays={numDays}
        recurringBreaks={recurringBreaks}
        onAppointmentUpdate={onAppointmentUpdate}
        onAppointmentCreate={onAppointmentCreate}
        onDateChange={onDateChange}
        onNumDaysChange={onNumDaysChange}
      />
    </div>
  );
};
