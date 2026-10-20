import { useEffect, useMemo, useState } from 'react';
import { addMinutes, format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AvailableTimeSlotPicker } from './AvailableTimeSlotPicker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Service, Staff, Customer, Appointment, appointmentCustomerId, offeredServices } from '../utils/firestore';
import { findEarliestSlots } from '../utils/firestore/timeslots';

interface CreateAppointmentFormProps {
  services: Service[];
  staff: Staff[];
  customers: Customer[];
  shopId: string;
  onCreateAppointment: (appointment: Appointment) => void;
  onCancel: () => void;
  appointmentType: 'booked' | 'queue';
  setAppointmentType: (type: 'booked' | 'queue') => void;
  createAppointment: (appointmentData: any) => Promise<Appointment>;
}

type Slot = { start: Date; end: Date };

const when = (d: Date) => {
  const time = format(d, 'HH:mm');
  if (isToday(d)) return `heute um ${time}`;
  if (isTomorrow(d)) return `morgen um ${time}`;
  return `${format(d, 'EEEE, d. MMMM', { locale: de })} um ${time}`;
};

/**
 * Tresen: Nummer vergeben (nächster freier Platz, wie beim QR-Code) oder Termin mit fester Uhrzeit.
 * Für die Nummer reichen Leistung und – wenn gewünscht – Person und Name; Uhrzeit, Dauer und Preis
 * ergeben sich daraus. Vorher fragte auch die Nummer nach Datum, Uhrzeit, Dauer und Preis.
 */
export const CreateAppointmentForm = ({
  services,
  staff,
  customers,
  shopId,
  onCreateAppointment,
  onCancel,
  appointmentType,
  setAppointmentType,
  createAppointment,
}: CreateAppointmentFormProps) => {
  const active = useMemo(() => staff.filter((s) => s.isActive !== false), [staff]);
  const offered = useMemo(() => offeredServices(services), [services]);
  const [serviceId, setServiceId] = useState(offered.length === 1 ? offered[0].id : '');
  const [staffId, setStaffId] = useState<string>('any');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [saving, setSaving] = useState(false);
  // Termin mit fester Uhrzeit
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);
  // Nummer: frühester Platz je Person
  const [slots, setSlots] = useState<Record<string, Slot | null> | null>(null);
  const [searching, setSearching] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // Vergebene Nummer: bleibt stehen, bis der Kunde sie kennt (er hat keine Nummernseite)
  const [issued, setIssued] = useState<{ appointment: Appointment; person: string } | null>(null);

  const service = services.find((s) => s.id === serviceId);
  const eligible = useMemo(
    () => active.filter((s) => !serviceId || !Array.isArray(s.serviceIds) || s.serviceIds.length === 0 || s.serviceIds.includes(serviceId)),
    [active, serviceId],
  );

  useEffect(() => {
    if (service) {
      setDuration(service.duration);
      setPrice(service.price);
    }
    if (staffId !== 'any' && !eligible.some((s) => s.id === staffId)) setStaffId('any');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  useEffect(() => {
    if (appointmentType !== 'queue' || !serviceId || eligible.length === 0) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    findEarliestSlots(shopId, serviceId, eligible.map((s) => s.id))
      .then((result) => !cancelled && setSlots(result))
      .catch(() => !cancelled && setSlots({}))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [appointmentType, shopId, serviceId, eligible, refresh]);

  // Nächster Platz: bei "egal wer" der früheste über alle
  const pick = useMemo(() => {
    if (!slots) return null;
    const candidates = (staffId === 'any' ? eligible : eligible.filter((s) => s.id === staffId))
      .map((s) => ({ person: s, slot: slots[s.id] }))
      .filter((c): c is { person: Staff; slot: Slot } => Boolean(c.slot))
      .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());
    return candidates[0] ?? null;
  }, [slots, staffId, eligible]);

  const save = async (data: Record<string, unknown>, label: (created: Appointment) => string, keepOpen?: (created: Appointment) => void) => {
    setSaving(true);
    try {
      const created = await createAppointment(data);
      toast.success(label(created));
      if (keepOpen) keepOpen(created);
      else onCreateAppointment(created);
    } catch (error: any) {
      console.error('Error creating appointment:', error);
      toast.error(`${appointmentType === 'booked' ? 'Termin' : 'Nummer'} nicht angelegt: ${error?.message || 'unbekannter Fehler'}`);
      setRefresh((n) => n + 1); // Platz vermutlich gerade weg – neu suchen
    } finally {
      setSaving(false);
    }
  };

  const submitQueue = () => {
    if (!service || !pick) return;
    save(
      {
        shopId,
        customerId: 'walk-in',
        customerName: customerName.trim() || 'Laufkundschaft',
        serviceId,
        staffId: pick.person.id,
        startTime: pick.slot.start,
        endTime: pick.slot.end,
        price: service.price,
        status: 'scheduled',
        type: 'queue',
      },
      (created) => `Nummer ${created.referenceCode ? `${created.referenceCode} ` : ''}vergeben: ${format(pick.slot.start, 'HH:mm')} bei ${pick.person.name}.`,
      (created) => setIssued({ appointment: created, person: pick.person.name }),
    );
  };

  const submitBooked = () => {
    if (!serviceId || staffId === 'any' || !time) return toast.error('Wähl Leistung, Person und Uhrzeit.');
    const [h, m] = time.split(':').map(Number);
    const start = new Date(`${date}T00:00:00`);
    start.setHours(h, m, 0, 0);
    save(
      {
        shopId,
        customerId: customerId || 'walk-in',
        customerName: customerName.trim(),
        serviceId,
        staffId,
        startTime: start,
        endTime: addMinutes(start, duration),
        price,
        status: 'scheduled',
        type: 'booked',
      },
      () => `Termin eingetragen: ${format(start, 'dd.MM.')} um ${time}.`,
    );
  };

  const customerOptions = useMemo(() => {
    // Wert = customerId des Termins: bei verbundenem Konto das Konto (utils/firestore/customers.ts)
    const seen = new Map<string, Customer>();
    customers.forEach((c) => !seen.has(appointmentCustomerId(c)) && seen.set(appointmentCustomerId(c), c));
    return [...seen.values()];
  }, [customers]);

  if (issued) {
    const start = issued.appointment.startTime instanceof Date ? issued.appointment.startTime : issued.appointment.startTime.toDate();
    return (
      <div className="flex flex-col gap-4 py-2" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-1 rounded-3xl bg-signal p-6 text-center text-signal-foreground">
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">Nummer</p>
          <p className="font-mono text-6xl font-bold leading-none tracking-[-0.04em]">{issued.appointment.referenceCode ?? '—'}</p>
          <p className="mt-2 font-display text-xl font-bold">{when(start)}</p>
          <p className="text-sm">bei {issued.person}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Sag dem Kunden seine Nummer und die Uhrzeit, am besten auf einen Zettel. Am Tresen und auf dem Wartezimmer-Bildschirm steht er unter dieser Nummer.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setIssued(null);
              setCustomerName('');
              setRefresh((n) => n + 1);
            }}
          >
            Noch eine Nummer
          </Button>
          <Button variant="signal" onClick={() => onCreateAppointment(issued.appointment)}>
            Fertig
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Art">
        {(['queue', 'booked'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={appointmentType === t}
            onClick={() => setAppointmentType(t)}
            className={cn(
              'min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors',
              appointmentType === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'queue' ? 'Nummer (nächster Platz)' : 'Feste Uhrzeit'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="serviceId">Leistung</Label>
        <Select value={serviceId} onValueChange={setServiceId}>
          <SelectTrigger id="serviceId">
            <SelectValue placeholder="Leistung wählen" />
          </SelectTrigger>
          <SelectContent>
            {offered.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {s.duration} Min.
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="staffId">Bei wem?</Label>
        <Select value={staffId} onValueChange={setStaffId}>
          <SelectTrigger id="staffId">
            <SelectValue placeholder="Person wählen" />
          </SelectTrigger>
          <SelectContent>
            {appointmentType === 'queue' && <SelectItem value="any">Egal wer – wer zuerst frei ist</SelectItem>}
            {eligible.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customerName">{appointmentType === 'queue' ? 'Name zum Aufrufen (freiwillig)' : 'Name'}</Label>
        <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="z. B. Herr Krause" autoComplete="off" />
      </div>

      {appointmentType === 'queue' ? (
        <div className="rounded-2xl border border-border bg-background p-4" role="status" aria-live="polite">
          {!serviceId ? (
            <p className="text-sm text-muted-foreground">Wähl eine Leistung, dann siehst du den nächsten freien Platz.</p>
          ) : eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Für diese Leistung ist niemand im Team eingetragen.</p>
          ) : searching ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Suche den nächsten freien Platz …
            </p>
          ) : pick ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Dran</p>
              <p className="font-display text-2xl font-bold">{when(pick.slot.start)}</p>
              <p className="text-sm text-muted-foreground">bei {pick.person.name}</p>
              {!isToday(pick.slot.start) && <p className="mt-2 text-sm">Heute ist nichts mehr frei.</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">In den nächsten 14 Tagen ist nichts frei.</p>
          )}
        </div>
      ) : (
        <>
          {customerOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="customerId">Bestandskunde (freiwillig)</Label>
              <Select
                value={customerId}
                onValueChange={(value) => {
                  setCustomerId(value);
                  const c = customerOptions.find((x) => appointmentCustomerId(x) === value);
                  if (c && !customerName.trim()) setCustomerName(c.name);
                }}
              >
                <SelectTrigger id="customerId">
                  <SelectValue placeholder="Kunde wählen" />
                </SelectTrigger>
                <SelectContent>
                  {customerOptions.map((c) => (
                    <SelectItem key={c.id} value={appointmentCustomerId(c)}>
                      {c.name} {c.email ? `(${c.email})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="date">Datum</Label>
              <Input id="date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="time">Uhrzeit</Label>
              {serviceId && staffId !== 'any' ? (
                <AvailableTimeSlotPicker shopId={shopId} serviceId={serviceId} staffId={staffId} date={date} value={time} onChange={setTime} />
              ) : (
                <>
                  <Input id="time" type="time" value={time} disabled />
                  <p className="text-xs text-muted-foreground">Wähl zuerst Leistung und Person.</p>
                </>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration">Dauer (Minuten)</Label>
              <Input id="duration" type="number" min="5" step="5" value={duration} onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 0))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="price">Preis (€)</Label>
              <Input id="price" type="number" min="0" step="0.5" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Abbrechen
        </Button>
        {appointmentType === 'queue' ? (
          <Button variant="signal" onClick={submitQueue} disabled={saving || !pick}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Nummer vergeben
          </Button>
        ) : (
          <Button variant="signal" onClick={submitBooked} disabled={saving || !serviceId || staffId === 'any' || !time}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Termin eintragen
          </Button>
        )}
      </div>
    </div>
  );
};
