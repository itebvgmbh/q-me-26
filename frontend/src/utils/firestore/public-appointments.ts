import { toMs } from '../queue-lane';
import { liveLesen } from '../live';
import type { Appointment } from './types';

/**
 * Öffentliche Kurzfassung eines Termins: public_appointments/{Termin-ID}.
 *
 * Termine (appointments) sieht nur der Laden (Inhaber, Team) und das eigene Konto – dort stehen Name, Handynummer,
 * E-Mail für Benachrichtigungen und Konto. Wer ohne Anmeldung freie Plätze sucht, eine Nummer zieht, seine
 * Nummernseite oder den Wartezimmer-Bildschirm ansieht, braucht davon nur Zeit, Person, Status und Nummer:
 * Die stehen hier, und nur die (PUBLIC_FIELDS).
 *
 * Geschrieben wird die Kurzfassung vom Backend in derselben Transaktion wie der Termin (app/libs/public_appointments.py),
 * gelesen über das Backend (GET /routes/live/…; requirements/eigene-datenbank.md, Stufe 2).
 * staffDay und shopDay ({Person}_{Tag}, {Laden}_{Tag}, Tag nach deutscher Zeit) machen die Abfragen ohne eigenen
 * Index möglich.
 */

/** Was öffentlich ist – dieselbe Liste im Backend (app/libs/public_appointments.py) */
export const PUBLIC_FIELDS = [
  'shopId',
  'staffId',
  'serviceId',
  'type',
  'status',
  'startTime',
  'endTime',
  'referenceCode',
  'isAnonymous',
  'calledAt',
  'lastCalledAt',
  'completedAt',
] as const;

export type PublicAppointment = Pick<Appointment, (typeof PUBLIC_FIELDS)[number] | 'id'> & {
  staffDay?: string;
  shopDay?: string;
};

const BERLIN_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });
/** Tag eines Zeitpunkts nach deutscher Zeit, z. B. "2026-10-21" (gleich im Backend: app/libs/schedule.py) */
export const dayKey = (d: Date): string => BERLIN_DAY.format(d);

export const staffDayKey = (staffId: string, day: Date) => `${staffId}_${dayKey(day)}`;
export const shopDayKey = (shopId: string, day: Date) => `${shopId}_${dayKey(day)}`;

/** Kurzfassung eines Termins, so wie er nach dem Speichern aussieht (Felder ohne Wert fallen weg) */
export const publicViewOf = (appointment: Record<string, any>): Record<string, unknown> => {
  const view: Record<string, unknown> = {};
  for (const field of PUBLIC_FIELDS) {
    if (appointment[field] !== undefined && appointment[field] !== null) view[field] = appointment[field];
  }
  const start = toMs(appointment.startTime);
  if (start !== null) {
    const day = new Date(start);
    if (appointment.shopId) view.shopDay = shopDayKey(appointment.shopId, day);
    if (appointment.staffId) view.staffDay = staffDayKey(appointment.staffId, day);
  }
  return view;
};

/** Mehr Tage auf einmal nimmt das Backend nicht (GET /routes/live/person/{id}/belegt) */
const MAX_TAGE = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Kurzfassungen der Termine einer Person an allen Tagen (deutsche Zeit), die [from, to) berührt – für freie Plätze
 * (booking-rules.ts) und die Position in „Meine Termine“. Lange Zeiträume in Stücken.
 */
export const publicOfStaffBetween = async (staffId: string, from: Date, to: Date): Promise<PublicAppointment[]> => {
  if (to.getTime() <= from.getTime()) return [];
  const stuecke: [Date, Date][] = [];
  for (let s = from.getTime(); s < to.getTime(); s += MAX_TAGE * DAY_MS) {
    stuecke.push([new Date(s), new Date(Math.min(to.getTime(), s + MAX_TAGE * DAY_MS))]);
  }
  const antworten = await Promise.all(
    stuecke.map(([von, bis]) =>
      liveLesen<{ termine: PublicAppointment[] }>(
        `live/person/${encodeURIComponent(staffId)}/belegt?${new URLSearchParams({ von: von.toISOString(), bis: bis.toISOString() })}`,
      ),
    ),
  );
  // Stücke grenzen an einem Tag aneinander: denselben Termin nur einmal
  const termine = new Map<string, PublicAppointment>();
  for (const { termine: liste } of antworten) for (const termin of liste) termine.set(termin.id, termin);
  return [...termine.values()];
};
