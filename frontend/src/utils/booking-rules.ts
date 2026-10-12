import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore as db } from './firestore-client';

/**
 * Eine Regel für alle Termine: Was hier nicht frei ist, darf weder angezeigt noch gespeichert werden.
 * Gilt für Kundenbuchung, Warteschlange, Tresen, "Mein Tag" (Anlegen und Verschieben) und das Bearbeiten.
 *
 * Geprüft wird in dieser Reihenfolge:
 *  1. Öffnungszeiten des Ladens (businessHoursByDay; altes Format "HH:mm-HH:mm" gilt für jeden Tag;
 *     ohne Angabe keine Einschränkung durch den Laden)
 *  2. Arbeitszeiten der Person (ohne Arbeitszeiten ist nichts buchbar)
 *  3. Wiederkehrende Pausen (recurring-breaks) und einzelne Pausen (breaks) der Person
 *  4. Andere Termine der Person (abgesagte zählen nicht)
 * Alle Uhrzeiten sind Ortszeit des Ladens (Browserzeit).
 */

type Window = { start: number; end: number };
type Blocked = Window & { reason: string };

export interface StaffDayContext {
  /** buchbares Fenster des Tages als Zeitstempel (ms) oder null, wenn geschlossen */
  open: Window | null;
  /** Grund, falls der ganze Tag nicht buchbar ist */
  closedReason: string | null;
  blocked: Blocked[];
}

const WEEKDAYS = ['sonntags', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags'];
const BREAK_LABEL: Record<string, string> = { lunch: 'Mittagspause', coffee: 'Kaffeepause', personal: 'Private Pause', other: 'Pause' };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const parseHHMM = (value: unknown): number | null => {
  const m = typeof value === 'string' ? value.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toMs = (value: any): number | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};
const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end;

/** Öffnungszeit des Ladens an einem Wochentag in Minuten; 'closed' oder null = keine Einschränkung */
export const shopWindowForDay = (shop: any, dayOfWeek: number): Window | 'closed' | null => {
  const byDay = shop?.businessHoursByDay;
  if (Array.isArray(byDay) && byDay.length > 0) {
    const entry = byDay.find((d: any) => Number(d.dayOfWeek) === dayOfWeek);
    if (!entry || !entry.isOpen) return 'closed';
    const start = parseHHMM(entry.openTime);
    const end = parseHHMM(entry.closeTime);
    return start === null || end === null || end <= start ? 'closed' : { start, end };
  }
  const legacy = typeof shop?.businessHours === 'string' ? shop.businessHours.match(/^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/) : null;
  if (legacy) {
    const start = parseHHMM(legacy[1]);
    const end = parseHHMM(legacy[2]);
    if (start !== null && end !== null && end > start) return { start, end };
  }
  return null;
};

/** Lädt alles, was einen Tag einer Person einschränkt */
export const loadStaffDayContext = async (
  shopId: string,
  staffId: string | null | undefined,
  day: Date,
  excludeAppointmentId?: string,
): Promise<StaffDayContext> => {
  const midnight = new Date(day);
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const dayOfWeek = midnight.getDay();
  const at = (minutes: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();

  const [shopSnap, staffSnap] = await Promise.all([
    getDoc(doc(db, 'shops', shopId)),
    staffId ? getDoc(doc(db, 'staff', staffId)) : Promise.resolve(null),
  ]);
  const shopWin = shopWindowForDay(shopSnap.exists() ? shopSnap.data() : null, dayOfWeek);
  if (shopWin === 'closed') return { open: null, closedReason: `Der Laden hat ${WEEKDAYS[dayOfWeek]} geschlossen.`, blocked: [] };

  let window: Window = shopWin ? { start: at(shopWin.start), end: at(shopWin.end) } : { start: dayStart, end: dayEnd };
  const blocked: Blocked[] = [];

  if (staffId) {
    const staff = staffSnap && staffSnap.exists() ? staffSnap.data() : null;
    const name = staff?.name || 'Diese Person';
    if (!staff) return { open: null, closedReason: 'Diese Person gibt es nicht mehr.', blocked: [] };
    if (staff.isActive === false) return { open: null, closedReason: `${name} ist deaktiviert.`, blocked: [] };
    const hours = Array.isArray(staff.workingHours) ? staff.workingHours : [];
    if (hours.length === 0) return { open: null, closedReason: `Für ${name} sind keine Arbeitszeiten hinterlegt.`, blocked: [] };
    const today = hours.find((h: any) => Number(h.dayOfWeek) === dayOfWeek);
    const ws = parseHHMM(today?.startTime);
    const we = parseHHMM(today?.endTime);
    if (!today || !today.isWorking || ws === null || we === null || we <= ws) {
      return { open: null, closedReason: `${name} arbeitet ${WEEKDAYS[dayOfWeek]} nicht.`, blocked: [] };
    }
    window = { start: Math.max(window.start, at(ws)), end: Math.min(window.end, at(we)) };

    // Pausen und Termine der Person. Einzelne Pausen nur nach Person abfragen und den Tag im
    // Speicher filtern – die Abfrage mit Datumsbereich bräuchte einen eigenen Firestore-Index
    // und lieferte ohne ihn stillschweigend nichts.
    const [recurringSnap, breaksSnap, apptSnap] = await Promise.all([
      getDocs(query(collection(db, 'recurring-breaks'), where('staffId', '==', staffId), where('dayOfWeek', '==', dayOfWeek))),
      getDocs(query(collection(db, 'breaks'), where('staffId', '==', staffId))),
      getDocs(query(collection(db, 'appointments'), where('shopId', '==', shopId), where('staffId', '==', staffId))),
    ]);
    recurringSnap.forEach((d) => {
      const b = d.data();
      if (b.active === false) return;
      const s = parseHHMM(b.startTime);
      const e = parseHHMM(b.endTime);
      if (s === null || e === null || e <= s) return;
      const label = BREAK_LABEL[b.type] || 'Pause';
      blocked.push({ start: at(s), end: at(e), reason: `${label} von ${hhmm(at(s))} bis ${hhmm(at(e))}.` });
    });
    breaksSnap.forEach((d) => {
      const b = d.data();
      const s = toMs(b.startTime);
      const e = toMs(b.endTime);
      if (s === null || e === null || e <= s || e <= dayStart || s >= dayEnd) return;
      blocked.push({ start: s, end: e, reason: `Pause von ${hhmm(s)} bis ${hhmm(e)}.` });
    });
    apptSnap.forEach((d) => {
      if (d.id === excludeAppointmentId) return;
      const a = d.data();
      if (a.status === 'cancelled') return;
      const s = toMs(a.startTime);
      const e = toMs(a.endTime);
      if (s === null || e === null || e <= dayStart || s >= dayEnd) return;
      blocked.push({ start: s, end: e, reason: `Da ist schon ein Termin (${hhmm(s)}–${hhmm(e)}).` });
    });
  }

  if (window.end <= window.start) {
    return { open: null, closedReason: 'Öffnungs- und Arbeitszeiten überschneiden sich an diesem Tag nicht.', blocked: [] };
  }
  return { open: window, closedReason: null, blocked };
};

/** Grund, warum der Zeitraum nicht geht, oder null, wenn er frei ist */
export const findConflict = (ctx: StaffDayContext, start: number, end: number): string | null => {
  if (end <= start) return 'Ende liegt vor dem Beginn.';
  if (!ctx.open) return ctx.closedReason || 'An diesem Tag ist nichts buchbar.';
  if (start < ctx.open.start || end > ctx.open.end) {
    return `Außerhalb der buchbaren Zeit (${hhmm(ctx.open.start)}–${hhmm(ctx.open.end)}).`;
  }
  const hit = ctx.blocked.find((b) => overlaps(b, { start, end }));
  return hit ? hit.reason : null;
};

export class SlotConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlotConflictError';
  }
}

export const isSlotConflict = (error: unknown): error is SlotConflictError =>
  error instanceof SlotConflictError || (error as { name?: string })?.name === 'SlotConflictError';

/** Wirft SlotConflictError mit verständlichem Grund, wenn der Termin so nicht gespeichert werden darf */
export const assertBookable = async (params: {
  shopId: string;
  staffId?: string | null;
  start: Date;
  end: Date;
  excludeAppointmentId?: string;
}): Promise<void> => {
  const ctx = await loadStaffDayContext(params.shopId, params.staffId, params.start, params.excludeAppointmentId);
  const conflict = findConflict(ctx, params.start.getTime(), params.end.getTime());
  if (conflict) throw new SlotConflictError(conflict);
};
