import { useState } from 'react';
import { startOfDay } from 'date-fns';

/**
 * Hook to manage dashboard UI state
 * Handles dialog visibility and date range selection
 */
export function useDashboardState() {
  // Date range state for appointments filtering
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  const [numDays, setNumDays] = useState(1);
  
  // Dialog state
  const [showWorkingHoursDialog, setShowWorkingHoursDialog] = useState(false);
  const [showCreateCustomerDialog, setShowCreateCustomerDialog] = useState(false);
  
  return {
    // Date range state
    startDate,
    setStartDate,
    numDays,
    setNumDays,
    
    // Dialog state
    showWorkingHoursDialog,
    setShowWorkingHoursDialog,
    showCreateCustomerDialog,
    setShowCreateCustomerDialog
  };
}
