import { useState, useEffect, useRef } from 'react';
import { User } from 'app';
import { Staff, Service, getStaffEntriesByUserId, getServicesByShopId } from '../firestore';
import { ensureStaffUserProfile } from '../firestore/staff';
import { useLadenWahl } from '../laden-kontext';

/**
 * Hook to load employee data and services for the employee dashboard.
 * Steht das Konto in mehreren Läden im Team, gilt der Laden aus der Kopfzeile (utils/laden-kontext.tsx; ?staffId=, z. B.
 * aus einer Push-Nachricht, wählt dort den passenden Laden).
 */
export function useEmployeeData(user: User | null) {
  const { laeden, laden, inhaber } = useLadenWahl();
  const bereit = laeden !== null;
  const ladenId = laden?.id ?? null;
  // Läden des Inhabers – für „arbeitet nur in einem fremden Laden mit“
  const eigeneLaeden = useRef<string[]>([]);
  eigeneLaeden.current = inhaber ? (laeden ?? []).map((l) => l.id) : [];
  const [employee, setEmployee] = useState<Staff | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadEmployeeData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      // Erst wissen, welcher Laden oben gewählt ist
      if (!bereit) return;

      try {
        const all = await getStaffEntriesByUserId(user.uid);
        // Der Eintrag im gewählten Laden. Inhaber ohne eigenen Eintrag dort: keiner (dann der Hinweis auf „Team“) –
        // außer sie arbeiten in einem fremden Laden mit.
        const employeeData =
          all.find((s) => s.shopId === ladenId) ??
          (inhaber ? all.find((s) => !eigeneLaeden.current.includes(s.shopId)) : all[0]) ??
          null;
        if (!active) return;

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
          const servicesData = await getServicesByShopId(employeeData.shopId);
          if (!active) return;
          setEmployee(employeeData);
          setServices(servicesData);
        } else {
          setEmployee(null);
        }
      } catch (error) {
        console.error('Error loading employee data:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadEmployeeData();
    return () => {
      active = false;
    };
  }, [user, bereit, ladenId, inhaber]);

  return { employee, services, loading, setEmployee };
}
