import { collection, doc, DocumentReference, Firestore, getDocs, query, QueryDocumentSnapshot, where } from 'firebase/firestore';
import { toMs } from '../queue-lane';
import { dayKey } from './schedule';
import type { Appointment } from './types';

/**
 * Öffentliche Kurzfassung eines Termins: public_appointments/{Termin-ID}.
 *
 * Termine (appointments) lesen nur der Laden (Inhaber, Team) und das eigene Konto – dort stehen Name, Handynummer,
 * E-Mail für Benachrichtigungen und Konto. Wer ohne Anmeldung freie Plätze sucht, eine Nummer zieht, seine
 * Nummernseite oder den Wartezimmer-Bildschirm ansieht, braucht davon nur Zeit, Person, Status und Nummer:
 * Die stehen hier, und nur die (PUBLIC_FIELDS).
 *
 * Geschrieben wird die Kurzfassung in derselben Transaktion wie der Termin (appointments.ts, im Backend
 * app/libs/public_appointments.py); die Firestore-Regeln lassen nur eine genaue Kopie des Termins zu. Das Backend
 * gleicht zusätzlich laufend ab, etwa für Browserfenster, die noch einen alten Stand der App haben.
 * staffDay und shopDay ({Person}_{Tag}, {Laden}_{Tag}, Tag nach deutscher Zeit wie in schedule.ts) machen die
 * Abfragen ohne eigenen Index möglich.
 */
export const PUBLIC_APPOINTMENTS = 'public_appointments';

/** Was öffentlich ist – dieselbe Liste in firestore.rules (publicAppointment) und im Backend */
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

export const publicRef = (db: Firestore, appointmentId: string) => doc(db, PUBLIC_APPOINTMENTS, appointmentId);

/** In der Transaktion (oder im Batch) des Termins mitschreiben; after = der Termin nach diesem Schritt */
export const writePublic = (
  writer: { set: (ref: DocumentReference, data: Record<string, unknown>) => unknown },
  db: Firestore,
  appointmentId: string,
  after: Record<string, any>,
) => {
  writer.set(publicRef(db, appointmentId), publicViewOf(after));
};

export const publicFromDoc = (d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }) as PublicAppointment;

/** Termine einer Person an einem Tag (Schlange auf der Nummernseite, Position in „Meine Termine“) */
export const staffDayQuery = (db: Firestore, staffId: string, day: Date) =>
  query(collection(db, PUBLIC_APPOINTMENTS), where('staffDay', '==', staffDayKey(staffId, day)));

/** Termine eines Ladens an einem Tag (Wartezimmer-Bildschirm, Tagesnummern) */
export const shopDayQuery = (db: Firestore, shopId: string, day: Date) =>
  query(collection(db, PUBLIC_APPOINTMENTS), where('shopDay', '==', shopDayKey(shopId, day)));

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** Tage (deutsche Zeit), die der Zeitraum [from, to) berührt */
export const daysBetween = (from: Date, to: Date): string[] => {
  const days = new Set<string>();
  for (let t = from.getTime(); t < to.getTime(); t += HALF_DAY_MS) days.add(dayKey(new Date(t)));
  if (to.getTime() > from.getTime()) days.add(dayKey(new Date(to.getTime() - 1)));
  return [...days];
};

/** Termine einer Person, die in [from, to) beginnen – je 30 Tage eine Abfrage (Grenze von Firestore für „in“) */
export const publicOfStaffBetween = async (db: Firestore, staffId: string, from: Date, to: Date): Promise<PublicAppointment[]> => {
  const keys = daysBetween(from, to).map((day) => `${staffId}_${day}`);
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 30) chunks.push(keys.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((chunk) => getDocs(query(collection(db, PUBLIC_APPOINTMENTS), where('staffDay', 'in', chunk)))));
  return snaps.flatMap((snap) => snap.docs.map(publicFromDoc));
};
