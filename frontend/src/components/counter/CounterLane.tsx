import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Check, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safelyConvertToDate } from '../../utils/datetime';
import { Appointment, Service, updateAppointment } from '../../utils/firestore';
import { delayMinutes, expectedStart, isDue, projectLane, SHOW_DELAY_MINUTES, waitingInOrder } from '../../utils/queue-lane';

const PLACEHOLDER_NAMES = ['Unbekannter Kunde', 'Laufkundschaft', 'Gast'];

/**
 * Name und Nummer, wie am Tresen gerufen wird – die Nummer steht immer dabei, auch bei Nummern vom Tresen
 * (vorher nur bei Buchungen ohne Konto; wer am Tresen eine Nummer bekam, kannte sie nicht).
 */
export const customerLabel = (a: Appointment) => {
  const raw = a.customerName?.trim() ?? '';
  if (a.referenceCode) {
    const name = raw && !PLACEHOLDER_NAMES.includes(raw) ? raw : '';
    return name ? `${name} · Nr. ${a.referenceCode}` : `Nr. ${a.referenceCode}`;
  }
  return raw && raw !== 'Unbekannter Kunde' ? raw : 'Gast';
};

interface Props {
  title: string;
  appointments: Appointment[];
  services: Service[];
  now: Date;
  /** nur am heutigen Tag kann aufgerufen werden */
  live: boolean;
}

type Ask = { kind: 'early' } | { kind: 'noShow' } | null;

/**
 * Eine Schlange am Tresen (je Person): wer gerade dran ist, wer als Nächstes kommt.
 * Wer wartet, bleibt hier, bis er aufgerufen oder abgesagt wird – auch wenn seine geplante Zeit vorbei ist
 * (utils/queue-lane.ts). Aufgerufen wird ohne Rückfrage nur, wer fällig ist; ein Termin am Nachmittag nicht.
 */
export const CounterLane = ({ title, appointments, services, now, live }: Props) => {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const nowMs = now.getTime();
  const current = appointments.find((a) => a.status === 'in-progress');
  const waiting = useMemo(() => waitingInOrder(appointments), [appointments]);
  const projection = useMemo(() => projectLane(appointments, nowMs), [appointments, nowMs]);
  const done = appointments.filter((a) => a.status === 'completed').length;
  const next = waiting[0];
  const nextDue = Boolean(next && isDue(next, nowMs));
  const delay = live && next ? delayMinutes(next, projection) : 0;
  const serviceName = (a: Appointment) => services.find((s) => s.id === a.serviceId)?.name || 'Leistung';
  const at = (a: Appointment) => format(safelyConvertToDate(a.startTime), 'HH:mm');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setAsk(null);
    try {
      await work();
    } catch (error) {
      console.error('Error at the counter:', error);
      toast.error('Das hat nicht geklappt. Versuch es noch einmal.');
    } finally {
      setBusy(false);
    }
  };

  // Laufenden Kunden abschließen und den nächsten aufrufen – der Live-Listener aktualisiert die Ansicht
  const finishAndCall = (callNext: boolean) =>
    run(async () => {
      if (current) await updateAppointment(current.id, { status: 'completed' });
      if (callNext && next) {
        await updateAppointment(next.id, { status: 'in-progress' });
        toast.success(`${customerLabel(next)} ist dran.`);
      } else {
        toast.success(waiting.length === 0 ? 'Fertig. Gerade wartet niemand.' : 'Fertig.');
      }
    });

  const noShow = () =>
    run(async () => {
      if (!current) return;
      await updateAppointment(current.id, { status: 'cancelled', noShow: true }, { notifyCustomer: true });
      toast.success(`${customerLabel(current)} ist abgesagt.`);
    });

  const primary = () => {
    if (next && nextDue) return finishAndCall(true);
    if (current) return finishAndCall(false);
    if (next) setAsk({ kind: 'early' });
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5" aria-label={`Schlange von ${title}`}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <p className="text-right text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {waiting.length} wartet · {done} fertig
          {delay >= SHOW_DELAY_MINUTES && <span className="block normal-case tracking-normal">ca. {delay} Min. Verzug</span>}
        </p>
      </header>

      <div className={cn('flex flex-col gap-1 rounded-2xl p-4', current ? 'bg-signal text-signal-foreground' : 'border border-dashed border-border')}>
        <p className="text-xs font-semibold uppercase tracking-[0.08em]">Jetzt dran</p>
        {current ? (
          <>
            <p className="font-display text-2xl font-bold">{customerLabel(current)}</p>
            <p className="text-sm">
              {serviceName(current)} · seit{' '}
              <span className="font-mono">{format(safelyConvertToDate(current.lastCalledAt ?? current.calledAt ?? current.startTime), 'HH:mm')}</span>
            </p>
            {live && ask?.kind !== 'noShow' && (
              <button
                type="button"
                className="mt-1 self-start text-sm font-semibold underline underline-offset-2"
                onClick={() => setAsk({ kind: 'noShow' })}
                disabled={busy}
              >
                Nicht gekommen
              </button>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            {next ? (nextDue ? 'Niemand. Ruf die nächste Nummer auf.' : `Niemand. Als Nächstes ${customerLabel(next)} um ${at(next)}.`) : appointments.length === 0 ? 'Noch niemand da.' : 'Niemand.'}
          </p>
        )}
      </div>

      {ask?.kind === 'noShow' && current && (
        <Confirm
          text={`${customerLabel(current)} absagen? Der Kunde bekommt Bescheid, sein Platz wird frei.`}
          confirmLabel="Ja, absagen"
          onConfirm={noShow}
          onCancel={() => setAsk(null)}
          busy={busy}
        />
      )}

      {live && (current || next) && ask?.kind !== 'early' && (
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={primary} disabled={busy}>
            {next && (nextDue || !current) ? <Megaphone className="mr-2 h-4 w-4" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
            {busy ? 'Moment …' : next && nextDue ? (current ? 'Fertig – nächste Nummer' : 'Nächste Nummer aufrufen') : current ? 'Fertig' : 'Nächste Nummer aufrufen'}
          </Button>
          {current && next && !nextDue && (
            <p className="text-sm text-muted-foreground">
              Als Nächstes erst um {at(next)}: {customerLabel(next)}.{' '}
              <button type="button" className="font-semibold text-foreground underline underline-offset-2" onClick={() => setAsk({ kind: 'early' })} disabled={busy}>
                Schon jetzt aufrufen
              </button>
            </p>
          )}
        </div>
      )}

      {ask?.kind === 'early' && next && (
        <Confirm
          text={`${customerLabel(next)} ist erst um ${at(next)} eingeplant und vielleicht noch nicht da. Jetzt schon aufrufen?`}
          confirmLabel={current ? 'Ja, fertig und aufrufen' : 'Ja, jetzt aufrufen'}
          onConfirm={() => finishAndCall(true)}
          onCancel={() => setAsk(null)}
          busy={busy}
        />
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Als Nächstes</p>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {appointments.length === 0 && live
              ? 'Kunden ziehen ihre Nummer über den QR-Code. Steht jemand ohne Handy vor dir, tipp oben auf „Nummer vergeben“.'
              : 'Keiner mehr in der Schlange.'}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {waiting.slice(0, 6).map((a, i) => {
              const late = live ? delayMinutes(a, projection) : 0;
              return (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="w-12 shrink-0 font-mono text-[15px] font-semibold">{at(a)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{customerLabel(a)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {serviceName(a)} · {a.type === 'queue' ? 'Nummer' : 'Termin'}
                      {late >= SHOW_DELAY_MINUTES && ` · ca. ${format(expectedStart(a, projection), 'HH:mm')}`}
                    </span>
                  </span>
                  {i === 0 && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-signal">Nächste</span>}
                </li>
              );
            })}
            {waiting.length > 6 && <li className="py-2 text-sm text-muted-foreground">+ {waiting.length - 6} weitere</li>}
          </ol>
        )}
      </div>
    </section>
  );
};

const Confirm = ({ text, confirmLabel, onConfirm, onCancel, busy }: { text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) => (
  <div className="flex flex-col gap-2 rounded-2xl border border-border p-3" role="alertdialog" aria-label={text}>
    <p className="text-sm font-semibold">{text}</p>
    <div className="flex gap-2">
      <Button className="flex-1" onClick={onConfirm} disabled={busy}>
        {confirmLabel}
      </Button>
      <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
        Abbrechen
      </Button>
    </div>
  </div>
);
