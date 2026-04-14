import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Staff, Service, getStaffByUserId, getServicesByShopId } from '../firestore';
import { createUserProfile } from '../user-profile-service';
import { ensureStaffUserProfile } from '../firestore/staff';

/**
 * Hook to load employee data and services for the employee dashboard
 */
export function useEmployeeData(user: User | null) {
  const [employee, setEmployee] = useState<Staff | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEmployeeData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        console.log('Loading employee data for user:', user.uid);
        const employeeData = await getStaffByUserId(user.uid);
        console.log('Employee data loaded:', employeeData);
        
        if (employeeData) {
          // Ensure this staff member has a user profile in the users collection
          await ensureStaffUserProfile(employeeData);
          
          // Initialize working hours if not set
          if (!employeeData.workingHours || employeeData.workingHours.length === 0) {
            employeeData.workingHours = [
              { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isWorking: false },
              { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isWorking: true },
              { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isWorking: true },
              { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', isWorking: true },
              { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', isWorking: true },
              { dayOfWeek: 5, startTime: '09:00', endTime: '17:00', isWorking: true },
              { dayOfWeek: 6, startTime: '09:00', endTime: '17:00', isWorking: false },
            ];
          }
          setEmployee(employeeData);
          const servicesData = await getServicesByShopId(employeeData.shopId);
          setServices(servicesData);
        }
      } catch (error) {
        console.error('Error loading employee data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEmployeeData();
  }, [user]);

  return { employee, services, loading, setEmployee };
}
