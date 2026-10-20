import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { Overview } from '../../utils/betreiber';
import { fmtDateTime } from './format';

const Row = ({ ok, warn, title, children }: { ok: boolean; warn?: boolean; title: string; children: ReactNode }) => (
  <li className="flex gap-3 py-3">
    <span
      aria-hidden="true"
      className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', ok ? 'bg-emerald-500' : warn ? 'bg-signal' : 'bg-destructive')}
    />
    <div className="flex flex-col">
      <span className="font-semibold">
        {title} <span className="sr-only">{ok ? '(in Ordnung)' : '(offen)'}</span>
      </span>
      <span className="text-sm text-muted-foreground">{children}</span>
    </div>
  </li>
);

/** Was auf dem Server eingerichtet ist – nur ja/nein, Schlüssel bleiben auf dem Server */
export function Betrieb({ data }: { data: Overview }) {
  const s = data.system;
  const o = data.orphans;
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <section className="rounded-3xl border border-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Einrichtung</h2>
        <ul className="divide-y divide-border">
          <Row ok={s.stripe === 'live'} warn={s.stripe === 'test'} title={`Stripe: ${s.stripe === 'live' ? 'Live-Modus' : s.stripe === 'test' ? 'Testmodus' : 'nicht eingerichtet'}`}>
            {s.stripe === 'test' ? 'Abos sind Probe-Zahlungen. Vor dem Live-Schalten Test-Kunden an den Läden lösen.' : s.stripe ? 'Echte Zahlungen.' : 'STRIPE_SECRET_KEY fehlt.'}
          </Row>
          <Row ok={s.stripeWebhook} title="Stripe-Webhook">
            {s.stripeWebhook ? 'Abo-Änderungen kommen an.' : 'STRIPE_WEBHOOK_SECRET fehlt – Abo-Stand wird nicht aktualisiert.'}
          </Row>
          <Row ok={s.stripePortal} warn title="Stripe-Kundenportal">
            {s.stripePortal ? 'Eigene Einstellung hinterlegt.' : 'Standard-Portal von Stripe.'}
          </Row>
          <Row ok={s.resend} title="Mailversand (Resend)">
            {s.resend ? `Absender ${s.mailFrom}.` : 'RESEND_API_KEY fehlt: keine Bestätigungs-, Start- und Benachrichtigungs-Mails.'}
          </Row>
          <Row ok={s.scheduler.running} title="Hintergrunddienst „Früher dran“">
            {s.scheduler.running ? `Läuft alle ${Math.round(s.scheduler.intervalSeconds / 60)} Minuten, zuletzt ${fmtDateTime(s.scheduler.lastRun)}.` : 'Läuft nicht.'}{' '}
            <Link to="/scheduler-control" className="underline underline-offset-2">
              Steuern
            </Link>
          </Row>
          <Row ok={Boolean(s.publicUrl)} warn title="Adresse der App">
            {s.publicUrl || 'PUBLIC_URL nicht gesetzt (Standard https://dranzeit.de).'}
          </Row>
          <Row ok={s.admins > 0} title="Betreiber">
            {s.admins} {s.admins === 1 ? 'Eintrag' : 'Einträge'} in QME_ADMIN_EMAILS/QME_ADMIN_UIDS.
          </Row>
        </ul>
      </section>
      <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reste ohne Konto oder Laden</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <dt>Team-Einträge, deren Konto fehlt</dt>
          <dd className="tabular-nums font-semibold">{o.staff}</dd>
          <dt>Kunden-Einträge, deren Konto fehlt</dt>
          <dd className="tabular-nums font-semibold">{o.customers}</dd>
          <dt>Termine in gelöschten Läden</dt>
          <dd className="tabular-nums font-semibold">{o.appointmentsInMissingShops}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">Stand {fmtDateTime(data.now)}. Code-Analyse: <Link to="/code-health" className="underline underline-offset-2">Code-Health</Link></p>
      </section>
    </div>
  );
}
