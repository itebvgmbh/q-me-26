import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { InvoiceList } from '../components/pricing/InvoiceList';
import { IntervalSwitch, PlanCards } from '../components/pricing/PlanCards';
import { HilfeLink } from '../components/HilfeLink';
import { firestore } from '../utils/firestore-client';
import { getShopsByOwnerId, getStaffByShopId, type Shop } from '../utils/firestore';
import { safelyConvertToDate } from '../utils/datetime';
import { claimFounder, getFoundersLeft, openPortal, startCheckout, type Interval } from '../utils/billing';
import { countCustomersThisMonth } from '../utils/plan-usage';
import { effectivePlan, type PlanId } from '../utils/plans';
import { datumsLocale, t, tn, tTeile } from '@/i18n';

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
    if (params.get('erfolg') === '1') toast.success(t('Danke! Dein Abo ist eingerichtet. Der neue Tarif erscheint hier in wenigen Sekunden.'));
  }, [params]);

  if (shops === null) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">{t('Tarif wird geladen …')}</div>;
  if (shops.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p>
          {t('Richte zuerst deinen Laden ein.')}{' '}
          <Link to="/shop-setup" className="font-semibold underline underline-offset-4">
            {t('Laden einrichten')}
          </Link>
        </p>
      </div>
    );
  }
  if (!shop) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">{t('Tarif wird geladen …')}</div>;

  const current = effectivePlan(shop);
  const billing = shop.billing;
  // Laufendes Abo – auch wenn gerade eine höhere Freischaltung des Betreibers gilt
  const hasAbo = Boolean(billing?.plan && ['active', 'trialing', 'past_due'].includes(billing.status || ''));
  const aboPlan = hasAbo ? billing?.plan : undefined;
  const grantUntil = current.grantUntil ? format(current.grantUntil, t('d. MMMM yyyy'), { locale: datumsLocale() }) : null;
  const periodEnd = billing?.currentPeriodEnd ? format(safelyConvertToDate(billing.currentPeriodEnd), t('d. MMMM yyyy'), { locale: datumsLocale() }) : null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
    } finally {
      setBusy('');
    }
  };

  const planName = t(current.plan.name);
  // Ganze Sätze, damit jede Sprache ihre Wortstellung behält
  const aboStatus = () => {
    const saetze = [billing?.interval === 'jahr' ? t('Abo {plan}, jährlich.', { plan: planName }) : t('Abo {plan}, monatlich.', { plan: planName })];
    if (billing?.status === 'past_due') saetze.push(t('Die letzte Zahlung ist offen, bitte Zahlungsart prüfen.'));
    if (periodEnd) {
      saetze.push(
        billing?.cancelAtPeriodEnd ? t('Gekündigt zum {datum}.', { datum: periodEnd }) : t('Nächste Abrechnung am {datum}.', { datum: periodEnd }),
      );
    }
    return saetze.join(' ');
  };
  const status =
    current.source === 'abo'
      ? aboStatus()
      : current.source === 'freischaltung'
        ? hasAbo
          ? t('Von Dranzeit freigeschaltet bis {datum}. Danach gilt wieder dein Abo.', { datum: grantUntil ?? '' })
          : t('Von Dranzeit freigeschaltet bis {datum}. Danach Gratis, wenn du kein Abo wählst.', { datum: grantUntil ?? '' })
        : current.source === 'test'
          ? tn(
              current.trialDaysLeft,
              'Testphase mit allen Funktionen, noch {n} Tag. Danach Gratis, wenn du kein Abo wählst.',
              'Testphase mit allen Funktionen, noch {n} Tage. Danach Gratis, wenn du kein Abo wählst.',
            )
          : t('Gratis-Tarif. Für Termine, Benachrichtigungen und Team wähl ein Abo.');

  const maxCustomers = current.plan.maxCustomersPerMonth;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Mein Tarif')}</h1>
        {shops.length > 1 && (
          <select
            aria-label={t('Laden wählen')}
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
            {current.source === 'test' ? t('Testphase') : t(current.plan.name)}
            {shop.founder && <span className="ms-3 rounded-full bg-signal px-2.5 py-1 align-middle text-xs font-bold text-signal-foreground">{t('Gründer')}</span>}
          </p>
          <p className="text-background/80">{status}</p>
          {hasAbo && (
            <div>
              <Button variant="signal" onClick={() => run('portal', () => openPortal(shop.id))} disabled={busy !== ''}>
                {busy === 'portal' ? t('Wird geöffnet …') : t('Abo verwalten, Zahlungsart, kündigen')}
              </Button>
            </div>
          )}
        </div>
        <dl className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Kunden diesen Monat')}</dt>
            <dd className="font-mono text-3xl font-bold">
              {customers ?? '–'}
              {maxCustomers !== null && <span className="text-lg text-muted-foreground"> / {maxCustomers}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Personen im Team')}</dt>
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
          <h2 className="font-display text-2xl font-extrabold">{tn(foundersLeft, 'Gründerangebot: noch {n} Platz', 'Gründerangebot: noch {n} Plätze')}</h2>
          <p className="max-w-2xl">
            {t('3 Monate kostenlos, danach den Laden-Tarif dauerhaft für 19 € statt 39 € im Monat. Dafür hängt das QR-Plakat sichtbar an deiner Tür, und du sagst uns in den ersten 3 Monaten einmal im Monat, was dich stört.')}
          </p>
          <div>
            <Button
              onClick={() =>
                run('founder', async () => {
                  const result = await claimFounder(shop.id);
                  setFoundersLeft(result.left);
                  toast.success(t('Du bist Gründer: 3 Monate kostenlos. Danach Laden für 19 € im Monat, wenn du das Abo abschließt.'));
                })
              }
              disabled={busy !== ''}
            >
              {busy === 'founder' ? t('Wird gesichert …') : t('Gründerplatz sichern')}
            </Button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-extrabold">{hasAbo ? t('Tarif wechseln') : t('Abo wählen')}</h2>
          <IntervalSwitch value={interval} onChange={setInterval} />
        </div>
        <PlanCards
          interval={interval}
          current={hasAbo ? aboPlan : current.source === 'gratis' ? 'gratis' : undefined}
          founder={Boolean(shop.founder)}
          action={(plan: PlanId) =>
            plan === 'gratis' ? null : (
              <Button
                variant={plan === 'laden' ? 'default' : 'outline'}
                disabled={busy !== '' || (hasAbo && plan === aboPlan)}
                onClick={() => run(plan, () => (hasAbo ? openPortal(shop.id) : startCheckout(shop.id, plan, interval)))}
              >
                {busy === plan ? t('Wird geöffnet …') : hasAbo ? (plan === aboPlan ? t('Aktueller Tarif') : t('Wechseln')) : t('Weiter zur Bezahlung')}
              </Button>
            )
          }
        />
        <p className="text-sm text-muted-foreground">
          {tTeile(
            'Bezahlt wird über Stripe per SEPA-Lastschrift oder Karte. Läuft deine Testphase noch, beginnt die Abrechnung erst danach. Mit „Weiter zur Bezahlung“ akzeptierst du die <agb>AGB</agb>.',
            {
              agb: (inhalt) => (
                <Link to="/agb" className="underline underline-offset-2">
                  {inhalt}
                </Link>
              ),
            },
          )}
        </p>
        <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <HilfeLink hilfe="tarife">{t('Welcher Tarif passt zu mir?')}</HilfeLink>
          <HilfeLink hilfe="gratis-tarif">{t('Was zählt zu den 100 Kunden?')}</HilfeLink>
          <HilfeLink hilfe="abo">{t('Abo wechseln und kündigen')}</HilfeLink>
        </p>
      </section>
    </div>
  );
}
