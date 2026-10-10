import React from 'react';
import { format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimeSlot } from '../utils/types';
import { Shop, Service, Staff } from '../utils/firestore/types';
import { QueueStepShell } from './queue/QueueStepShell';

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

const dayLabel = (d: Date) => (isToday(d) ? 'Heute' : isTomorrow(d) ? 'Morgen' : format(d, 'EEEE, d. MMMM', { locale: de }));

export const QueueConfirmationStep: React.FC<QueueConfirmationStepProps> = ({
  selectedShop,
  selectedService,
  nextAvailableSlot,
  selectedStaffForSlot,
  searchingForSlot,
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
  const canConfirm = !!nextAvailableSlot && !searchingForSlot && !submitting && (!anonymous || contact.name.trim().length > 0);

  return (
    <QueueStepShell title="Passt das so?" onBack={onBack} backLabel="Andere Person wählen">
      <div className="flex flex-col gap-1 rounded-2xl bg-signal p-5 text-signal-foreground" aria-live="polite">
        <span className="text-xs font-semibold uppercase tracking-[0.08em]">Du bist dran um ca.</span>
        {searchingForSlot ? (
          <span className="font-mono text-4xl font-bold">…</span>
        ) : nextAvailableSlot ? (
          <>
            <span className="font-mono text-5xl font-bold tracking-tight">{format(nextAvailableSlot.start, 'HH:mm')}</span>
            <span className="font-semibold">{dayLabel(nextAvailableSlot.start)}</span>
          </>
        ) : (
          <span className="font-semibold">Gerade ist kein Platz frei. Versuch eine andere Person oder Leistung.</span>
        )}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Shop</dt><dd className="font-semibold">{shop?.name}</dd></div>
        <div><dt className="text-muted-foreground">Leistung</dt><dd className="font-semibold">{service?.name}</dd></div>
        <div><dt className="text-muted-foreground">Bei</dt><dd className="font-semibold">{person?.name ?? (searchingForSlot ? '…' : '–')}</dd></div>
      </dl>

      {anonymous && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">Wie dürfen wir dich aufrufen?</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queue-name">Vorname</Label>
            <Input id="queue-name" autoComplete="given-name" value={contact.name} onChange={(e) => onContactChange({ ...contact, name: e.target.value })} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="queue-phone">Handynummer <span className="font-normal text-muted-foreground">(optional, damit der Laden dich erreicht)</span></Label>
            <Input id="queue-phone" type="tel" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={(e) => onContactChange({ ...contact, phone: e.target.value })} />
          </div>
        </fieldset>
      )}

      {user && (
        <label className="flex items-start gap-3 rounded-2xl border border-border p-4 text-sm">
          <Checkbox checked={checkEarlierOptions} onCheckedChange={(v) => onCheckEarlierOptionsChange(v === true)} className="mt-0.5" />
          <span>
            <strong className="block">Früher dran, wenn etwas frei wird</strong>
            <span className="text-muted-foreground">Wir bieten dir einen früheren Platz an. Deiner bleibt sicher, bis du zusagst.</span>
          </span>
        </label>
      )}

      <Button size="lg" onClick={onConfirm} disabled={!canConfirm}>
        {submitting ? 'Wird eingereiht …' : 'Nummer ziehen'}
      </Button>
    </QueueStepShell>
  );
};
