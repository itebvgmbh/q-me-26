import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Check, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { CustomerCalendar } from './CustomerCalendar';
import { Staff, Service, Shop } from '../utils/firestore';
import { CalendarTimeSlot } from '../utils/types';

interface BookingFormProps {
  shops: Shop[];
  services: Service[];
  staff: Staff[];
  selectedShop: string;
  selectedStaff: string;
  selectedService: string;
  selectedTimeSlot: CalendarTimeSlot | null;
  refreshTimestamp: number;
  checkEarlierOptions: boolean;
  isLoggedIn: boolean;
  submitting: boolean;
  loginHref: string;
  onShopChange: (shop: string) => void;
  onStaffChange: (staff: string) => void;
  onServiceChange: (service: string) => void;
  onTimeSlotSelect: (timeSlot: CalendarTimeSlot) => void;
  onCheckEarlierOptionsChange: (checked: boolean) => void;
  onBookAppointment: () => void;
}

const Step = ({ nr, title, done, children }: { nr: number; title: string; done?: boolean; children: ReactNode }) => (
  <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby={`schritt-${nr}`}>
    <h2 id={`schritt-${nr}`} className="flex items-center gap-3 font-display text-xl font-bold">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm',
          done ? 'bg-foreground text-signal' : 'border-2 border-foreground',
        )}
        aria-hidden="true"
      >
        {done ? <Check className="h-4 w-4" /> : nr}
      </span>
      {title}
    </h2>
    {children}
  </section>
);

const Choice = ({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      'flex min-h-11 flex-col items-start justify-center rounded-2xl border px-4 py-2.5 text-left transition-colors',
      selected ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:border-foreground',
      className,
    )}
  >
    {children}
  </button>
);

const shopAddress = (shop: Shop) =>
  [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address || '';

/** Terminbuchung in einem Durchgang: Shop → Leistung → Mitarbeiter → Zeit → Bestätigen */
export function BookingForm({
  shops,
  services,
  staff,
  selectedShop,
  selectedStaff,
  selectedService,
  selectedTimeSlot,
  refreshTimestamp,
  checkEarlierOptions,
  isLoggedIn,
  submitting,
  loginHref,
  onShopChange,
  onStaffChange,
  onServiceChange,
  onTimeSlotSelect,
  onCheckEarlierOptionsChange,
  onBookAppointment,
}: BookingFormProps) {
  const shop = shops.find((s) => s.id === selectedShop);
  const service = services.find((s) => s.id === selectedService);
  const person = staff.find((s) => s.id === selectedStaff);

  return (
    <div className="flex flex-col gap-4">
      <Step nr={1} title="Wo?" done={!!shop}>
        {shop ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{shop.name}</p>
              {shopAddress(shop) && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {shopAddress(shop)}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onShopChange('')}>Anderen Shop wählen</Button>
          </div>
        ) : shops.length === 0 ? (
          <p className="text-muted-foreground">Noch keine Shops eingetragen.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {shops.map((s) => (
              <Choice key={s.id} selected={false} onClick={() => onShopChange(s.id)}>
                <span className="font-semibold">{s.name}</span>
                {shopAddress(s) && <span className="text-sm text-muted-foreground">{shopAddress(s)}</span>}
              </Choice>
            ))}
          </div>
        )}
      </Step>

      {shop && (
        <Step nr={2} title="Was?" done={!!service}>
          {services.length === 0 ? (
            <p className="text-muted-foreground">Dieser Shop hat noch keine Leistungen eingetragen.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <Choice key={s.id} selected={s.id === selectedService} onClick={() => onServiceChange(s.id)}>
                  <span className="font-semibold">{s.name}</span>
                  <span className={cn('text-sm', s.id === selectedService ? 'text-background/75' : 'text-muted-foreground')}>
                    {[s.duration && `${s.duration} Min`, typeof s.price === 'number' && `${s.price.toLocaleString('de-DE')} €`].filter(Boolean).join(' · ')}
                  </span>
                </Choice>
              ))}
            </div>
          )}
        </Step>
      )}

      {shop && service && (
        <Step nr={3} title="Bei wem?" done={!!person}>
          {staff.length === 0 ? (
            <p className="text-muted-foreground">Für diesen Shop ist noch niemand eingetragen.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staff.map((s) => (
                <Choice key={s.id} selected={s.id === selectedStaff} onClick={() => onStaffChange(s.id)} className="rounded-full">
                  <span className="font-semibold">{s.name}</span>
                </Choice>
              ))}
            </div>
          )}
        </Step>
      )}

      {shop && service && person && (
        <Step nr={4} title="Wann?" done={!!selectedTimeSlot}>
          <CustomerCalendar
            shopId={selectedShop}
            serviceId={selectedService}
            staffId={selectedStaff}
            selectedSlot={selectedTimeSlot}
            forceRefresh={!!refreshTimestamp}
            onTimeSlotSelect={onTimeSlotSelect}
          />
        </Step>
      )}

      {shop && service && person && selectedTimeSlot && (
        <section className="sticky bottom-3 z-10 flex flex-col gap-4 rounded-3xl bg-foreground p-5 text-background shadow-xl sm:p-6" aria-label="Zusammenfassung">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-2xl font-bold">
              {format(selectedTimeSlot.start, "EEE d. MMM 'um' HH:mm", { locale: de })}
            </p>
            <p className="text-sm text-background/75">
              {service.name} · {person.name} · {shop.name}
            </p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={checkEarlierOptions}
              onCheckedChange={(v) => onCheckEarlierOptionsChange(v === true)}
              className="mt-0.5 border-background data-[state=checked]:bg-signal data-[state=checked]:text-signal-foreground"
            />
            <span>
              <strong className="block">Früher dran, wenn etwas frei wird</strong>
              <span className="text-background/75">Wir bieten dir einen früheren Platz an. Dein Termin bleibt sicher, bis du zusagst.</span>
            </span>
          </label>
          {isLoggedIn ? (
            <Button variant="signal" size="lg" onClick={onBookAppointment} disabled={submitting}>
              {submitting ? 'Wird gebucht …' : 'Termin verbindlich buchen'}
            </Button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="signal" size="lg" className="sm:flex-1" asChild>
                <Link to={loginHref}>Anmelden und buchen</Link>
              </Button>
              <Button variant="outline" size="lg" className="border-background/50 sm:flex-1 text-background hover:bg-background hover:text-foreground" asChild>
                <Link to={`/public-join-queue?shopId=${selectedShop}&serviceId=${selectedService}`}>Ohne Konto einreihen</Link>
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
