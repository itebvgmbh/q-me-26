import { doc, getDoc } from 'firebase/firestore';
import { firestore as db } from '../firestore-client';
import { TimeSlot } from '../types';
import { findConflict, loadStaffDayContext } from '../booking-rules';

// Raster der angebotenen Startzeiten – gleich wie im Backend
const SLOT_INTERVAL_MINUTES = 15;

/**
 * Freie Zeiten einer Person an einem Tag, direkt aus Firestore (Fallback, wenn das Backend nicht antwortet).
 * Nutzt dieselbe Regel wie das Speichern (booking-rules): Öffnungszeiten, Arbeitszeiten, Pausen, Termine.
 * Vorher fehlten hier die Pausen komplett – Termine ließen sich in die Mittagspause buchen.
 */
export const getAvailableTimeslotsDirect = async (
  shopId: string,
  serviceId: string,
  staffId: string | null,
  date: string
): Promise<TimeSlot[]> => {
  try {
    if (!staffId) return [];
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return [];
    const dateObj = new Date(year, month - 1, day);

    const serviceSnap = await getDoc(doc(db, 'services', serviceId));
    if (!serviceSnap.exists()) return [];
    const service = serviceSnap.data();
    const totalMinutes = Number(service.duration || 0) + Number(service.setupTime || 0);
    if (totalMinutes <= 0) return [];

    const ctx = await loadStaffDayContext(shopId, staffId, dateObj);
    if (!ctx.open) return [];

    const step = SLOT_INTERVAL_MINUTES * 60 * 1000;
    const length = totalMinutes * 60 * 1000;
    const slots: TimeSlot[] = [];
    // Erste Startzeit auf das Raster runden (gerechnet ab Mitternacht Ortszeit)
    const midnight = new Date(dateObj).getTime();
    let start = midnight + Math.ceil((ctx.open.start - midnight) / step) * step;
    for (; start + length <= ctx.open.end; start += step) {
      if (!findConflict(ctx, start, start + length)) {
        slots.push({ start: new Date(start), end: new Date(start + length), isAvailable: true });
      }
    }
    return slots;
  } catch (error) {
    console.error('Error directly fetching timeslots from Firestore:', error);
    return [];
  }
};
