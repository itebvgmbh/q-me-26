import { useState, useEffect } from 'react';
import { Staff, Appointment } from '../firestore';
import { teamTerminePfad, useLive } from '../live';
import useTimeSlotStore from '../timeSlotStore';

const DAY_MS = 24 * 60 * 60 * 1000;

// Alle Termine der Person außer abgesagten – vorher nur "scheduled", dadurch fehlte
// ausgerechnet der Kunde, der gerade dran ist
const filterAppointmentsForEmployee = (appointments: Appointment[], employee: Staff): Appointment[] => {
  const staffIdStr = String(employee.id);
  return appointments.filter((apt) => String(apt.staffId || '').trim() === staffIdStr && apt.status !== 'cancelled');
};

/**
 * Termine einer Person für Mein Tag, live vom Backend (GET /routes/team/termine, utils/live.ts; Stufe 2 in
 * requirements/eigene-datenbank.md). Geholt werden alle Termine des Ladens im Zeitraum, gezeigt nur die der Person –
 * so sind auch Termine dabei, die gerade zu ihr verschoben wurden. setAppointments für sofortige Anzeige nach eigenen
 * Änderungen; die nächste Antwort des Backends gilt dann. neuLaden: gleich nachfragen (z. B. nach dem Anlegen).
 */
export function useAppointments(employee: Staff | null, startDate: Date, numDays: number) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const live = useLive<{ termine: Appointment[]; kanaele: string[] }>(
    employee ? teamTerminePfad(employee.shopId, startDate, new Date(startDate.getTime() + numDays * DAY_MS)) : null,
    { anmelden: true },
  );

  useEffect(() => {
    if (live.daten && employee) setAppointments(filterAppointmentsForEmployee(live.daten.termine, employee));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.daten, employee?.id]);

  // Freie Zeiten im Browser neu rechnen, wenn sich Zeitraum oder Person ändern (z. B. nach „Früher dran“)
  useEffect(() => {
    if (!employee?.shopId) return;
    const timeSlotStore = useTimeSlotStore.getState();
    for (let i = 0; i < numDays; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);
      timeSlotStore.invalidateCache(employee.shopId, currentDate);
      timeSlotStore.invalidateStaffCache(employee.shopId, employee.id, currentDate);
    }
  }, [startDate, numDays, employee]);

  return { appointments, setAppointments, neuLaden: live.neuLaden };
}
