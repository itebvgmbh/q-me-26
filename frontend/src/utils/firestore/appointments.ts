import { assertBookable, bookableOf } from '../booking-rules';
import { Appointment } from './types';
import { backendSenden, liveLesen, LiveFehlt, teamTerminePfad } from '../live';
import { t } from '@/i18n';

/** Termine eines Ladens, die in [startDate, endDate) beginnen, auf Wunsch nur einer Person (Auswertung) */
export const getAppointmentsInRange = async (shopId: string, startDate: Date, endDate: Date, staffId?: string): Promise<Appointment[]> => {
  const { termine } = await liveLesen<{ termine: Appointment[] }>(teamTerminePfad(shopId, startDate, endDate), true);
  return staffId ? termine.filter((apt) => apt.staffId === staffId) : termine;
};

// Timestamp, Date oder {seconds} einheitlich in Date umwandeln
const toDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
};

/** Freie Zeiten im Browser neu rechnen und den anderen Ansichten Bescheid sagen (wie bisher nach jeder Änderung) */
const nachDemSpeichern = async (art: 'neu' | 'geaendert', termin: Appointment, vorher?: Appointment) => {
  try {
    const { default: useTimeSlotStore } = await import('../timeSlotStore');
    const events = await import('../firebase/event-system');
    const start = toDateValue(termin.startTime);
    const alt = vorher ? toDateValue(vorher.startTime) : null;
    if (alt && vorher) useTimeSlotStore.getState().invalidateCache(vorher.shopId, alt);
    if (start) useTimeSlotStore.getState().invalidateCache(termin.shopId, start);
    if (art === 'neu' && start) {
      events.emitAppointmentCreated({
        appointmentId: termin.id,
        shopId: termin.shopId,
        staffId: termin.staffId,
        date: start.toISOString().split('T')[0],
        timeSlot: { start, end: toDateValue(termin.endTime) ?? start },
      });
    } else if (art === 'geaendert') {
      events.emitAppointmentUpdated({
        appointmentId: termin.id,
        shopId: termin.shopId,
        staffId: termin.staffId,
        originalDate: alt ?? undefined,
        newDate: start ?? undefined,
        status: termin.status,
      });
    }
  } catch (error) {
    // Zwischenspeicher und Ereignisse dürfen das Speichern nicht scheitern lassen
    console.error('Error invalidating cache or emitting event:', error);
  }
};

/**
 * Legt einen Termin an (Tresen, Kalender, Mein Tag). Die Regeln – Öffnungs- und Arbeitszeiten, Pausen, andere
 * Termine – prüft der Browser wie bisher (booking-rules.ts). Platz belegen, Tagesnummer und öffentliche Kurzfassung
 * erledigt seit Stufe 2 das Backend in einer Transaktion (POST /routes/team/termine, backend/app/libs/team_termine.py):
 * Wer zeitgleich denselben Platz will, bekommt SlotConflictError („Da ist schon ein Termin …“). Freie Zeiten im
 * Backend und „Früher dran“ stößt das Backend selbst an.
 */
export const createAppointment = async (data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Appointment> => {
  const start = toDateValue(data.startTime);
  const end = toDateValue(data.endTime);
  if (!start || !end) {
    throw new Error(t('Ungültige Zeitangabe für den Termin.'));
  }
  if (data.status !== 'cancelled') {
    await bookableOf(data.shopId, [{ staffId: data.staffId, start, end }]);
  }
  const { termin } = await backendSenden<{ termin: Appointment }>('team/termine', {
    termin: { ...data, startTime: start, endTime: end },
  });
  await nachDemSpeichern('neu', termin);
  return termin;
};

export const updateAppointment = async (
  appointmentId: string,
  appointmentData: Partial<Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>>,
  /** notifyCustomer: Der Laden ändert – bei Absage oder neuer Zeit bekommt der Kunde Bescheid */
  options: { notifyCustomer?: boolean } = {},
): Promise<Appointment> => {
  const pfad = `team/termine/${encodeURIComponent(appointmentId)}`;
  let originalAppointment: Appointment;
  try {
    originalAppointment = (await liveLesen<{ termin: Appointment }>(pfad, true)).termin;
  } catch (error) {
    if (error instanceof LiveFehlt) throw new Error('Appointment not found for update');
    throw error;
  }

  // Ändern sich Zeit oder Person, gelten dieselben Regeln wie beim Anlegen (ohne den Termin selbst).
  // Abgesagten Termin wieder aufnehmen belegt seinen Platz neu – dieselben Regeln.
  const merged = { ...originalAppointment, ...appointmentData } as Appointment;
  const before = [toDateValue(originalAppointment.startTime)?.getTime(), toDateValue(originalAppointment.endTime)?.getTime(), originalAppointment.staffId];
  const after = [toDateValue(merged.startTime)?.getTime(), toDateValue(merged.endTime)?.getTime(), merged.staffId];
  const timeOrStaffChanged = before.some((value, i) => value !== after[i]);
  const reactivated = originalAppointment.status === 'cancelled' && merged.status !== 'cancelled';
  if ((timeOrStaffChanged || reactivated) && merged.status !== 'cancelled') {
    const start = toDateValue(merged.startTime);
    const end = toDateValue(merged.endTime);
    if (!start || !end) throw new Error(t('Ungültige Zeitangabe für den Termin.'));
    await assertBookable({ shopId: merged.shopId, staffId: merged.staffId, start, end, excludeAppointmentId: appointmentId });
  }

  // Zeitpunkte (Aufruf, Fertig), Nachricht an den Kunden, Belegung und Kurzfassung setzt das Backend in einer
  // Transaktion (POST /routes/team/termine/{id}); auch „Früher dran“ stößt es an, wo ein Platz frei wird
  const { termin: updatedAppointment } = await backendSenden<{ termin: Appointment }>(pfad, {
    aenderung: appointmentData,
    kundeBenachrichtigen: Boolean(options.notifyCustomer),
  });
  await nachDemSpeichern('geaendert', updatedAppointment, originalAppointment);
  return updatedAppointment;
};
