import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  endGrant,
  grantPlan,
  loadShop,
  setFounder,
  setTrial,
  suspendShop,
  syncStripe,
  unlinkStripe,
  unsuspendShop,
  type AdminAccount,
  type AdminShop,
  type ShopDetail,
  type SystemStatus,
} from '../../utils/betreiber';
import { PAID_PLANS, type PlanId } from '../../utils/plans';
import { ReasonDialog, type ReasonAction } from './ReasonDialog';
import { LoeschenDialog, type DeleteTarget } from './LoeschenDialog';
import { Protokoll } from './Protokoll';
import { BILLING_LABEL, addDays, fmtDate, fmtDateTime, isoDay, planLine, planName, stripeLink } from './format';

export const Section = ({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) => (
  <section className={cn('flex flex-col gap-3 rounded-3xl border p-5', tone === 'danger' ? 'border-destructive/40' : 'border-border bg-card')}>
    <h3 className={cn('text-xs font-semibold uppercase tracking-[0.08em]', tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')}>{title}</h3>
    {children}
  </section>
);

export const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="font-medium">{children}</dd>
  </div>
);

const ONBOARDING_LABEL: Record<string, string> = { testlaufAt: 'Testlauf', plakatAt: 'Plakat', dismissedAt: 'Liste ausgeblendet' };

/** Ein Laden im Betreiber-Bereich: Stand, Tarif, Team, Eingriffe, Protokoll */
export function LadenDetail({
  shop,
  owner,
  system,
  onChanged,
}: {
  shop: AdminShop;
  owner: AdminAccount | undefined;
  system: SystemStatus;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [action, setAction] = useState<ReasonAction | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState('');
  const now = new Date();
  const [trialUntil, setTrialUntil] = useState(isoDay(new Date(shop.trialEnd) > now ? new Date(shop.trialEnd) : addDays(now, 14)));
  const [grant, setGrant] = useState<{ plan: PlanId; until: string; reason: string }>({ plan: 'laden', until: isoDay(addDays(now, 30)), reason: '' });

  const reload = useCallback(() => {
    loadShop(shop.id)
      .then(setDetail)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Laden konnte nicht geladen werden.'));
  }, [shop.id]);
  useEffect(reload, [reload]);

  const changed = () => {
    reload();
    onChanged();
  };

  /** true, wenn es geklappt hat */
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      changed();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      return false;
    } finally {
      setBusy('');
    }
  };

  const hasStripe = Boolean(shop.customerId || shop.subscriptionId);
  const aboActive = ['active', 'trialing', 'past_due'].includes(shop.billing);
  const address = detail ? [detail.shop.street, [detail.shop.postalCode, detail.shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const ownerCanGo = owner && owner.shops.length === 1 && owner.kind !== 'intern';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Laden {shop.nr} · {shop.id}
        </p>
        <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em]">{shop.name}</h2>
        <div className="flex flex-wrap gap-1.5">
          {shop.suspended && <span className="rounded-full bg-destructive px-2.5 py-0.5 text-xs font-bold text-destructive-foreground">gesperrt</span>}
          {shop.markers.map((m) => (
            <span key={m} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
              {m}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="ghost">
            <Link to={`/shop-details?shopId=${encodeURIComponent(shop.id)}`} target="_blank">
              Öffentliche Seite <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
          {shop.customerId && system.stripe && (
            <Button asChild size="sm" variant="ghost">
              <a href={stripeLink(system.stripe, shop.customerId)} target="_blank" rel="noreferrer">
                Bei Stripe <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
      </header>

      <Section title="Stand">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Tarif">{planLine(shop)}</Fact>
          <Fact label="Angelegt">{fmtDate(shop.created)}</Fact>
          <Fact label="Inhaber">{owner ? owner.email || owner.uid : shop.ownerLabel}</Fact>
          <Fact label="Laden-E-Mail">{shop.email || '–'}</Fact>
          <Fact label="Telefon">{shop.phone || '–'}</Fact>
          <Fact label="Adresse">{address || shop.city || '–'}</Fact>
          <Fact label="Nummern/Termine diesen Monat">{shop.thisMonth}</Fact>
          <Fact label="Letzte 30 Tage">{shop.last30}</Fact>
          <Fact label="Kommend">{shop.upcoming}</Fact>
          <Fact label="Letzter Kunde">{fmtDate(shop.lastAppointment)}</Fact>
          <Fact label="Leistungen · Kunden-Einträge">
            {shop.services} · {shop.customers}
          </Fact>
          <Fact label="Startklar">{shop.onboarding.map((k) => ONBOARDING_LABEL[k] || k).join(', ') || 'noch nichts'}</Fact>
        </dl>
      </Section>

      <Section title="Abo bei Stripe">
        {hasStripe ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Status">{BILLING_LABEL[shop.billing] || shop.billing || '–'}</Fact>
            <Fact label="Tarif">
              {planName(shop.plan)}
              {shop.interval ? `, ${shop.interval === 'jahr' ? 'jährlich' : 'monatlich'}` : ''}
            </Fact>
            <Fact label={shop.cancelAtPeriodEnd ? 'Gekündigt zum' : 'Nächste Abrechnung'}>{fmtDate(shop.currentPeriodEnd)}</Fact>
            <Fact label="Stripe-Kunde">{shop.customerId || '–'}</Fact>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Noch nie ein Abo abgeschlossen.</p>
        )}
        {hasStripe && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== ''}
              onClick={() =>
                run('sync', async () => {
                  const r = await syncStripe(shop.id);
                  if (!r.changed && r.message) toast.info(r.message);
                }, 'Mit Stripe abgeglichen.')
              }
            >
              {busy === 'sync' ? 'Frage Stripe …' : 'Mit Stripe abgleichen'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setAction({
                  title: 'Verknüpfung mit Stripe lösen?',
                  text: aboActive
                    ? 'Achtung: Das Abo läuft laut letztem Stand noch. Bei Stripe ändert sich nichts – kündige dort, sonst wird weiter abgebucht. Der Laden fällt hier auf Testphase oder Gratis zurück.'
                    : 'Der Laden vergisst Stripe-Kunde und Abo (z. B. Test-Kunden vor dem Live-Start). Bei Stripe ändert sich nichts.',
                  confirm: 'Verknüpfung lösen',
                  destructive: true,
                  reason: 'pflicht',
                  run: (reason) => unlinkStripe(shop.id, reason),
                  done: 'Verknüpfung gelöst.',
                })
              }
            >
              Verknüpfung lösen …
            </Button>
          </div>
        )}
      </Section>

      <Section title="Testphase und Gründer">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run('trial', () => setTrial(shop.id, trialUntil), `Testphase bis ${fmtDate(new Date(trialUntil).toISOString())}.`);
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="trial-until">Testphase bis</Label>
            <Input id="trial-until" type="date" value={trialUntil} onChange={(e) => setTrialUntil(e.target.value)} className="w-44" required />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy !== ''}>
            Setzen
          </Button>
          <p className="w-full text-xs text-muted-foreground">Jetzt: bis {fmtDate(shop.trialEnd)}. Ein Tag in der Vergangenheit beendet die Testphase.</p>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{shop.founder ? 'Hat einen Gründerplatz.' : 'Kein Gründer.'}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setAction({
                title: shop.founder ? 'Gründerplatz entziehen?' : 'Gründerplatz vergeben?',
                text: shop.founder
                  ? 'Der Platz wird wieder frei. Die Testphase bleibt, wie sie ist; ein laufendes Abo behält seinen Preis.'
                  : 'Wie das Gründerangebot: mindestens 3 Monate gratis, danach Tarif Laden zum Gründerpreis. Zählt als einer der 100 Plätze.',
                confirm: shop.founder ? 'Entziehen' : 'Vergeben',
                run: (reason) => setFounder(shop.id, !shop.founder, reason),
                done: shop.founder ? 'Gründerplatz entzogen.' : 'Gründerplatz vergeben.',
              })
            }
          >
            {shop.founder ? 'Entziehen …' : 'Gründerplatz vergeben …'}
          </Button>
        </div>
      </Section>

      <Section title="Tarif freischalten (ohne Stripe)">
        {shop.grant?.active ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Freigeschaltet: <strong>{planName(shop.grant.plan)}</strong> bis {fmtDate(shop.grant.until)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setAction({
                  title: 'Freischaltung beenden?',
                  text: 'Ab sofort gilt wieder das Abo, die Testphase oder Gratis.',
                  confirm: 'Beenden',
                  run: (reason) => endGrant(shop.id, reason),
                  done: 'Freischaltung beendet.',
                })
              }
            >
              Beenden …
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Für Kulanz, Partner oder eigene Läden. Gilt bis zum Enddatum wie ein bezahltes Abo; ein höheres Abo geht vor.
          </p>
        )}
        <form
          className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run('grant', () => grantPlan(shop.id, grant.plan, grant.until, grant.reason), `${planName(grant.plan)} freigeschaltet.`).then(
              (ok) => ok && setGrant((g) => ({ ...g, reason: '' })),
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="grant-plan">Tarif</Label>
            <select
              id="grant-plan"
              className="h-10 rounded-xl border border-input bg-background px-3"
              value={grant.plan}
              onChange={(e) => setGrant({ ...grant, plan: e.target.value as PlanId })}
            >
              {PAID_PLANS.map((p) => (
                <option key={p} value={p}>
                  {planName(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="grant-until">bis</Label>
            <Input id="grant-until" type="date" value={grant.until} min={isoDay(addDays(now, 1))} onChange={(e) => setGrant({ ...grant, until: e.target.value })} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="grant-reason">Grund (nur im Protokoll)</Label>
            <Input id="grant-reason" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} minLength={3} required />
          </div>
          <Button type="submit" size="sm" disabled={busy !== ''}>
            Freischalten
          </Button>
        </form>
      </Section>

      <Section title={`Team (${detail?.staff.length ?? '…'})`}>
        {detail ? (
          detail.staff.length ? (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {detail.staff.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-medium">
                    {m.name || '(ohne Namen)'} {!m.active && <span className="text-muted-foreground">· deaktiviert</span>}
                  </span>
                  <span className="text-muted-foreground">{m.email || (m.userId ? 'mit Konto' : 'ohne Konto')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Niemand eingetragen.</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Wird geladen …</p>
        )}
        {detail?.owner && (
          <p className="text-sm text-muted-foreground">
            Inhaber-Konto: {detail.owner.email} · E-Mail {detail.owner.emailVerified ? 'bestätigt' : 'unbestätigt'} · zuletzt angemeldet{' '}
            {fmtDateTime(detail.owner.lastSignIn)}
            {detail.owner.disabled ? ' · Anmeldung gesperrt' : ''}
          </p>
        )}
      </Section>

      <Section title="Sperren" tone="danger">
        {shop.suspended ? (
          <>
            <p className="text-sm">Gesperrt seit {fmtDateTime(shop.suspended)}. Kunden finden den Laden nicht, Inhaber und Team kommen nicht hinein.</p>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() =>
                setAction({
                  title: 'Laden wieder freigeben?',
                  text: 'Der Laden ist wieder auffindbar und buchbar. Konten, die beim Sperren gesperrt wurden, gehen wieder auf – einzeln gesperrte bleiben zu.',
                  confirm: 'Freigeben',
                  run: (reason) => unsuspendShop(shop.id, reason),
                  done: 'Laden wieder freigegeben.',
                })
              }
            >
              Wieder freigeben …
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Nimmt den Laden offline: nicht auffindbar, nichts buchbar, keine Benachrichtigungen. Inhaber und Team können sich nicht
              mehr anmelden (Betreiber-Konten bleiben offen).
            </p>
            <Button
              size="sm"
              variant="destructive"
              className="w-fit"
              onClick={() =>
                setAction({
                  title: `„${shop.name}“ sperren?`,
                  text: 'Kunden finden den Laden nicht mehr und können nichts buchen. Inhaber und Team werden abgemeldet und kommen nicht mehr hinein.',
                  confirm: 'Sperren',
                  destructive: true,
                  reason: 'pflicht',
                  run: async (reason) => {
                    const r = await suspendShop(shop.id, reason);
                    if (r.skipped?.length) toast.info(`Offen gelassen (Betreiber): ${r.skipped.join(', ')}`);
                  },
                  done: 'Laden gesperrt.',
                })
              }
            >
              Laden sperren …
            </Button>
          </>
        )}
      </Section>

      <Section title="Löschen" tone="danger">
        <p className="text-sm text-muted-foreground">
          Mit Probelauf und Sicherung. Läden mit laufendem Abo und der Laden der ITEBV GmbH lassen sich nicht löschen.
        </p>
        <Button
          size="sm"
          variant="destructive"
          className="w-fit"
          onClick={() => setDeleting({ shopId: shop.id, ownerUid: ownerCanGo ? owner.uid : undefined, ownerEmail: owner?.email })}
        >
          Laden löschen …
        </Button>
      </Section>

      <Section title="Protokoll zu diesem Laden">
        {detail ? <Protokoll entries={detail.protokoll} compact /> : <p className="text-sm text-muted-foreground">Wird geladen …</p>}
      </Section>

      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={changed} />
      <LoeschenDialog target={deleting} onClose={() => setDeleting(null)} onDone={onChanged} />
    </div>
  );
}
