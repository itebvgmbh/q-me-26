import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp, getFirestore, orderBy } from 'firebase/firestore';
import { firebaseApp } from 'app';
import { Staff, Appointment } from '../firestore';
import useTimeSlotStore from '../timeSlotStore';

// Declare global variable for unsubscribing from Firestore listeners
declare global {
  interface Window {
    employeeAppointmentsUnsubscribe?: () => void;
  }
}

/**
 * Hook to setup and manage appointments listener for an employee
 */
export function useAppointments(
  employee: Staff | null, 
  startDate: Date, 
  numDays: number
) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const setupAppointmentsListener = () => {
    if (!employee) return () => {};
    try {
      const endDate = new Date(startDate.getTime() + numDays * 24 * 60 * 60 * 1000);
      console.log('Setting up appointments listener for employee:', employee.id);
      console.log('Date range for appointments:', 
        `${startDate.toISOString()} to ${endDate.toISOString()}`);
      console.log('Employee shop ID:', employee.shopId);
      
      const db = getFirestore(firebaseApp);
      const appointmentsRef = collection(db, 'appointments');
      
      // Important: Only filter by shopId and date range to ensure we catch ALL appointments,
      // including those that may have been moved to this employee
      const q = query(
        appointmentsRef,
        where('shopId', '==', employee.shopId),
        where('startTime', '>=', Timestamp.fromDate(startDate)),
        where('startTime', '<', Timestamp.fromDate(endDate))
      );
      
      // Cleanup previous listener if exists
      if (window.employeeAppointmentsUnsubscribe) {
        window.employeeAppointmentsUnsubscribe();
      }
      
      // Real-time listener for appointments
      const unsubscribe = onSnapshot(q, (snapshot) => {
        // Debug: Log all appointment docs returned from Firestore
        console.log('Raw appointment data from Firestore:');
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          try {
            // Be extra careful with date conversion for debugging
            let startTimeStr = 'invalid';
            if (data.startTime) {
              if (typeof data.startTime.toDate === 'function') {
                const date = data.startTime.toDate();
                startTimeStr = `${date.toISOString()} (${date.toLocaleString('de-DE', {timeZone: 'Europe/Berlin'})})`;  
              } else {
                startTimeStr = String(data.startTime);
              }
            }
            
            console.log(
              `- Appointment ${doc.id}:`,
              `staffId=${data.staffId || 'undefined'} (type: ${typeof data.staffId})`,
              `status=${data.status || 'undefined'}`,
              `startTime=${startTimeStr}`
            );
          } catch (err) {
            console.error('Error logging appointment:', err, data);
          }
        });
        
        const appointmentsData = snapshot.docs.map(doc => {
          const data = doc.data();
          return { id: doc.id, ...data } as Appointment;
        });
        
        // Filter appointments for this employee
        const filteredAppointments = filterAppointmentsForEmployee(appointmentsData, employee);
        console.log(`Filtered appointments for this staff: ${filteredAppointments.length}`);
        
        setAppointments(filteredAppointments);
      }, (error) => {
        console.error('Error in appointments listener:', error);
      });
      
      window.employeeAppointmentsUnsubscribe = unsubscribe;
      return unsubscribe;
    } catch (error) {
      console.error('Error setting up appointments listener:', error);
      return () => {};
    }
  };

  // Filter appointments for a specific employee
  function filterAppointmentsForEmployee(appointments: Appointment[], employee: Staff): Appointment[] {
    // Compare staffId as strings to handle potential type mismatches
    const staffIdStr = String(employee.id);
    
    // Filter appointments for this staff member with status 'scheduled'
    return appointments.filter(apt => {
      // Convert staffId to string for safer comparison
      let aptStaffIdStr = '';
      if (apt.staffId) {
        aptStaffIdStr = String(apt.staffId).trim();
      }
      const isForThisStaff = aptStaffIdStr === staffIdStr;
      const isScheduled = apt.status === 'scheduled';
      
      // Debug output
      console.log(`Filtering appointment ${apt.id}:`, {
        'appointment staffId': aptStaffIdStr,
        'appointment staffId type': typeof apt.staffId,
        'employee id': staffIdStr, 
        'isMatch': isForThisStaff,
        'status': apt.status,
        'isScheduled': isScheduled
      });
      
      if (isForThisStaff && !isScheduled) {
        console.log(`Found appointment for this staff but status is not 'scheduled': ${apt.id}, status=${apt.status}`);
      }
      
      if (isScheduled && !isForThisStaff) {
        console.log(`Found 'scheduled' appointment but for different staff: ${apt.id}, staffId=${apt.staffId} vs ${employee.id}`);
      }
      
      return isForThisStaff && isScheduled;
    });
  }

  // Setup listeners when date range or employee changes
  useEffect(() => {
    const unsubscribeAppointments = setupAppointmentsListener();
    
    // Force refresh appointments from cache invalidation
    if (employee?.shopId) {
      const timeSlotStore = useTimeSlotStore.getState();
      const shopId = employee.shopId;
      const staffId = employee.id;
      
      console.log(`Invalidating cache for employee ${staffId} in shop ${shopId} for ${numDays} days`);
      
      // Use staff-specific cache invalidation to ensure timeslots reflect changes
      // from when a customer accepts an earlier appointment
      for (let i = 0; i < numDays; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + i);
        // Invalidate both shop-wide and staff-specific caches
        timeSlotStore.invalidateCache(shopId, currentDate);
        timeSlotStore.invalidateStaffCache(shopId, staffId, currentDate);
      }
      
      // Log cache state after invalidation (for debugging)
      console.log('Current timeSlotStore cached keys:', 
        Object.keys(timeSlotStore.cachedTimeSlots).filter(key => 
          key.includes(String(shopId)) && key.includes(String(staffId))
        )
      );
    }
    
    // Cleanup listener when component unmounts or dependencies change
    return () => {
      if (unsubscribeAppointments) {
        unsubscribeAppointments();
      }
      if (window.employeeAppointmentsUnsubscribe) {
        window.employeeAppointmentsUnsubscribe();
      }
    };
  }, [startDate, numDays, employee]);

  return { appointments, setAppointments };
}
