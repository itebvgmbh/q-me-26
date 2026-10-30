import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CustomerCalendar } from './CustomerCalendar';
import { getShopStaff, type Staff } from '../utils/firestore';
import { isTaken, moveTicket } from '../utils/ticket-key';
import useTimeSlotStore from '../utils/timeSlotStore';
import type { CalendarTimeSlot } from '../utils/types';
import { datumsLocale, t } from '@/i18n';

const EGAL = 'egal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  shopId: string;
  serviceId: string;
  /** Person der Nummer – vorgewählt */
  staffId?: string;
  /** Nummer ohne Konto: ihr Schlüssel (utils/ticket-key.ts) */
  ticketKey: string | null;
  signedIn: boolean;
}

const zeitText = (d: Date) => format(d, t('EEE d. MMM, HH:mm'), { locale: datumsLocale() });

/**
 * „Platz ändern“: andere Zeit aussuchen, auch bei einer anderen Person. Das Backend verschiebt in einer Transaktion,
 * der jetzige Platz bleibt, bis der neue sicher ist (backend/app/apis/nummer, /nummer/verschieben). Danach ist es
 * ein fester Termin; die Nummernseite zeigt die neue Zeit von selbst (öffentliche Kurzfassung, live).
 */
export function PlatzAendern({ open, onOpenChange, appointmentId, shopId, serviceId, staffId, ticketKey, signedIn }: Props) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [person, setPerson] = useState(staffId || EGAL);
  const [slot, setSlot] = useState<CalendarTimeSlot | null>(null);
  const [busy, setBusy] = useState(false);
  // Neu zählen lässt den Kalender frisch laden (Platz war beim Verschieben schon weg)
  const [calendarKey, setCalendarKey] = useState(0);

  useEffect(() => {
    if (!open || !shopId) return;
    let alive = true;
    getShopStaff(shopId)
      .then((list) => alive && setStaff(list))
      .catch(() => alive && setStaff([]));
    return () => {
      alive = false;
    };
  }, [open, shopId]);

  // Beim Öffnen wieder bei der eigenen Person anfangen
  useEffect(() => {
    if (!open) return;
    setPerson(staffId || EGAL);
    setSlot(null);
  }, [open, staffId]);

  // Wer aktiv ist und die Leistung anbietet; ist niemand zugeordnet, alle
  const eligible = useMemo(() => {
    const active = staff.filter((s) => s.isActive !== false);
    const offering = active.filter((s) => s.serviceIds?.includes(serviceId));
    return offering.length > 0 ? offering : active;
  }, [staff, serviceId]);
  const anyStaff = person === EGAL;

  const choosePerson = (id: string) => {
    setPerson(id);
    setSlot(null);
  };

  const move = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      await moveTicket({
        appointmentId,
        key: ticketKey,
        staffIds: anyStaff ? slot.staffOptions ?? eligible.map((s) => s.id) : [person],
        start: slot.start,
        signedIn,
      });
      useTimeSlotStore.getState().invalidateCache(shopId, slot.start);
      toast.success(t('Dein Platz ist jetzt {zeit}.', { zeit: zeitText(slot.start) }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Das hat nicht geklappt. Versuch es noch einmal.'));
      if (isTaken(error)) {
        setSlot(null);
        setCalendarKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl bg-background">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 pb-2">
          <SheetHeader className="text-start">
            <SheetTitle className="font-display text-2xl">{t('Platz ändern')}</SheetTitle>
            <SheetDescription>{t('Such dir eine andere Zeit aus. Dein jetziger Platz bleibt, bis der neue sicher ist.')}</SheetDescription>
          </SheetHeader>

          {eligible.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Bei wem?')}>
              {[{ id: EGAL, name: t('Egal wer') }, ...eligible].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={person === s.id}
                  onClick={() => choosePerson(s.id)}
                  className={cn(
                    'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                    person === s.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:border-foreground',
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <CustomerCalendar
            key={`${person}-${calendarKey}`}
            shopId={shopId}
            serviceId={serviceId}
            staffId={anyStaff ? undefined : person}
            staffIds={anyStaff ? eligible.map((s) => s.id) : undefined}
            selectedSlot={slot}
            onTimeSlotSelect={setSlot}
            forceRefresh
          />

          {/* Bleibt unten stehen – die Uhrzeiten eines Tages sind auf dem Handy länger als der Bildschirm */}
          <div className="sticky bottom-0 -mx-1 bg-background px-1 pb-1 pt-3">
            <Button size="lg" variant="signal" className="w-full" onClick={move} disabled={!slot || busy}>
              {busy ? t('Wird geändert …') : slot ? t('Auf {zeit} verschieben', { zeit: zeitText(slot.start) }) : t('Neue Zeit wählen')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
