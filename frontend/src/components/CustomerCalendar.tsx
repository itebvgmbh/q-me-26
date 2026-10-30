import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, startOfWeek, isToday, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarTimeSlot, TimeSlot } from '../utils/types';
import useTimeSlotStore from '../utils/timeSlotStore';
import { t, tn, datumsLocale } from '@/i18n';

interface Props {
  shopId: string;
  serviceId: string;
  staffId?: string;
  /** „Egal wer“: ohne staffId die Zeiten aller dieser Personen zusammen */
  staffIds?: string[];
  selectedSlot?: CalendarTimeSlot | null;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  forceRefresh?: boolean;
}

type Slot = TimeSlot & { staffOptions?: string[] };

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

/** Zeiten mehrerer Personen zu einer Liste: frei, wenn mindestens eine frei ist; staffOptions = wer */
const mergeSlots = (staffIds: string[], perStaff: TimeSlot[][]): Slot[] => {
  const byStart = new Map<number, Slot>();
  perStaff.forEach((slots, i) => {
    for (const slot of slots) {
      const key = slot.start.getTime();
      const entry = byStart.get(key) ?? { start: slot.start, end: slot.end, isAvailable: false, staffOptions: [] };
      if (slot.isAvailable) {
        entry.isAvailable = true;
        entry.staffOptions!.push(staffIds[i]);
      }
      byStart.set(key, entry);
    }
  });
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
};

/** Wochenleiste + freie Uhrzeiten eines Tages */
export const CustomerCalendar = ({ shopId, serviceId, staffId, staffIds, selectedSlot, onTimeSlotSelect, forceRefresh = false }: Props) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const canGoBack = weekStart > startOfToday();

  const getTimeSlots = useTimeSlotStore((state) => state.getTimeSlots);
  const shouldForceRefresh = forceRefresh !== false;

  // Liste über ihren Inhalt vergleichen – die Seite baut sie bei jedem Zeichnen neu
  const staffKey = staffId ? '' : (staffIds ?? []).join(',');
  const anyStaffIds = useMemo(() => (staffKey ? staffKey.split(',') : []), [staffKey]);
  const slotsFor = useCallback(
    async (day: Date, force: boolean): Promise<Slot[]> => {
      if (anyStaffIds.length === 0) return getTimeSlots(shopId, serviceId, staffId || null, day, force);
      const perStaff = await Promise.all(anyStaffIds.map((id) => getTimeSlots(shopId, serviceId, id, day, force)));
      return mergeSlots(anyStaffIds, perStaff);
    },
    [anyStaffIds, getTimeSlots, shopId, serviceId, staffId],
  );

  useEffect(() => {
    if (!shopId || !serviceId) return;
    let active = true;
    setNothingAhead(false);

    const fetchAvailableSlots = async () => {
      setLoading(true);
      setError(null);
      try {
        const timeSlots = await slotsFor(selectedDate, shouldForceRefresh);
        if (!active) return;
        setAvailableSlots(timeSlots.filter((slot) => slot.start > new Date()));
      } catch (err) {
        console.error('Error fetching available slots:', err);
        if (active) setError(t('Die freien Zeiten konnten nicht geladen werden. Versuch es gleich noch einmal.'));
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchAvailableSlots();
    return () => {
      active = false;
    };
  }, [selectedDate, shopId, serviceId, slotsFor]);

  const navigateWeek = (forward: boolean) => {
    const next = addDays(currentDate, forward ? 7 : -7);
    setCurrentDate(next);
    const nextStart = startOfWeek(next, { weekStartsOn: 1 });
    setSelectedDate(nextStart < startOfToday() ? startOfToday() : nextStart);
  };

  const freeCount = availableSlots.filter((s) => s.isAvailable).length;
  const [searching, setSearching] = useState(false);
  const [nothingAhead, setNothingAhead] = useState(false);

  // Springt zum nächsten Tag mit freien Zeiten (bis zu drei Wochen voraus)
  const findNextFreeDay = async () => {
    setSearching(true);
    setNothingAhead(false);
    try {
      for (let i = 1; i <= 21; i++) {
        const day = addDays(selectedDate, i);
        const slots = await slotsFor(day, false);
        if (slots.some((slot) => slot.isAvailable && slot.start > new Date())) {
          setCurrentDate(day);
          setSelectedDate(day);
          return;
        }
      }
      setNothingAhead(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigateWeek(false)} disabled={!canGoBack} aria-label={t('Vorherige Woche')}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <p className="font-display text-lg font-bold">
          {format(weekStart, t('d. MMM'), { locale: datumsLocale() })} – {format(addDays(weekStart, 6), t('d. MMM yyyy'), { locale: datumsLocale() })}
        </p>
        <Button variant="ghost" size="icon" onClick={() => navigateWeek(true)} aria-label={t('Nächste Woche')}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={t('Tag wählen')}>
        {weekDays.map((day) => {
          const isPast = day < startOfToday();
          const selected = isSameDay(day, selectedDate);
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isPast}
              aria-pressed={selected}
              aria-label={format(day, t('EEEE, d. MMMM'), { locale: datumsLocale() })}
              onClick={() => setSelectedDate(day)}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm transition-colors',
                selected ? 'border-foreground bg-foreground text-signal' : 'border-border bg-card hover:border-foreground',
                isPast && 'cursor-not-allowed border-transparent bg-transparent text-muted-foreground/50 hover:border-transparent',
              )}
            >
              <span className="text-xs font-medium uppercase">{format(day, 'EEEEEE', { locale: datumsLocale() })}</span>
              <span className="font-mono text-lg font-bold">{format(day, 'd')}</span>
              {isToday(day) && !selected && <span className="h-1 w-1 rounded-full bg-foreground" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div aria-live="polite">
        <p className="mb-3 text-sm font-semibold text-muted-foreground">
          {format(selectedDate, t('EEEE, d. MMMM'), { locale: datumsLocale() })}
          {!loading && !error && availableSlots.length > 0 && ` · ${tn(freeCount, '{n} frei', '{n} frei')}`}
        </p>
        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={t('Zeiten werden geladen')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
        ) : freeCount === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {nothingAhead
                ? anyStaffIds.length > 0
                  ? t('In den nächsten drei Wochen ist nichts frei. Probier eine andere Leistung.')
                  : t('In den nächsten drei Wochen ist nichts frei. Probier eine andere Person.')
                : t('An diesem Tag ist nichts mehr frei.')}
            </p>
            {!nothingAhead && (
              <Button variant="outline" size="sm" onClick={findNextFreeDay} disabled={searching}>
                {searching ? t('Suche …') : t('Nächsten freien Tag suchen')}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {availableSlots.map((slot) => {
              const { start, end } = slot;
              const isSelected = !!selectedSlot && selectedSlot.start.getTime() === start.getTime();
              return (
                <button
                  key={start.toISOString()}
                  type="button"
                  disabled={!slot.isAvailable}
                  aria-pressed={isSelected}
                  aria-label={
                    slot.isAvailable
                      ? t('{von} bis {bis} Uhr', { von: format(start, 'HH:mm'), bis: format(end, 'HH:mm') })
                      : t('{von} bis {bis} Uhr, belegt', { von: format(start, 'HH:mm'), bis: format(end, 'HH:mm') })
                  }
                  onClick={() => onTimeSlotSelect({ start, end, staffOptions: slot.staffOptions })}
                  className={cn(
                    'h-11 rounded-full border font-mono text-[15px] font-medium transition-colors',
                    isSelected
                      ? 'border-foreground bg-signal text-signal-foreground'
                      : slot.isAvailable
                        ? 'border-border bg-card hover:border-foreground'
                        : 'cursor-not-allowed border-dashed border-border bg-transparent text-muted-foreground/60 line-through',
                  )}
                >
                  {format(start, 'HH:mm')}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
