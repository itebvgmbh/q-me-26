import { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, isToday, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarTimeSlot, TimeSlot } from '../utils/types';
import useTimeSlotStore from '../utils/timeSlotStore';

interface Props {
  shopId: string;
  serviceId: string;
  staffId?: string;
  selectedSlot?: CalendarTimeSlot | null;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  forceRefresh?: boolean;
}

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

/** Wochenleiste + freie Uhrzeiten eines Tages */
export const CustomerCalendar = ({ shopId, serviceId, staffId, selectedSlot, onTimeSlotSelect, forceRefresh = false }: Props) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const canGoBack = weekStart > startOfToday();

  const getTimeSlots = useTimeSlotStore((state) => state.getTimeSlots);
  const shouldForceRefresh = forceRefresh !== false;

  useEffect(() => {
    if (!shopId || !serviceId) return;
    let active = true;
    setNothingAhead(false);

    const fetchAvailableSlots = async () => {
      setLoading(true);
      setError(null);
      try {
        const timeSlots = await getTimeSlots(shopId, serviceId, staffId || null, selectedDate, shouldForceRefresh);
        if (!active) return;
        setAvailableSlots(timeSlots.filter((slot) => slot.start > new Date()));
      } catch (err) {
        console.error('Error fetching available slots:', err);
        if (active) setError('Die freien Zeiten konnten nicht geladen werden. Versuch es gleich noch einmal.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchAvailableSlots();
    return () => {
      active = false;
    };
  }, [selectedDate, shopId, serviceId, staffId, getTimeSlots]);

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
        const slots = await getTimeSlots(shopId, serviceId, staffId || null, day, false);
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
        <Button variant="ghost" size="icon" onClick={() => navigateWeek(false)} disabled={!canGoBack} aria-label="Vorherige Woche">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <p className="font-display text-lg font-bold">
          {format(weekStart, 'd. MMM', { locale: de })} – {format(addDays(weekStart, 6), 'd. MMM yyyy', { locale: de })}
        </p>
        <Button variant="ghost" size="icon" onClick={() => navigateWeek(true)} aria-label="Nächste Woche">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Tag wählen">
        {weekDays.map((day) => {
          const isPast = day < startOfToday();
          const selected = isSameDay(day, selectedDate);
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isPast}
              aria-pressed={selected}
              aria-label={format(day, 'EEEE, d. MMMM', { locale: de })}
              onClick={() => setSelectedDate(day)}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm transition-colors',
                selected ? 'border-foreground bg-foreground text-signal' : 'border-border bg-card hover:border-foreground',
                isPast && 'cursor-not-allowed border-transparent bg-transparent text-muted-foreground/50 hover:border-transparent',
              )}
            >
              <span className="text-xs font-medium uppercase">{format(day, 'EEEEEE', { locale: de })}</span>
              <span className="font-mono text-lg font-bold">{format(day, 'd')}</span>
              {isToday(day) && !selected && <span className="h-1 w-1 rounded-full bg-foreground" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div aria-live="polite">
        <p className="mb-3 text-sm font-semibold text-muted-foreground">
          {format(selectedDate, 'EEEE, d. MMMM', { locale: de })}
          {!loading && !error && availableSlots.length > 0 && ` · ${freeCount} frei`}
        </p>
        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Zeiten werden geladen">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
        ) : freeCount === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {nothingAhead ? 'In den nächsten drei Wochen ist nichts frei. Probier eine andere Person.' : 'An diesem Tag ist nichts mehr frei.'}
            </p>
            {!nothingAhead && (
              <Button variant="outline" size="sm" onClick={findNextFreeDay} disabled={searching}>
                {searching ? 'Suche …' : 'Nächsten freien Tag suchen'}
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
                  aria-label={`${format(start, 'HH:mm')} bis ${format(end, 'HH:mm')} Uhr${slot.isAvailable ? '' : ', belegt'}`}
                  onClick={() => onTimeSlotSelect({ start, end })}
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
