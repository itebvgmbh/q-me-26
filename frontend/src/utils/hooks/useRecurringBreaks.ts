import { useState, useEffect } from 'react';
import { Staff } from '../firestore';
import { RecurringBreak, getRecurringBreaksByStaff } from '../firestore/recurring-breaks';

/**
 * Hook to load recurring breaks for an employee
 */
export function useRecurringBreaks(employee: Staff | null) {
  const [recurringBreaks, setRecurringBreaks] = useState<RecurringBreak[]>([]);

  const loadRecurringBreaks = async () => {
    if (!employee) return;
    try {
      const breaks = await getRecurringBreaksByStaff(employee.id);
      // Only keep active breaks
      setRecurringBreaks(breaks.filter(b => b.active));
    } catch (error) {
      console.error('Error loading recurring breaks:', error);
    }
  };

  useEffect(() => {
    loadRecurringBreaks();
  }, [employee]);

  return { recurringBreaks, loadRecurringBreaks };
}
