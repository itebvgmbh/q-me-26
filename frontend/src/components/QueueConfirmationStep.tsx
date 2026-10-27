import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimeSlot } from '../utils/types';
import { Shop, Service, Staff } from '../utils/firestore/types';
import { QueueStepShell } from './queue/QueueStepShell';
import { slotDayLabel } from './queue/SlotStatus';
import { hasFeature } from '../utils/plans';
import { useMonthlyUsage } from '../utils/plan-usage';
import { caFenster } from '../utils/ca-zeit';
import { t, tTeile } from '@/i18n';

export interface QueueContact {
  name: string;
  phone: string;
}

export interface QueueConfirmationStepProps {
  selectedShop: string;
  selectedService: string;
  useAnyStaff: boolean;
  selectedStaff: string;
  nextAvailableSlot: TimeSlot | null;
  selectedStaffForSlot: string;
  searchingForSlot: boolean;
  /** Suche ist fehlgeschlagen (Netz) – nicht mit "kein Platz frei" verwechseln */
  searchFailed?: boolean;
  onRetrySearch?: () => void;
  checkEarlierOptions: boolean;
  onCheckEarlierOptionsChange: (checked: boolean) => void;
  shops: Shop[];
  services: Service[];
  staff: Staff[];
  onBack: () => void;
  onConfirm: () => void;
  user: User | null;
  authLoading: boolean;
  contact: QueueContact;
  onContactChange: (contact: QueueContact) => void;
  submitting?: boolean;
}

export const QueueConfirmationStep: React.FC<QueueConfirmationStepProps> = ({
  selectedShop,
  selectedService,
  nextAvailableSlot,
  selectedStaffForSlot,
  searchingForSlot,
  searchFailed = false,
  onRetrySearch,
  checkEarlierOptions,
  onCheckEarlierOptionsChange,
  shops,
  services,
  staff,
  onBack,
  onConfirm,
  user,
  authLoading,
  contact,
  onContactChange,
  submitting = false,
}) => {
  const shop = shops.find((s) => s.id === selectedShop);
  const service = services.find((s) => s.id === selectedService);
  const person = staff.find((s) => s.id === selectedStaffForSlot);
  const anonymous = !user && !authLoading;
  // Tarif des Ladens: "Früher dran" ab Solo, im Gratis-Tarif höchstens 100 Kunden im Monat (utils/plans.ts)
  const earlierAllowed = hasFeature(shop, 'frueherDran');
  const usage = useMonthlyUsage(shop?.id, shop);
  const canConfirm =
    !!nextAvailableSlot && !searchingForSlot && !submitting && !usage.full && (!anonymous || contact.name.trim().length > 0);

  return (
    <QueueStepShell title={t('Passt das so?')} onBack={onBack} backLabel={t('Andere Person wählen')}>
      <div className="flex flex-col gap-1 rounded-2xl bg-signal p-5 text-signal-foreground" aria-live="polite">
        <span className="text-xs font-semibold uppercase tracking-[0.08em]">{t('Du bist dran um ca.')}</span>
        {searchingForSlot ? (
          <>
            <span className="animate-pulse font-mono text-5xl font-bold tracking-tight opacity-50" aria-hidden="true">--:--</span>
            <span className="font-semibold">{t('Wir suchen deinen Platz …')}</span>
            <span className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-signal-foreground/15" aria-hidden="true">
              <span className="absolute inset-y-0 start-0 w-1/3 animate-scan rounded-full bg-signal-foreground" />
            </span>
          </>
        ) : nextAvailableSlot ? (
          <>
            <span className="font-mono text-5xl font-bold tracking-tight">{format(nextAvailableSlot.start, 'HH:mm')}</span>
            <span className="font-semibold">{slotDayLabel(nextAvailableSlot.start)}</span>
            <span className="text-sm">{t('Rechne mit {von} bis {bis} Uhr.', caFenster(nextAvailableSlot.start))}</span>
          </>
        ) : searchFailed ? (
          <span className="flex flex-col items-start gap-3 font-semibold">
            {t('Die freien Plätze konnten nicht geladen werden.')}
            {onRetrySearch && (
              <Button size="sm" onClick={onRetrySearch}>
                {t('Noch mal suchen')}
              </Button>
            )}
          </span>
        ) : (
          <span className="font-semibold">{t('Gerade ist kein Platz frei. Versuch eine andere Person oder Leistung.')}</span>
        )}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">{t('Laden')}</dt><dd className="font-semibold">{shop?.name}</dd></div>
        <div><dt className="text-muted-foreground">{t('Leistung')}</dt><dd className="font-semibold">{service?.name}</dd></div>
        <div><dt className="text-muted-foreground">{t('Bei')}</dt><dd className="font-semibold">{person?.name ?? (searchingForSlot ? '…' : '–')}</dd></div>
      </dl>

      {anonymous && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">{t('Wie dürfen wir dich aufrufen?')}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queue-name">{t('Vorname')}</Label>
            <Input id="queue-name" autoComplete="given-name" value={contact.name} onChange={(e) => onContactChange({ ...contact, name: e.target.value })} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queue-phone">
              {tTeile('Handynummer <hinweis>(optional, damit der Laden dich erreicht)</hinweis>', {
                hinweis: (inhalt) => <span className="font-normal text-muted-foreground">{inhalt}</span>,
              })}
            </Label>
            <Input id="queue-phone" type="tel" dir="ltr" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={(e) => onContactChange({ ...contact, phone: e.target.value })} />
          </div>
        </fieldset>
      )}

      {/* Ohne Konto: zeigen, dass es „Früher dran“ gibt – angeboten wird es dem Konto (Meine Termine, Push) */}
      {anonymous && earlierAllowed && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4 text-sm">
          <span>
            <strong className="block">{t('Früher dran, wenn etwas frei wird')}</strong>
            <span className="text-muted-foreground">
              {t(
                'Wird vorher ein Platz frei, bieten wir ihn dir an. Dafür brauchst du ein Konto – ohne Konto ziehst du deine Nummer wie gewohnt.',
              )}
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/login" state={{ redirectAfterLogin: `${window.location.pathname}${window.location.search}` }}>
                {t('Anmelden')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/register-customer" state={{ redirectAfterLogin: `${window.location.pathname}${window.location.search}` }}>
                {t('Konto anlegen')}
              </Link>
            </Button>
          </div>
        </div>
      )}

      {user && earlierAllowed && (
        <label className="flex items-start gap-3 rounded-2xl border border-border p-4 text-sm">
          <Checkbox checked={checkEarlierOptions} onCheckedChange={(v) => onCheckEarlierOptionsChange(v === true)} className="mt-0.5" />
          <span>
            <strong className="block">{t('Früher dran, wenn etwas frei wird')}</strong>
            <span className="text-muted-foreground">{t('Wir bieten dir einen früheren Platz an. Deiner bleibt sicher, bis du zusagst.')}</span>
          </span>
        </label>
      )}

      {usage.full ? (
        <p role="status" className="rounded-2xl border border-border p-4 font-semibold">
          {shop?.name
            ? t('Online sind bei {laden} gerade keine Nummern mehr frei. Frag bitte direkt im Laden.', { laden: shop.name })
            : t('Online sind bei diesem Laden gerade keine Nummern mehr frei. Frag bitte direkt im Laden.')}
        </p>
      ) : (
        <Button size="lg" onClick={onConfirm} disabled={!canConfirm}>
          {submitting ? t('Wird eingereiht …') : t('Nummer ziehen')}
        </Button>
      )}
    </QueueStepShell>
  );
};
