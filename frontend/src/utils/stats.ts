// Auswertung eines Ladens aus seinen Terminen: Kunden pro Tag, Anteil Nummer/Termin, Wartezeit, Stoßzeiten.
// Wartezeit = Nummer gezogen (createdAt) bis aufgerufen (calledAt, setzt updateAppointment seit Oktober 2026).
import { format } from 'date-fns';
import { datumsLocale, t } from '@/i18n';
import { safelyConvertToDate } from './datetime';
import type { Appointment } from './firestore';

export interface DayStat {
  key: string;
  label: string;
  queue: number;
  booked: number;
  cancelled: number;
}

export interface ShopStats {
  days: DayStat[];
  customers: number;
  queueShare: number;
  avgWaitMinutes: number | null;
  waitSamples: number;
  cancelled: number;
  revenue: number;
  byHour: number[];
  busiestHour: number | null;
}

const MAX_PLAUSIBLE_WAIT_MIN = 240;

export const computeStats = (appts: Appointment[], from: Date, to: Date): ShopStats => {
  const days: DayStat[] = [];
  for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push({ key: format(d, 'yyyy-MM-dd'), label: format(d, t('EEEEEE d.M.'), { locale: datumsLocale() }), queue: 0, booked: 0, cancelled: 0 });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  const byHour = Array.from({ length: 24 }, () => 0);
  let customers = 0;
  let queue = 0;
  let cancelled = 0;
  let revenue = 0;
  let waitSum = 0;
  let waitSamples = 0;

  for (const a of appts) {
    const start = safelyConvertToDate(a.startTime);
    const day = byKey.get(format(start, 'yyyy-MM-dd'));
    if (!day) continue;
    if (a.status === 'cancelled') {
      day.cancelled++;
      cancelled++;
      continue;
    }
    customers++;
    byHour[start.getHours()]++;
    if (a.type === 'booked') {
      day.booked++;
    } else {
      day.queue++;
      queue++;
      if (a.createdAt && a.calledAt) {
        const wait = (safelyConvertToDate(a.calledAt).getTime() - safelyConvertToDate(a.createdAt).getTime()) / 60_000;
        if (wait >= 0 && wait <= MAX_PLAUSIBLE_WAIT_MIN) {
          waitSum += wait;
          waitSamples++;
        }
      }
    }
    if (a.status === 'completed' && typeof a.price === 'number') revenue += a.price;
  }

  const max = Math.max(...byHour);
  return {
    days,
    customers,
    queueShare: customers ? queue / customers : 0,
    avgWaitMinutes: waitSamples ? Math.round(waitSum / waitSamples) : null,
    waitSamples,
    cancelled,
    revenue,
    byHour,
    busiestHour: max > 0 ? byHour.indexOf(max) : null,
  };
};
