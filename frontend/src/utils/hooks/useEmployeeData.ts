import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User } from 'firebase/auth';
import { Staff, Service, getStaffEntriesByUserId, getServicesByShopId, getShopById } from '../firestore';
import { ensureStaffUserProfile } from '../firestore/staff';

/** Ein Eintrag im Team mit dem Namen seines Ladens (für die Auswahl bei mehreren Läden) */
export type StaffEntry = Staff & { shopName: string };

const REMEMBER = 'meinTag.staffId';
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
};

/**
 * Hook to load employee data and services for the employee dashboard.
 * Steht das Konto in mehreren Läden im Team, wählt ?staffId= (oder die letzte Wahl) den Laden.
 */
export function useEmployeeData(user: User | null) {
  const [searchParams, setSearchParams] = useSearchParams();
  const wanted = searchParams.get('staffId');
  const [entries, setEntries] = useState<StaffEntry[]>([]);
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

      try {
        const all = await getStaffEntriesByUserId(user.uid);
        const withNames: StaffEntry[] =
          all.length > 1
            ? await Promise.all(all.map(async (s) => ({ ...s, shopName: (await getShopById(s.shopId).catch(() => null))?.name || 'Laden' })))
            : all.map((s) => ({ ...s, shopName: '' }));
        withNames.sort((a, b) => a.shopName.localeCompare(b.shopName, 'de'));
        const employeeData = withNames.find((s) => s.id === wanted) || withNames.find((s) => s.id === remembered()) || withNames[0] || null;
        if (!active) return;
        setEntries(withNames);

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
  }, [user, wanted]);

  /** Anderen Laden wählen (nur bei mehreren Einträgen) */
  const selectEntry = useCallback(
    (staffId: string) => {
      try {
        localStorage.setItem(REMEMBER, staffId);
      } catch {
        /* privater Modus: nur für diese Sitzung */
      }
      const next = new URLSearchParams(searchParams);
      next.set('staffId', staffId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { employee, entries, selectEntry, services, loading, setEmployee };
}
