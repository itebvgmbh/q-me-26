import { collection, doc, DocumentData, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestore as db } from './firestore-client';
import { occupiedWindow, projectLane } from './queue-lane';
import { publicOfStaffBetween } from './firestore/public-appointments';
import { merke, t, tn, intlSprache } from '@/i18n';

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
 *  4. Andere Termine der Person (abgesagte zählen nicht): Wartende mit ihrer geplanten Zeit, wer dran ist ab
 *     Aufruf, wer fertig ist nur bis "Fertig" – wer früher fertig ist, gibt den Rest seiner Zeit frei (queue-lane.ts)
 *  5. Nur bei der Platzsuche für Nummern (projectAt): die Prognose der heutigen Schlange – hängt der Laden
 *     hinterher, bekommt eine neue Nummer eine Zeit nach den Wartenden statt einer, die schon überholt ist.
 *     Beim Speichern zählt die Prognose nicht, sonst scheiterte ein eben gefundener Platz an einer Minute Uhrzeit.
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

// Nur für die Meldungen, übersetzt mit t() beim Zusammensetzen; die Schlüssel von BREAK_LABEL sind Daten (recurring-breaks.type)
const WEEKDAYS = [merke('sonntags'), merke('montags'), merke('dienstags'), merke('mittwochs'), merke('donnerstags'), merke('freitags'), merke('samstags')];
const BREAK_LABEL: Record<string, string> = { lunch: merke('Mittagspause'), coffee: merke('Kaffeepause'), personal: merke('Private Pause'), other: merke('Pause') };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(intlSprache(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
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
 * Termine nur im Zeitraum, mit einem Tag Vorlauf für Termine, die vor Mitternacht beginnen – aus den öffentlichen
 * Kurzfassungen (public-appointments.ts: Zeit, Status, Aufrufe, keine Namen), damit es auch ohne Anmeldung geht.
 * Einzelne Pausen nur nach Person, den Tag filtert buildDayContext – eine Abfrage mit Datumsbereich bräuchte einen
 * eigenen Index.
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
    publicOfStaffBetween(db, staffId, new Date(from.getTime() - DAY_MS), to),
  ]);
  return {
    shop: shopData,
    staffId,
    staff: staffSnap.exists() ? staffSnap.data() : null,
    recurringBreaks: recurringSnap.docs.map((d) => d.data()),
    breaks: breaksSnap.docs.map((d) => d.data()),
    appointments: apptSnap.filter((a) => a.shopId === shopId).map(({ id, ...data }) => ({ id, data })),
  };
};

/** Rechnet aus den geladenen Daten, was an einem Tag buchbar ist – ohne Netz */
export const buildDayContext = (
  data: StaffRangeData,
  day: Date,
  excludeAppointmentId?: string,
  options: { projectAt?: number } = {},
): StaffDayContext => {
  const midnight = new Date(day);
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  const dayEnd = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1).getTime();
  const dayOfWeek = midnight.getDay();
  const at = (minutes: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();

  // Vom Betreiber gesperrt (Betreiber-Bereich): nichts buchbar, auch nicht vom Tresen
  if (data.shop?.suspended) return { open: null, closedReason: t('Dieser Laden nimmt gerade keine Buchungen an.'), blocked: [] };
  const shopWin = shopWindowForDay(data.shop, dayOfWeek);
  if (shopWin === 'closed') return { open: null, closedReason: t('Der Laden hat {tag} geschlossen.', { tag: t(WEEKDAYS[dayOfWeek]) }), blocked: [] };

  let window: Window = shopWin ? { start: at(shopWin.start), end: at(shopWin.end) } : { start: dayStart, end: dayEnd };
  const blocked: Blocked[] = shopBreaksForDay(data.shop, dayOfWeek).map((b) => ({
    start: at(b.start),
    end: at(b.end),
    reason: t('Der Laden macht Pause von {von} bis {bis}.', { von: hhmm(at(b.start)), bis: hhmm(at(b.end)) }),
  }));

  if (data.staffId) {
    const staff = data.staff;
    const name = staff?.name || t('Diese Person');
    if (!staff) return { open: null, closedReason: t('Diese Person gibt es nicht mehr.'), blocked: [] };
    if (staff.isActive === false) return { open: null, closedReason: t('{name} ist deaktiviert.', { name }), blocked: [] };
    const hours = Array.isArray(staff.workingHours) ? staff.workingHours : [];
    if (hours.length === 0) return { open: null, closedReason: t('Für {name} sind keine Arbeitszeiten hinterlegt.', { name }), blocked: [] };
    const today = hours.find((h: any) => Number(h.dayOfWeek) === dayOfWeek);
    const ws = parseHHMM(today?.startTime);
    const we = parseHHMM(today?.endTime);
    if (!today || !today.isWorking || ws === null || we === null || we <= ws) {
      return { open: null, closedReason: t('{name} arbeitet {tag} nicht.', { name, tag: t(WEEKDAYS[dayOfWeek]) }), blocked: [] };
    }
    window = { start: Math.max(window.start, at(ws)), end: Math.min(window.end, at(we)) };

    data.recurringBreaks.forEach((b) => {
      if (b.active === false || Number(b.dayOfWeek) !== dayOfWeek) return;
      const s = parseHHMM(b.startTime);
      const e = parseHHMM(b.endTime);
      if (s === null || e === null || e <= s) return;
      const label = t(BREAK_LABEL[b.type] || 'Pause');
      blocked.push({ start: at(s), end: at(e), reason: t('{pause} von {von} bis {bis}.', { pause: label, von: hhmm(at(s)), bis: hhmm(at(e)) }) });
    });
    data.breaks.forEach((b) => {
      const s = toMs(b.startTime);
      const e = toMs(b.endTime);
      if (s === null || e === null || e <= s || e <= dayStart || s >= dayEnd) return;
      blocked.push({ start: s, end: e, reason: t('Pause von {von} bis {bis}.', { von: hhmm(s), bis: hhmm(e) }) });
    });
    const others = data.appointments.filter(({ id }) => id !== excludeAppointmentId);
    others.forEach(({ id, data: a }) => {
      const w = occupiedWindow({ ...a, id });
      if (!w || w.end <= dayStart || w.start >= dayEnd) return;
      blocked.push({ ...w, reason: t('Da ist schon ein Termin ({von}–{bis}).', { von: hhmm(w.start), bis: hhmm(w.end) }) });
    });
    const now = options.projectAt;
    if (now !== undefined && now >= dayStart && now < dayEnd) {
      const lane = others
        .filter(({ data: a }) => {
          const s = toMs(a.startTime);
          return s !== null && s >= dayStart && s < dayEnd;
        })
        .map(({ id, data: a }) => ({ ...a, id }));
      projectLane(lane, now).forEach((w) => {
        blocked.push({ ...w, reason: t('Die Schlange ist bis ca. {zeit} belegt.', { zeit: hhmm(w.end) }) });
      });
    }
  }

  if (window.end <= window.start) {
    return { open: null, closedReason: t('Öffnungs- und Arbeitszeiten überschneiden sich an diesem Tag nicht.'), blocked: [] };
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
  if (end <= start) return t('Ende liegt vor dem Beginn.');
  if (!ctx.open) return ctx.closedReason || t('An diesem Tag ist nichts buchbar.');
  if (start < ctx.open.start || end > ctx.open.end) {
    return t('Außerhalb der buchbaren Zeit ({von}–{bis}).', { von: hhmm(ctx.open.start), bis: hhmm(ctx.open.end) });
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

/**
 * Wie assertBookable, aber für mehrere mögliche Plätze eines neuen Termins (Nummer ziehen im Ansturm):
 * gibt die erlaubten in derselben Reihenfolge zurück; je Person und Tag wird nur einmal geladen.
 * Ist keiner erlaubt, SlotConflictError mit dem Grund des ersten.
 */
export const bookableOf = async <T extends { staffId?: string | null; start: Date; end: Date }>(shopId: string, slots: T[]): Promise<T[]> => {
  const contexts = new Map<string, Promise<StaffDayContext>>();
  const contextOf = (slot: T) => {
    const key = `${slot.staffId ?? ''}|${slot.start.toDateString()}`;
    if (!contexts.has(key)) contexts.set(key, loadStaffDayContext(shopId, slot.staffId, slot.start));
    return contexts.get(key)!;
  };
  const reasons = await Promise.all(slots.map(async (slot) => findConflict(await contextOf(slot), slot.start.getTime(), slot.end.getTime())));
  const allowed = slots.filter((_, i) => !reasons[i]);
  if (allowed.length === 0) throw new SlotConflictError(reasons[0] || t('An diesem Tag ist nichts buchbar.'));
  return allowed;
};

/** Höchste Vorlaufzeit für Online-Termine in Minuten (ein Tag) */
export const MAX_ONLINE_LEAD_MINUTES = 24 * 60;

/**
 * Vorlaufzeit für Online-Termine in Minuten (Mein Laden → Bearbeiten): Online buchbar ist frühestens
 * so weit ab jetzt. Gespeichert in shops.timeSlotBuffer als Millisekunden, ältere Einträge als Text.
 * Gilt nur für die Kundenbuchung – Nummer ziehen und Termine vom Tresen oder aus "Mein Tag" gehen sofort.
 */
export const onlineLeadMinutes = (shop: { timeSlotBuffer?: unknown } | null | undefined): number => {
  const ms = Number(shop?.timeSlotBuffer ?? 0);
  return Number.isFinite(ms) && ms > 0 ? Math.min(MAX_ONLINE_LEAD_MINUTES, Math.round(ms / 60000)) : 0;
};

/** Frühester Beginn eines Online-Termins als Zeitstempel (ms) */
export const earliestOnlineStart = (shop: { timeSlotBuffer?: unknown } | null | undefined, now = Date.now()): number =>
  now + onlineLeadMinutes(shop) * 60000;

/** Wirft SlotConflictError, wenn ein Online-Termin zu kurzfristig ist (vor dem Speichern der Kundenbuchung) */
export const assertOnlineLead = async (shopId: string, start: Date): Promise<void> => {
  const shop = await loadShopData(shopId);
  const minutes = onlineLeadMinutes(shop);
  if (minutes > 0 && start.getTime() < earliestOnlineStart(shop)) {
    throw new SlotConflictError(
      minutes % 60 === 0
        ? tn(minutes / 60, 'Online geht es hier frühestens eine Stunde im Voraus.', 'Online geht es hier frühestens {n} Stunden im Voraus.')
        : tn(minutes, 'Online geht es hier frühestens eine Minute im Voraus.', 'Online geht es hier frühestens {n} Minuten im Voraus.'),
    );
  }
};
