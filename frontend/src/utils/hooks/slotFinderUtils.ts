import { addDays } from 'date-fns';
import useTimeSlotStore from '../timeSlotStore';
import { TimeSlot } from '../types';
import { Staff } from '../firestore/types';

// Wie weit die Schlange höchstens vorausschaut
const MAX_DAYS_AHEAD = 14;

/**
 * Sucht den frühesten freien Platz ab jetzt – Tag für Tag, bis zu zwei Wochen voraus.
 * Bei "egal wer" gewinnt die Person mit dem frühesten Platz.
 *
 * @param shopId Shop
 * @param serviceId Leistung
 * @param staffId gewählte Person (ignoriert, wenn useAnyStaff)
 * @param useAnyStaff jede Person, die die Leistung anbietet
 * @param staffList Personen des Shops
 * @param isAuthenticated ob der Kunde angemeldet ist
 * @returns frühester Slot und die Person dazu
 */
export const findAvailableTimeSlot = async (
  shopId: string,
  serviceId: string,
  staffId: string,
  useAnyStaff: boolean,
  staffList: Staff[],
  isAuthenticated: boolean
): Promise<{ slot: TimeSlot | null; selectedStaffForSlot: string }> => {
  // Fehlt isActive im Dokument, gilt die Person als aktiv
  const active = staffList.filter((staff) => staff.isActive !== false);
  const staffToSearch = useAnyStaff ? active : active.filter((staff) => staff.id === staffId);

  if (staffToSearch.length === 0) {
    console.error('No staff members to search');
    return { slot: null, selectedStaffForSlot: '' };
  }

  const { getTimeSlots } = useTimeSlotStore.getState();
  const today = new Date();

  for (let offset = 0; offset < MAX_DAYS_AHEAD; offset++) {
    const day = addDays(today, offset);
    const now = new Date();

    const perStaff = await Promise.all(
      staffToSearch.map(async (staff) => {
        try {
          const slots = await getTimeSlots(shopId, serviceId, staff.id, day, false, isAuthenticated);
          const first = slots
            .filter((slot) => slot.isAvailable && slot.start > now)
            .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
          return first ? { slot: first, staffId: staff.id } : null;
        } catch (error) {
          console.error('Error loading slots for staff', staff.id, error);
          return null;
        }
      })
    );

    const earliest = perStaff
      .filter((result): result is { slot: TimeSlot; staffId: string } => result !== null)
      .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime())[0];

    if (earliest) {
      return { slot: earliest.slot, selectedStaffForSlot: earliest.staffId };
    }
  }

  return { slot: null, selectedStaffForSlot: '' };
};
