import React, { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safelyConvertToDate } from '../utils/datetime';
import type { Appointment, Service, Shop, Staff } from '../utils/firestore';
import type { EarlierSlotNotificationType } from '../utils/types';

export type AppointmentWithDetails = Appointment & {
  service?: Service;
  shop?: Shop;
  staff?: Staff;
  queuePosition?: number;
};

interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
  onCancelClick: (appointmentId: string) => void;
  onAcceptEarlierSlot?: (notificationId: string) => Promise<boolean>;
  notification?: EarlierSlotNotificationType;
  /** vergangene oder stornierte Termine gedämpft und ohne Aktionen */
  past?: boolean;
  /** nur Angebot und Absagen – die Details zeigt schon das Ticket darüber */
  actionsOnly?: boolean;
}

const STATUS_LABEL: Record<Appointment['status'], string> = {
  scheduled: 'Gebucht',
  'in-progress': 'Läuft gerade',
  completed: 'Erledigt',
  cancelled: 'Storniert',
};

/** Ein Termin in „Meine Termine“ */
export const AppointmentCard: React.FC<AppointmentCardProps> = ({ appointment, onCancelClick, onAcceptEarlierSlot, notification, past = false, actionsOnly = false }) => {
  const [accepting, setAccepting] = useState(false);
  const start = safelyConvertToDate(appointment.startTime);
  const end = safelyConvertToDate(appointment.endTime);
  const earlier = notification ? safelyConvertToDate(notification.earlierStartTime) : null;
  const price = appointment.service?.price;

  const accept = async () => {
    if (!notification || !onAcceptEarlierSlot) return;
    setAccepting(true);
    try {
      await onAcceptEarlierSlot(notification.id);
    } catch {
      // Meldung kommt von der Seite
    } finally {
      setAccepting(false);
    }
  };

  return (
    <article
      className={cn(
        'flex flex-col gap-4',
        !actionsOnly && 'rounded-3xl border border-border bg-card p-5',
        past && 'bg-transparent text-muted-foreground',
      )}
    >
      {!actionsOnly && (
        <div className="flex items-start gap-4">
          <div className="flex w-16 shrink-0 flex-col items-center rounded-2xl border border-border py-2 text-center">
            <span className="text-xs font-semibold uppercase">{format(start, 'EEE', { locale: de })}</span>
            <span className="font-mono text-2xl font-bold leading-none">{format(start, 'd')}</span>
            <span className="text-xs">{format(start, 'MMM', { locale: de })}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className={cn('font-display text-lg font-bold', past ? 'text-muted-foreground' : 'text-foreground')}>
                {appointment.service?.name || 'Termin'}
              </h3>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold">{STATUS_LABEL[appointment.status] ?? appointment.status}</span>
            </div>
            <p className="font-mono text-[15px] font-medium">
              {format(start, 'HH:mm')}–{format(end, 'HH:mm')} Uhr
            </p>
            <p className="text-sm text-muted-foreground">
              {[appointment.shop?.name, appointment.staff?.name && `bei ${appointment.staff.name}`, typeof price === 'number' && `${price.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {!past && (appointment.queuePosition ?? 0) > 0 && (
              <p className="mt-1 self-start rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-signal">
                {appointment.queuePosition === 1 ? 'Du bist als Nächstes dran' : `Platz ${appointment.queuePosition} in der Schlange`}
              </p>
            )}
          </div>
        </div>
      )}

      {notification && earlier && !past && (
        <div className="flex flex-col gap-3 rounded-2xl bg-foreground p-4 text-background sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <strong className="block font-display text-base">Früher dran?</strong>
            Frei geworden: <span className="font-mono font-bold text-signal">{format(earlier, "EEE d. MMM, HH:mm", { locale: de })}</span>
          </p>
          <Button variant="signal" size="sm" onClick={accept} disabled={accepting}>
            <ArrowUpRight className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {accepting ? 'Wird übernommen …' : 'Früheren Platz nehmen'}
          </Button>
        </div>
      )}

      {!past && appointment.status === 'scheduled' && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onCancelClick(appointment.id)}>
            Termin absagen
          </Button>
        </div>
      )}
    </article>
  );
};
