import { collection, doc, DocumentData, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { firestore as db } from './firestore-client';

/**
 * Eine Regel für alle Termine: Was hier nicht frei ist, darf weder angezeigt noch gespeichert werden.
 * Gilt für Kundenbuchung, Warteschlange, Tresen, "Mein Tag" (Anlegen und Verschieben) und das Bearbeiten.
 *
 * Geprüft wird in dieser Reihenfolge:
 *  1. Öffnungszeiten des Ladens (businessHoursByDay; altes Format "HH:mm-HH:mm" gilt für jeden Tag;
 *     ohne Angabe keine Einschränkung durch den Laden), dazu Pausen des Ladens je Tag
 *     (businessHoursByDay[].breaks, z. B. mittags geschlossen) – gelten für alle Personen
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

/** Pausen des Ladens an einem Wochentag in Minuten (nur innerhalb der Öffnungszeit, unlesbare fallen weg) */
export const shopBreaksForDay = (shop: any, dayOfWeek: number): Window[] => {
  const byDay = shop?.businessHoursByDay;
  if (!Array.isArray(byDay)) return [];
  const entry = byDay.find((d: any) => Number(d.dayOfWeek) === dayOfWeek);
  if (!entry?.isOpen || !Array.isArray(entry.breaks)) return [];
  return entry.breaks
    .map((b: any) => ({ start: parseHHMM(b?.startTime), end: parseHHMM(b?.endTime) }))
    .filter((b: { start: number | null; end: number | null }): b is Window => b.start !== null && b.end !== null && b.end > b.start);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rohdaten zu einer Person über einen Zeitraum – einmal geladen, für beliebig viele Tage nutzbar */
export interface StaffRangeData {
  shop: DocumentData | null;
  staffId: string | null | undefined;
  staff: DocumentData | null;
  recurringBreaks: DocumentData[];
  breaks: DocumentData[];
  appointments: { id: string; data: DocumentData }[];
}

export const loadShopData = async (shopId: string): Promise<DocumentData | null> => {
  const snap = await getDoc(doc(db, 'shops', shopId));
  return snap.exists() ? snap.data() : null;
};

/**
 * Lädt alles, was die Tage einer Person zwischen from und to einschränkt – alle Abfragen gleichzeitig,
 * also eine Rundreise zum Server. Vorher lud die Platzsuche das für jeden Tag einzeln und nacheinander
 * (bis zu 14 Tage × 3 Rundreisen) und jedes Mal alle Termine der Person seit Anbeginn.
 * Termine nur im Zeitraum (Index staffId + startTime ist vorhanden), mit einem Tag Vorlauf für
 * Termine, die vor Mitternacht beginnen. Einzelne Pausen nur nach Person, den Tag filtert
 * buildDayContext – eine Abfrage mit Datumsbereich bräuchte einen eigenen Index.
 */
export const loadStaffRange = async (
  shopId: string,
  staffId: string | null | undefined,
  from: Date,
  to: Date,
  shop?: Promise<DocumentData | null>,
): Promise<StaffRangeData> => {
  const shopPromise = shop ?? loadShopData(shopId);
  if (!staffId) {
    return { shop: await shopPromise, staffId, staff: null, recurringBreaks: [], breaks: [], appointments: [] };
  }
  const [shopData, staffSnap, recurringSnap, breaksSnap, apptSnap] = await Promise.all([
    shopPromise,
    getDoc(doc(db, 'staff', staffId)),
    getDocs(query(collection(db, 'recurring-breaks'), where('staffId', '==', staffId))),
    getDocs(query(collection(db, 'breaks'), where('staffId', '==', staffId))),
    getDocs(
      query(
        collection(db, 'appointments'),
        where('staffId', '==', staffId),
        where('startTime', '>=', Timestamp.fromMillis(from.getTime() - DAY_MS)),
        where('startTime', '<', Timestamp.fromDate(to)),
      ),
    ),
  ]);
  return {
    shop: shopData,
    staffId,
    staff: staffSnap.exists() ? staffSnap.data() : null,
    recurringBreaks: recurringSnap.docs.map((d) => d.data()),
    breaks: breaksSnap.docs.map((d) => d.data()),
    appointments: apptSnap.docs.filter((d) => d.data().shopId === shopId).map((d) => ({ id: d.id, data: d.data() })),
  };
};

/** Rechnet aus den geladenen Daten, was an einem Tag buchbar ist – ohne Netz */
export const buildDayContext = (data: StaffRangeData, day: Date, excludeAppointmentId?: string): StaffDayContext => {
  const midnight = new Date(day);
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  const dayEnd = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1).getTime();
  const dayOfWeek = midnight.getDay();
  const at = (minutes: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();

  const shopWin = shopWindowForDay(data.shop, dayOfWeek);
  if (shopWin === 'closed') return { open: null, closedReason: `Der Laden hat ${WEEKDAYS[dayOfWeek]} geschlossen.`, blocked: [] };

  let window: Window = shopWin ? { start: at(shopWin.start), end: at(shopWin.end) } : { start: dayStart, end: dayEnd };
  const blocked: Blocked[] = shopBreaksForDay(data.shop, dayOfWeek).map((b) => ({
    start: at(b.start),
    end: at(b.end),
    reason: `Der Laden macht Pause von ${hhmm(at(b.start))} bis ${hhmm(at(b.end))}.`,
  }));

  if (data.staffId) {
    const staff = data.staff;
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

    data.recurringBreaks.forEach((b) => {
      if (b.active === false || Number(b.dayOfWeek) !== dayOfWeek) return;
      const s = parseHHMM(b.startTime);
      const e = parseHHMM(b.endTime);
      if (s === null || e === null || e <= s) return;
      const label = BREAK_LABEL[b.type] || 'Pause';
      blocked.push({ start: at(s), end: at(e), reason: `${label} von ${hhmm(at(s))} bis ${hhmm(at(e))}.` });
    });
    data.breaks.forEach((b) => {
      const s = toMs(b.startTime);
      const e = toMs(b.endTime);
      if (s === null || e === null || e <= s || e <= dayStart || s >= dayEnd) return;
      blocked.push({ start: s, end: e, reason: `Pause von ${hhmm(s)} bis ${hhmm(e)}.` });
    });
    data.appointments.forEach(({ id, data: a }) => {
      if (id === excludeAppointmentId) return;
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

/** Lädt alles, was einen Tag einer Person einschränkt */
export const loadStaffDayContext = async (
  shopId: string,
  staffId: string | null | undefined,
  day: Date,
  excludeAppointmentId?: string,
): Promise<StaffDayContext> => {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return buildDayContext(await loadStaffRange(shopId, staffId, from, to), day, excludeAppointmentId);
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
