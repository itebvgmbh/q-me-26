import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { InvoiceList } from '../components/pricing/InvoiceList';
import { IntervalSwitch, PlanCards } from '../components/pricing/PlanCards';
import { firestore } from '../utils/firestore-client';
import { getShopsByOwnerId, getStaffByShopId, type Shop } from '../utils/firestore';
import { safelyConvertToDate } from '../utils/datetime';
import { claimFounder, getFoundersLeft, openPortal, startCheckout, type Interval } from '../utils/billing';
import { countCustomersThisMonth } from '../utils/plan-usage';
import { effectivePlan, type PlanId } from '../utils/plans';

/** Mein Tarif: Stand, Verbrauch, Rechnungen, Abo abschließen oder verwalten, Gründerangebot */
export default function Tarif() {
  const { user } = useCurrentUser();
  const [params] = useSearchParams();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState<string>('');
  const [shop, setShop] = useState<Shop | null>(null);
  const [interval, setInterval] = useState<Interval>('monat');
  const [busy, setBusy] = useState<string>('');
  const [customers, setCustomers] = useState<number | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [foundersLeft, setFoundersLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    getShopsByOwnerId(user.uid).then((list) => {
      setShops(list);
      setShopId((current) => current || list[0]?.id || '');
    });
    getFoundersLeft().then(setFoundersLeft);
  }, [user]);

  // Live: nach der Bezahlung schreibt der Stripe-Webhook den neuen Stand an den Laden
  useEffect(() => {
    if (!shopId) return;
    return onSnapshot(doc(firestore, 'shops', shopId), (snap) => snap.exists() && setShop({ id: snap.id, ...snap.data() } as Shop));
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    countCustomersThisMonth(shopId).then(setCustomers).catch(() => setCustomers(null));
    getStaffByShopId(shopId)
      .then((staff) => setStaffCount(staff.filter((s) => s.isActive !== false).length))
      .catch(() => setStaffCount(null));
  }, [shopId]);

  useEffect(() => {
    if (params.get('erfolg') === '1') toast.success('Danke! Dein Abo ist eingerichtet. Der neue Tarif erscheint hier in wenigen Sekunden.');
  }, [params]);

  if (shops === null) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">Tarif wird geladen …</div>;
  if (shops.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p>
          Richte zuerst deinen Laden ein.{' '}
          <Link to="/shop-setup" className="font-semibold underline underline-offset-4">
            Laden einrichten
          </Link>
        </p>
      </div>
    );
  }
  if (!shop) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">Tarif wird geladen …</div>;

  const current = effectivePlan(shop);
  const billing = shop.billing;
  const hasAbo = current.source === 'abo';
  const periodEnd = billing?.currentPeriodEnd ? format(safelyConvertToDate(billing.currentPeriodEnd), 'd. MMMM yyyy', { locale: de }) : null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy('');
    }
  };

  const status =
    current.source === 'abo'
      ? `Abo ${current.plan.name}${billing?.interval === 'jahr' ? ', jährlich' : ', monatlich'}${
          billing?.status === 'past_due' ? '. Die letzte Zahlung ist offen, bitte Zahlungsart prüfen.' : ''
        }${billing?.cancelAtPeriodEnd && periodEnd ? `. Gekündigt zum ${periodEnd}.` : periodEnd ? `. Nächste Abrechnung am ${periodEnd}.` : ''}`
      : current.source === 'test'
        ? `Testphase mit allen Funktionen, noch ${current.trialDaysLeft} ${current.trialDaysLeft === 1 ? 'Tag' : 'Tage'}. Danach Gratis, wenn du kein Abo wählst.`
        : 'Gratis-Tarif. Für Termine, Benachrichtigungen und Team wähl ein Abo.';

  const maxCustomers = current.plan.maxCustomersPerMonth;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Mein Tarif</h1>
        {shops.length > 1 && (
          <select
            aria-label="Laden wählen"
            className="w-full max-w-xs rounded-xl border border-border bg-card px-3 py-2"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <section className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3 rounded-3xl bg-foreground p-6 text-background">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-background/70">{shop.name}</p>
          <p className="font-display text-3xl font-extrabold">
            {current.source === 'test' ? 'Testphase' : current.plan.name}
            {shop.founder && <span className="ml-3 rounded-full bg-signal px-2.5 py-1 align-middle text-xs font-bold text-signal-foreground">Gründer</span>}
          </p>
          <p className="text-background/80">{status}</p>
          {hasAbo && (
            <div>
              <Button variant="signal" onClick={() => run('portal', () => openPortal(shop.id))} disabled={busy !== ''}>
                {busy === 'portal' ? 'Wird geöffnet …' : 'Abo verwalten, Zahlungsart, kündigen'}
              </Button>
            </div>
          )}
        </div>
        <dl className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Kunden diesen Monat</dt>
            <dd className="font-mono text-3xl font-bold">
              {customers ?? '–'}
              {maxCustomers !== null && <span className="text-lg text-muted-foreground"> / {maxCustomers}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Personen im Team</dt>
            <dd className="font-mono text-3xl font-bold">
              {staffCount ?? '–'}
              <span className="text-lg text-muted-foreground"> / {current.plan.maxStaff}</span>
            </dd>
          </div>
        </dl>
      </section>

      {billing?.customerId && (
        <InvoiceList shopId={shop.id} refreshKey={`${billing.status ?? ''}-${billing.currentPeriodEnd?.seconds ?? ''}`} />
      )}

      {!shop.founder && !hasAbo && foundersLeft !== null && foundersLeft > 0 && (
        <section className="flex flex-col gap-3 rounded-3xl bg-signal p-6 text-signal-foreground">
          <h2 className="font-display text-2xl font-extrabold">Gründerangebot: noch {foundersLeft} Plätze</h2>
          <p className="max-w-2xl">
            3 Monate kostenlos, danach den Laden-Tarif dauerhaft für 19 € statt 39 € im Monat. Dafür hängt das QR-Plakat
            sichtbar an deiner Tür, und du sagst uns in den ersten 3 Monaten einmal im Monat, was dich stört.
          </p>
          <div>
            <Button
              onClick={() =>
                run('founder', async () => {
                  const result = await claimFounder(shop.id);
                  setFoundersLeft(result.left);
                  toast.success('Du bist Gründer. 3 Monate kostenlos, danach Laden für 19 €.');
                })
              }
              disabled={busy !== ''}
            >
              {busy === 'founder' ? 'Wird gesichert …' : 'Gründerplatz sichern'}
            </Button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-extrabold">{hasAbo ? 'Tarif wechseln' : 'Abo wählen'}</h2>
          <IntervalSwitch value={interval} onChange={setInterval} />
        </div>
        <PlanCards
          interval={interval}
          current={hasAbo ? current.plan.id : current.source === 'gratis' ? 'gratis' : undefined}
          founder={Boolean(shop.founder)}
          action={(plan: PlanId) =>
            plan === 'gratis' ? null : (
              <Button
                variant={plan === 'laden' ? 'default' : 'outline'}
                disabled={busy !== '' || (hasAbo && plan === current.plan.id)}
                onClick={() => run(plan, () => (hasAbo ? openPortal(shop.id) : startCheckout(shop.id, plan, interval)))}
              >
                {busy === plan ? 'Wird geöffnet …' : hasAbo ? (plan === current.plan.id ? 'Aktueller Tarif' : 'Wechseln') : 'Weiter zur Bezahlung'}
              </Button>
            )
          }
        />
        <p className="text-sm text-muted-foreground">
          Bezahlt wird über Stripe per SEPA-Lastschrift oder Karte. Läuft deine Testphase noch, beginnt die Abrechnung erst danach.
          Mit „Weiter zur Bezahlung“ akzeptierst du die <Link to="/agb" className="underline underline-offset-2">AGB</Link>.
        </p>
      </section>
    </div>
  );
}
