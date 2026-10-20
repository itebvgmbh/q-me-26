import { doc, getDoc } from 'firebase/firestore';
import { firestore as db } from '../firestore-client';
import { TimeSlot } from '../types';
import { buildDayContext, earliestOnlineStart, findConflict, loadShopData, loadStaffRange, StaffDayContext } from '../booking-rules';

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
 * Freie Zeiten einer Person an einem Tag für die Online-Buchung, direkt aus Firestore.
 * Nutzt dieselbe Regel wie das Speichern (booking-rules): Öffnungszeiten, Arbeitszeiten, Pausen, Termine.
 * Dazu die Vorlaufzeit des Ladens für Online-Termine (onlineLeadMinutes) – Nummer ziehen und Tresen nutzen
 * findEarliestSlots und gehen ohne Vorlauf.
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
    const until = new Date(year, month - 1, day + 1);
    const [totalMinutes, range] = await Promise.all([loadServiceMinutes(serviceId), loadStaffRange(shopId, staffId, dateObj, until)]);
    const earliest = earliestOnlineStart(range.shop);
    return slotsForDay(buildDayContext(range, dateObj), dateObj, totalMinutes).filter((slot) => slot.start.getTime() >= earliest);
  } catch (error) {
    console.error('Error directly fetching timeslots from Firestore:', error);
    return [];
  }
};

/**
 * Die nächsten freien Plätze je Person ab jetzt (bis zu perStaff Stück), höchstens maxDays Tage voraus.
 * Lädt Leistung, Laden und die Daten aller Personen gleichzeitig (eine Rundreise) und rechnet die
 * Tage dann im Speicher durch – vorher waren es pro Tag drei Rundreisen nacheinander.
 * Heute zählt dabei der Stand am Tresen (Prognose aus queue-lane.ts): Hängt die Person hinterher,
 * kommt die neue Nummer hinter die Wartenden statt auf eine Zeit, die schon überholt ist.
 */
const upcomingSlots = async (
  shopId: string,
  serviceId: string,
  staffIds: string[],
  perStaff: number,
  maxDays: number,
): Promise<Record<string, TimeSlot[]>> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + maxDays);
  const shop = loadShopData(shopId);
  const [totalMinutes, ...ranges] = await Promise.all([
    loadServiceMinutes(serviceId),
    ...staffIds.map((staffId) => loadStaffRange(shopId, staffId, today, until, shop)),
  ]);

  const now = Date.now();
  const result: Record<string, TimeSlot[]> = {};
  staffIds.forEach((staffId, i) => {
    const found: TimeSlot[] = [];
    for (let offset = 0; offset < maxDays && found.length < perStaff; offset++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const ctx = buildDayContext(ranges[i], day, undefined, { projectAt: now });
      const free = slotsForDay(ctx, day, totalMinutes).filter((slot) => slot.start.getTime() > now);
      found.push(...free.slice(0, perStaff - found.length));
    }
    result[staffId] = found;
  });
  return result;
};

/**
 * Frühester freier Platz je Person ab jetzt, höchstens maxDays Tage voraus (Nummer ziehen und vergeben).
 * Personen ohne freien Platz im Zeitraum bekommen null.
 */
export const findEarliestSlots = async (
  shopId: string,
  serviceId: string,
  staffIds: string[],
  maxDays = 14,
): Promise<Record<string, TimeSlot | null>> => {
  const upcoming = await upcomingSlots(shopId, serviceId, staffIds, 1, maxDays);
  return Object.fromEntries(staffIds.map((staffId) => [staffId, upcoming[staffId][0] ?? null]));
};

/**
 * Die nächsten freien Plätze über alle genannten Personen, nach Beginn sortiert (höchstens limit) –
 * der erste ist der früheste, bei mehreren Personen also der der schnellsten.
 * Für Nummer ziehen, wenn der angezeigte Platz beim Bestätigen schon weg war (QueueBookingService).
 */
export const findNextSlots = async (
  shopId: string,
  serviceId: string,
  staffIds: string[],
  limit: number,
  maxDays = 14,
): Promise<{ staffId: string; slot: TimeSlot }[]> => {
  const upcoming = await upcomingSlots(shopId, serviceId, staffIds, limit, maxDays);
  return staffIds
    .flatMap((staffId) => upcoming[staffId].map((slot) => ({ staffId, slot })))
    .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime())
    .slice(0, limit);
};
