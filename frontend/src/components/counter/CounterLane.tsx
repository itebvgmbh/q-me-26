import { useState } from 'react';
import { format } from 'date-fns';
import { Check, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safelyConvertToDate } from '../../utils/datetime';
import { Appointment, Service, updateAppointment } from '../../utils/firestore';

export const customerLabel = (a: Appointment) => {
  const name = a.customerName && a.customerName !== 'Unbekannter Kunde' ? a.customerName : 'Gast';
  return a.isAnonymous && a.referenceCode ? `${name} · Nr. ${a.referenceCode}` : name;
};

interface Props {
  title: string;
  appointments: Appointment[];
  services: Service[];
  now: Date;
  /** nur am heutigen Tag kann aufgerufen werden */
  live: boolean;
}

/** Eine Spur am Tresen: wer gerade dran ist, wer als Nächstes kommt */
export const CounterLane = ({ title, appointments, services, now, live }: Props) => {
  const [busy, setBusy] = useState(false);
  const sorted = [...appointments].sort((a, b) => safelyConvertToDate(a.startTime).getTime() - safelyConvertToDate(b.startTime).getTime());
  const current = sorted.find((a) => a.status === 'in-progress');
  const waiting = sorted.filter((a) => a.status === 'scheduled' && safelyConvertToDate(a.endTime) > now);
  const done = sorted.filter((a) => a.status === 'completed').length;
  const next = waiting[0];
  const serviceName = (a: Appointment) => services.find((s) => s.id === a.serviceId)?.name || 'Leistung';

  // Laufenden Kunden abschließen und den nächsten aufrufen – der Live-Listener aktualisiert die Ansicht
  const callNext = async () => {
    setBusy(true);
    try {
      if (current) await updateAppointment(current.id, { status: 'completed' });
      if (next) {
        await updateAppointment(next.id, { status: 'in-progress' });
        toast.success(`${customerLabel(next)} ist dran.`);
      } else {
        toast.success('Fertig. Gerade wartet niemand.');
      }
    } catch (error) {
      console.error('Error calling next customer:', error);
      toast.error('Das hat nicht geklappt. Versuch es noch einmal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5" aria-label={`Spur ${title}`}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {waiting.length} wartet · {done} fertig
        </p>
      </header>

      <div className={cn('flex flex-col gap-1 rounded-2xl p-4', current ? 'bg-signal text-signal-foreground' : 'border border-dashed border-border')}>
        <p className="text-xs font-semibold uppercase tracking-[0.08em]">Jetzt dran</p>
        {current ? (
          <>
            <p className="font-display text-2xl font-bold">{customerLabel(current)}</p>
            <p className="text-sm">
              {serviceName(current)} · {safelyConvertToDate(current.startTime) > now ? 'geplant' : 'seit'}{' '}
              <span className="font-mono">{format(safelyConvertToDate(current.startTime), 'HH:mm')}</span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Niemand. {next ? 'Ruf die nächste Nummer auf.' : ''}</p>
        )}
      </div>

      {live && (current || next) && (
        <Button size="lg" onClick={callNext} disabled={busy}>
          {next ? <Megaphone className="mr-2 h-4 w-4" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
          {busy ? 'Moment …' : next ? (current ? 'Fertig – nächste Nummer' : 'Nächste Nummer aufrufen') : 'Fertig'}
        </Button>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Als Nächstes</p>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keiner mehr in der Schlange.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {waiting.slice(0, 6).map((a, i) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <span className="w-12 shrink-0 font-mono text-[15px] font-semibold">{format(safelyConvertToDate(a.startTime), 'HH:mm')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{customerLabel(a)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {serviceName(a)} · {a.type === 'queue' ? 'Schlange' : 'Termin'}
                  </span>
                </span>
                {i === 0 && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-signal">Nächste</span>}
              </li>
            ))}
            {waiting.length > 6 && <li className="py-2 text-sm text-muted-foreground">+ {waiting.length - 6} weitere</li>}
          </ol>
        )}
      </div>
    </section>
  );
};
