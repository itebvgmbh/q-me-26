import { TimeSlot } from '../types';
import { buildDayContext, earliestOnlineStart, findConflict, loadShopData, loadStaffRange, StaffDayContext } from '../booking-rules';
import { liveLesen, LiveFehlt } from '../live';

// Raster der angebotenen Startzeiten – gleich wie im Backend
const SLOT_INTERVAL_MINUTES = 15;

/** Dauer einer Leistung inklusive Vorbereitungszeit in Minuten (0 = nicht buchbar; GET /routes/live/leistung/{id}) */
const loadServiceMinutes = async (serviceId: string): Promise<number> => {
  try {
    const { leistung } = await liveLesen<{ leistung: { duration?: number; setupTime?: number } }>(`live/leistung/${encodeURIComponent(serviceId)}`);
    return Number(leistung.duration || 0) + Number(leistung.setupTime || 0);
  } catch (error) {
    if (error instanceof LiveFehlt) return 0;
    throw error;
  }
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
 * Freie Zeiten einer Person an einem Tag für die Online-Buchung, im Browser gerechnet aus den Daten vom Backend.
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
    console.error('Freie Zeiten nicht geladen:', error);
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
