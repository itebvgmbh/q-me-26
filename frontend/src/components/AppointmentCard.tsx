import React, { useState } from 'react';
import { format } from 'date-fns';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { safelyConvertToDate } from '../utils/datetime';
import { hasFeature } from '../utils/plans';
import { FRUEHER_DRAN_VORLAUF_MINUTEN } from '../utils/frueher-dran';
import type { Appointment, Service, Shop, Staff } from '../utils/firestore';
import type { EarlierSlotNotificationType } from '../utils/types';
import { t, tTeile, merke, datumsLocale, intlSprache } from '@/i18n';

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
  /** „Früher dran“ für diesen Termin ein-/ausschalten; ohne diese Angabe kein Schalter */
  onToggleEarlier?: (appointmentId: string, on: boolean) => Promise<void>;
  notification?: EarlierSlotNotificationType;
  /** vergangene oder stornierte Termine gedämpft, nur mit „Nochmal buchen“ */
  past?: boolean;
  /** nur Angebot und Absagen – die Details zeigt schon das Ticket darüber */
  actionsOnly?: boolean;
}

/**
 * „Nochmal buchen“: Laden, Leistung und Person vom letzten Besuch vorbelegt, nur die Zeit fehlt noch.
 * Ohne Online-Termine im Tarif des Ladens gibt es nur die Nummer (termin = null).
 */
export const nochmalLinks = (appointment: AppointmentWithDetails) => {
  const termin = new URLSearchParams({ shopId: appointment.shopId });
  const nummer = new URLSearchParams({ shopId: appointment.shopId });
  if (appointment.serviceId) {
    termin.set('serviceId', appointment.serviceId);
    nummer.set('serviceId', appointment.serviceId);
  }
  if (appointment.staffId) termin.set('staffId', appointment.staffId);
  return {
    termin: hasFeature(appointment.shop, 'termine') ? `/book-appointment?${termin}` : null,
    nummer: `/public-join-queue?${nummer}`,
  };
};

const STATUS_LABEL: Record<Appointment['status'], string> = {
  scheduled: merke('Gebucht'),
  'in-progress': merke('Du bist dran'),
  completed: merke('Fertig'),
  cancelled: merke('Abgesagt'),
};

/** Ein Termin in „Meine Termine“ */
export const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onCancelClick,
  onAcceptEarlierSlot,
  onToggleEarlier,
  notification,
  past = false,
  actionsOnly = false,
}) => {
  const [accepting, setAccepting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const start = safelyConvertToDate(appointment.startTime);
  const end = safelyConvertToDate(appointment.endTime);
  const earlier = notification ? safelyConvertToDate(notification.earlierStartTime) : null;
  const offerUntil = notification?.expiresAt ? safelyConvertToDate(notification.expiresAt) : null;
  const price = appointment.service?.price;
  // Schalter auch für Termine, die der Laden eingetragen hat (dort fehlt der Haken vom Buchen)
  const earlierOn = appointment.checkEarlierOptions === true;
  const showEarlierSwitch =
    !past &&
    !!onToggleEarlier &&
    appointment.status === 'scheduled' &&
    start.getTime() - Date.now() > FRUEHER_DRAN_VORLAUF_MINUTEN * 60_000 &&
    hasFeature(appointment.shop, 'frueherDran');
  const switchId = `frueher-dran-${appointment.id}`;
  const nochmal = past ? nochmalLinks(appointment) : null;

  const toggleEarlier = async (on: boolean) => {
    if (!onToggleEarlier) return;
    setSwitching(true);
    try {
      await onToggleEarlier(appointment.id, on);
    } catch {
      // Meldung kommt von der Seite
    } finally {
      setSwitching(false);
    }
  };

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
            <span className="text-xs font-semibold uppercase">{format(start, 'EEE', { locale: datumsLocale() })}</span>
            <span className="font-mono text-2xl font-bold leading-none">{format(start, 'd')}</span>
            <span className="text-xs">{format(start, 'MMM', { locale: datumsLocale() })}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className={cn('font-display text-lg font-bold', past ? 'text-muted-foreground' : 'text-foreground')}>
                {appointment.service?.name || t('Termin')}
              </h3>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold">{STATUS_LABEL[appointment.status] ? t(STATUS_LABEL[appointment.status]) : appointment.status}</span>
            </div>
            <p className="font-mono text-[15px] font-medium">
              {t('{von}–{bis} Uhr', { von: format(start, 'HH:mm'), bis: format(end, 'HH:mm') })}
            </p>
            <p className="text-sm text-muted-foreground">
              {[appointment.shop?.name, appointment.staff?.name && t('bei {name}', { name: appointment.staff.name }), typeof price === 'number' && `${price.toLocaleString(intlSprache(), { minimumFractionDigits: 2 })} €`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {!past && (appointment.queuePosition ?? 0) > 0 && (
              <p className="mt-1 self-start rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-signal">
                {appointment.queuePosition === 1 ? t('Du bist als Nächstes dran') : t('Platz {platz} in der Schlange', { platz: appointment.queuePosition ?? 0 })}
              </p>
            )}
          </div>
        </div>
      )}

      {notification && earlier && !past && (
        <div className="flex flex-col gap-3 rounded-2xl bg-foreground p-4 text-background sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <strong className="block font-display text-base">{t('Früher dran?')}</strong>
            {tTeile('Frei geworden: <zeit/>', {
              zeit: () => <span className="font-mono font-bold text-signal">{format(earlier, t('EEE d. MMM, HH:mm'), { locale: datumsLocale() })}</span>,
            })}
            {offerUntil && <span className="block text-background/75">{t('Für dich reserviert bis {zeit} Uhr', { zeit: format(offerUntil, 'HH:mm') })}</span>}
          </p>
          <Button variant="signal" size="sm" onClick={accept} disabled={accepting}>
            <ArrowUpRight className="me-1.5 h-4 w-4" aria-hidden="true" />
            {accepting ? t('Wird übernommen …') : t('Früheren Platz nehmen')}
          </Button>
        </div>
      )}

      {showEarlierSwitch && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-border p-4">
          <label htmlFor={switchId} className="flex cursor-pointer flex-col text-sm">
            <strong className="text-foreground">{t('Früher dran, wenn etwas frei wird')}</strong>
            <span className="text-muted-foreground">
              {earlierOn
                ? t('Ist an. Wird vorher ein Platz frei, bieten wir ihn dir hier an. Dein Termin bleibt sicher, bis du zusagst.')
                : t('Wir bieten dir einen früheren Platz an, wenn einer frei wird. Dein Termin bleibt sicher, bis du zusagst.')}
            </span>
          </label>
          <Switch id={switchId} checked={earlierOn} disabled={switching} onCheckedChange={toggleEarlier} className="mt-0.5" />
        </div>
      )}

      {!past && appointment.status === 'scheduled' && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/nummer/${appointment.id}`}>{t('Live ansehen und Bescheid bekommen')}</Link>
          </Button>
          {/* Verschieben statt absagen und neu buchen – auf der Nummernseite (components/PlatzAendern.tsx) */}
          {hasFeature(appointment.shop, 'termine') && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/nummer/${appointment.id}?aendern=1`}>{t('Platz ändern')}</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onCancelClick(appointment.id)}>
            {t('Termin absagen')}
          </Button>
        </div>
      )}

      {nochmal && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link to={nochmal.termin ?? nochmal.nummer}>{t('Nochmal buchen')}</Link>
          </Button>
        </div>
      )}
    </article>
  );
};
