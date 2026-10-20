import { doc, DocumentReference, DocumentSnapshot, Firestore, Timestamp, Transaction } from 'firebase/firestore';

/**
 * Belegung je Person und Tag – damit ein Platz nur einmal vergeben wird.
 *
 * Vorher prüfte createAppointment erst (Abfrage der Termine) und schrieb dann, ohne Sperre dazwischen:
 * Zogen zehn Leute im selben Moment eine Nummer, bekamen alle denselben Platz. Jetzt liest jede
 * Buchung, Verschiebung, Absage und Annahme ("Früher dran", Backend) in ihrer Transaktion das
 * Dokument schedules/{staffId}_{YYYY-MM-DD} und schreibt es fort. Zwei gleichzeitige Buchungen
 * ändern dasselbe Dokument – Firestore lässt nur eine durch, die andere läuft neu und sieht den Platz belegt.
 *
 * Inhalt: slots = { [Termin-ID]: { start, end } } für alle nicht abgesagten Termine der Person an dem Tag
 * (Tag nach deutscher Zeit, gleich im Backend: app/libs/schedule.py). Die Einträge sind nur Sperre und
 * Hinweis – die Wahrheit bleibt der Termin: Überschneidet sich ein Eintrag, wird der Termin selbst in der
 * Transaktion gelesen. Ist er abgesagt, gelöscht oder woanders hin verschoben (z. B. über einen Weg, der
 * das Dokument nicht kennt), fliegt der Eintrag raus. Termine von vor dieser Umstellung stehen nicht darin;
 * die findet weiterhin assertBookable (booking-rules.ts) vor der Transaktion.
 */

export const SCHEDULES = 'schedules';

const BERLIN_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });
/** Tag eines Zeitpunkts nach deutscher Zeit, z. B. "2026-10-21" */
export const dayKey = (d: Date): string => BERLIN_DAY.format(d);

export interface Placement {
  staffId: string;
  start: Date;
  end: Date;
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
};

/** Platz eines Termins (Person, Beginn, Ende) oder null, wenn er keinen belegt (abgesagt, ohne Person) */
export const placementOf = (appointment: { staffId?: string | null; startTime?: unknown; endTime?: unknown; status?: string } | undefined): Placement | null => {
  if (!appointment || appointment.status === 'cancelled' || !appointment.staffId) return null;
  const start = toDate(appointment.startTime);
  const end = toDate(appointment.endTime);
  return start && end && end > start ? { staffId: appointment.staffId, start, end } : null;
};

/** Tage, die ein Platz berührt (meist einer; über Mitternacht zwei) */
const daysOf = (p: Placement): string[] => [...new Set([dayKey(p.start), dayKey(new Date(p.end.getTime() - 1))])];

const hhmm = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

type Entry = { start: Timestamp; end: Timestamp };
interface DayDoc {
  id: string;
  ref: DocumentReference;
  staffId: string;
  day: string;
  snap: DocumentSnapshot;
}

export interface PlacementChange {
  /** Grund, warum der neue Platz nicht geht (wie assertBookable), sonst null */
  conflict: string | null;
  /** Schreibt die Belegung fort – erst nach allen Lesevorgängen der Transaktion aufrufen */
  write: () => void;
}

/**
 * Liest in der Transaktion die Belegung für den alten (release) und neuen Platz (occupy) eines Termins
 * und prüft den neuen. Alle Lesevorgänge passieren hier, geschrieben wird erst mit write().
 */
export async function readPlacement(
  tx: Transaction,
  db: Firestore,
  appointmentId: string,
  change: { shopId: string; occupy?: Placement | null; release?: Placement | null },
): Promise<PlacementChange> {
  const { occupy, release, shopId } = change;
  const docs = new Map<string, Omit<DayDoc, 'snap'>>();
  for (const p of [occupy, release]) {
    if (!p) continue;
    for (const day of daysOf(p)) {
      const id = `${p.staffId}_${day}`;
      docs.set(id, { id, ref: doc(db, SCHEDULES, id), staffId: p.staffId, day });
    }
  }
  const days: DayDoc[] = await Promise.all([...docs.values()].map(async (d) => ({ ...d, snap: await tx.get(d.ref) })));
  const slotsOf = (d: DayDoc): Record<string, Entry> => ({ ...((d.snap.data()?.slots as Record<string, Entry>) || {}) });

  // Einträge, die den neuen Platz überschneiden: am Termin selbst prüfen
  const occupyDays = occupy ? new Set(daysOf(occupy)) : new Set<string>();
  const suspects = new Set<string>();
  if (occupy) {
    const s = occupy.start.getTime();
    const e = occupy.end.getTime();
    for (const d of days) {
      if (d.staffId !== occupy.staffId || !occupyDays.has(d.day)) continue;
      for (const [id, entry] of Object.entries(slotsOf(d))) {
        const es = toDate(entry?.start)?.getTime();
        const ee = toDate(entry?.end)?.getTime();
        if (id !== appointmentId && es !== undefined && ee !== undefined && es < e && s < ee) suspects.add(id);
      }
    }
  }
  let conflict: string | null = null;
  // Korrekturen je Eintrag: null = raus, Placement = auf den echten Stand setzen
  const fixes = new Map<string, Placement | null>();
  const checked = await Promise.all([...suspects].map(async (id) => ({ id, snap: await tx.get(doc(db, 'appointments', id)) })));
  for (const { id, snap } of checked) {
    const actual = snap.exists() ? placementOf(snap.data() as any) : null;
    if (actual && occupy && actual.staffId === occupy.staffId && actual.start < occupy.end && occupy.start < actual.end) {
      conflict ??= `Da ist schon ein Termin (${hhmm(actual.start)}–${hhmm(actual.end)}).`;
    }
    fixes.set(id, actual);
  }

  return {
    conflict,
    write: () => {
      for (const d of days) {
        const slots = slotsOf(d);
        for (const [id, actual] of fixes) {
          if (!(id in slots)) continue;
          if (actual && actual.staffId === d.staffId && daysOf(actual).includes(d.day)) {
            slots[id] = { start: Timestamp.fromDate(actual.start), end: Timestamp.fromDate(actual.end) };
          } else {
            delete slots[id];
          }
        }
        delete slots[appointmentId];
        if (occupy && occupy.staffId === d.staffId && occupyDays.has(d.day)) {
          slots[appointmentId] = { start: Timestamp.fromDate(occupy.start), end: Timestamp.fromDate(occupy.end) };
        }
        tx.set(d.ref, { shopId, staffId: d.staffId, day: d.day, slots, updatedAt: Timestamp.now() });
      }
    },
  };
}

/** Tagesnummern je Laden: shop_days/{shopId}_{YYYY-MM-DD}, codes = alle an dem Tag vergebenen Nummern */
export const SHOP_DAYS = 'shop_days';
export const shopDayRef = (db: Firestore, shopId: string, day: Date) => doc(db, SHOP_DAYS, `${shopId}_${dayKey(day)}`);

/** Zufällige freie Nummer: erst 10–99, wird es eng (60 vergeben), dreistellig */
export const pickReferenceCode = (used: Set<string>): string => {
  const [min, max] = used.size < 60 ? [10, 99] : [100, 999];
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(Math.random() * (max - min + 1)) + min);
    if (!used.has(code)) return code;
  }
  for (let n = 100; n <= 9999; n++) if (!used.has(String(n))) return String(n);
  return String(Date.now() % 100000);
};
