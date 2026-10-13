import { doc, getDoc } from 'firebase/firestore';
import { firestore as db } from '../firestore-client';
import { TimeSlot } from '../types';
import { buildDayContext, findConflict, loadShopData, loadStaffDayContext, loadStaffRange, StaffDayContext } from '../booking-rules';

// Raster der angebotenen Startzeiten – gleich wie im Backend
const SLOT_INTERVAL_MINUTES = 15;

/** Dauer einer Leistung inklusive Vorbereitungszeit in Minuten (0 = nicht buchbar) */
const loadServiceMinutes = async (serviceId: string): Promise<number> => {
  const snap = await getDoc(doc(db, 'services', serviceId));
  if (!snap.exists()) return 0;
  const service = snap.data();
  return Number(service.duration || 0) + Number(service.setupTime || 0);
};

/** Alle freien Startzeiten eines Tages auf dem 15-Minuten-Raster (gerechnet ab Mitternacht Ortszeit) */
const slotsForDay = (ctx: StaffDayContext, day: Date, totalMinutes: number): TimeSlot[] => {
  if (!ctx.open || totalMinutes <= 0) return [];
  const step = SLOT_INTERVAL_MINUTES * 60 * 1000;
  const length = totalMinutes * 60 * 1000;
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const slots: TimeSlot[] = [];
  for (let start = midnight + Math.ceil((ctx.open.start - midnight) / step) * step; start + length <= ctx.open.end; start += step) {
    if (!findConflict(ctx, start, start + length)) {
      slots.push({ start: new Date(start), end: new Date(start + length), isAvailable: true });
    }
  }
  return slots;
};

/**
 * Freie Zeiten einer Person an einem Tag, direkt aus Firestore.
 * Nutzt dieselbe Regel wie das Speichern (booking-rules): Öffnungszeiten, Arbeitszeiten, Pausen, Termine.
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
    const [totalMinutes, ctx] = await Promise.all([loadServiceMinutes(serviceId), loadStaffDayContext(shopId, staffId, dateObj)]);
    return slotsForDay(ctx, dateObj, totalMinutes);
  } catch (error) {
    console.error('Error directly fetching timeslots from Firestore:', error);
    return [];
  }
};

/**
 * Frühester freier Platz je Person ab jetzt, höchstens maxDays Tage voraus.
 * Lädt Leistung, Laden und die Daten aller Personen gleichzeitig (eine Rundreise) und rechnet die
 * Tage dann im Speicher durch – vorher waren es pro Tag drei Rundreisen nacheinander.
 * Personen ohne freien Platz im Zeitraum bekommen null.
 */
export const findEarliestSlots = async (
  shopId: string,
  serviceId: string,
  staffIds: string[],
  maxDays = 14,
): Promise<Record<string, TimeSlot | null>> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + maxDays);
  const shop = loadShopData(shopId);
  const [totalMinutes, ...ranges] = await Promise.all([
    loadServiceMinutes(serviceId),
    ...staffIds.map((staffId) => loadStaffRange(shopId, staffId, today, until, shop)),
  ]);

  const now = Date.now();
  const result: Record<string, TimeSlot | null> = {};
  staffIds.forEach((staffId, i) => {
    result[staffId] = null;
    for (let offset = 0; offset < maxDays && !result[staffId]; offset++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const first = slotsForDay(buildDayContext(ranges[i], day), day, totalMinutes).find((slot) => slot.start.getTime() > now);
      if (first) result[staffId] = first;
    }
  });
  return result;
};
