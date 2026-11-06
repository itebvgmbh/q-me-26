import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setPhoneOpen, type Overview } from '../../utils/betreiber';
import { fmtDateTime } from './format';
import { ReasonDialog, type ReasonAction } from './ReasonDialog';

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

const ZUSATZ_STAND: Record<string, string> = { active: 'gebucht', trialing: 'gebucht', past_due: 'Zahlung offen', unpaid: 'Zahlung offen', incomplete: 'Zahlung offen', canceled: 'beendet' };

/** Telefon-Assistent: Schalter „für alle öffnen“ und wer testet oder gebucht hat */
function Telefon({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const [action, setAction] = useState<ReasonAction | null>(null);
  const tel = data.telefon;
  if (!tel) return null;
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 lg:col-span-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Telefon-Assistent</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {tel.offen
            ? 'Für alle Läden geöffnet: Jeder Inhaber ab Solo sieht die Kachel, startet die Testminuten selbst und bucht zu.'
            : 'Nur für freigegebene Läden. Öffnen erst, wenn Datenschutzerklärung und AGB ergänzt sind, der AV-Vertrag mit Vapi steht und das Twilio-Kundenprofil genehmigt ist (sonst nur 2 Anrufe gleichzeitig).'}
        </p>
        <Button
          size="sm"
          variant={tel.offen ? 'outline' : 'default'}
          className="shrink-0"
          onClick={() =>
            setAction(
              tel.offen
                ? {
                    title: 'Telefon-Assistent nicht mehr für alle?',
                    text: 'Neue Läden sehen ihn dann nicht mehr. Wer schon testet oder gebucht hat, behält ihn.',
                    confirm: 'Schließen',
                    run: (reason) => setPhoneOpen(false, reason),
                    done: 'Nur noch für freigegebene Läden.',
                  }
                : {
                    title: 'Telefon-Assistent für alle Läden öffnen?',
                    text: 'Alle Inhaber ab Solo sehen ihn unter „Laden“, können 30 Testminuten selbst starten und ihn über Stripe zubuchen.',
                    confirm: 'Für alle öffnen',
                    reason: 'pflicht',
                    run: (reason) => setPhoneOpen(true, reason),
                    done: 'Für alle Läden geöffnet.',
                  },
            )
          }
        >
          {tel.offen ? 'Nicht mehr für alle' : 'Für alle Läden öffnen'}
        </Button>
      </div>
      {tel.laeden.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.06em] text-muted-foreground">
              <tr>
                <th className="py-1 pe-3">Laden</th>
                <th className="py-1 pe-3">Stand</th>
                <th className="py-1 pe-3">Minuten</th>
                <th className="py-1 pe-3">bei Stripe</th>
                <th className="py-1">Nimmt ab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tel.laeden.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pe-3">{l.name}</td>
                  <td className="py-1.5 pe-3">
                    {l.gesperrt ? 'gesperrt' : l.zusatz ? `${ZUSATZ_STAND[l.zusatz] ?? l.zusatz}${l.kuendigt ? ', gekündigt' : ''}` : l.freigegeben ? 'testet' : '–'}
                    {l.modus === 'test' && ' (Sandbox)'}
                  </td>
                  <td className="py-1.5 pe-3 tabular-nums">
                    {l.minuten} / {l.grenze} {l.art === 'test' ? 'Test' : 'Monat'}
                  </td>
                  <td className="py-1.5 pe-3 tabular-nums">{l.zusatz ? l.gemeldet : '–'}</td>
                  <td className="py-1.5">{!l.aktiv ? 'aus' : l.grund ? 'nein' : 'ja'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Noch kein Laden testet oder hat ihn gebucht.</p>
      )}
      <ReasonDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          onChanged();
        }}
      />
    </section>
  );
}

/** Was auf dem Server eingerichtet ist – nur ja/nein, Schlüssel bleiben auf dem Server */
export function Betrieb({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const s = data.system;
  const o = data.orphans;
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Telefon data={data} onChanged={onChanged} />
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
          <Row ok={s.stripeSandbox && s.stripeSandboxWebhook} warn title="Stripe-Sandbox (Testmodus je Laden)">
            {!s.stripeSandbox
              ? 'STRIPE_TEST_SECRET_KEY fehlt – Läden lassen sich nicht auf die Sandbox umstellen.'
              : !s.stripeSandboxWebhook
                ? 'Schlüssel da, aber STRIPE_TEST_WEBHOOK_SECRET fehlt – stripe-setup.py --test ausführen.'
                : `Bereit. Im Testmodus: ${data.shops.filter((x) => x.stripeMode === 'test').length} Läden.`}
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
        <p className="text-xs text-muted-foreground">Stand {fmtDateTime(data.now)}.</p>
      </section>
    </div>
  );
}
