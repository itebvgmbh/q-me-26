import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InvoiceList } from '../components/pricing/InvoiceList';
import { IntervalSwitch, PlanCards } from '../components/pricing/PlanCards';
import { HilfeLink } from '../components/HilfeLink';
import { useLive } from '../utils/live';
import { getStaffByShopId, type Shop } from '../utils/firestore';
import { useInhaberLaden } from '../utils/laden-kontext';
import { safelyConvertToDate } from '../utils/datetime';
import { claimFounder, getBillingTestMode, getFoundersLeft, openPortal, startCheckout, type Interval } from '../utils/billing';
import { countCustomersThisMonth } from '../utils/plan-usage';
import { effectivePlan, type PlanId } from '../utils/plans';
import { datumsLocale, t, tn, tTeile } from '@/i18n';
import { inStoreApp } from '../utils/app-shell';
import { TELEFON_PREIS, useTelefonStand } from '../utils/telefon-assistent';
import { euro } from '../utils/plans';

/**
 * Mein Tarif: Stand, Verbrauch, Rechnungen, Abo abschließen oder verwalten, Gründerangebot.
 * In der App aus dem Store nur Stand, Verbrauch und Rechnungen – dort wird nichts verkauft (utils/app-shell.ts).
 * Welcher Laden: oben in der Kopfzeile (utils/laden-kontext.tsx).
 */
export default function Tarif() {
  const [params] = useSearchParams();
  const { laeden: shops, laden } = useInhaberLaden();
  const shopId = laden?.id ?? '';
  const [interval, setInterval] = useState<Interval>('monat');
  const [busy, setBusy] = useState<string>('');
  const [customers, setCustomers] = useState<number | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [foundersLeft, setFoundersLeft] = useState<number | null>(null);
  const [testmodus, setTestmodus] = useState(false);
  const telefon = useTelefonStand(shopId);

  useEffect(() => {
    getFoundersLeft().then(setFoundersLeft);
  }, []);

  // Testmodus aus dem Betreiber-Bereich: Abo läuft über die Stripe-Sandbox
  useEffect(() => {
    setTestmodus(false);
    if (!shopId) return;
    let aktuell = true;
    getBillingTestMode(shopId).then((test) => aktuell && setTestmodus(test));
    return () => {
      aktuell = false;
    };
  }, [shopId]);

  // Nach der Bezahlung schreibt der Stripe-Webhook den neuen Stand an den Laden: dann alle paar Sekunden nachsehen,
  // sonst jede Minute und beim Zurückkommen auf die Seite (utils/live.ts)
  const { daten: ladenDaten } = useLive<{ laden: Shop; kanaele?: string[] }>(shopId ? `team/laeden/${encodeURIComponent(shopId)}` : null, {
    anmelden: true,
    neuLadenMs: params.get('erfolg') === '1' ? 4_000 : 60_000,
  });
  const shop: Shop | null = ladenDaten?.laden.id === shopId ? ladenDaten.laden : null;

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

  const app = inStoreApp();
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
          : app
            ? t('Von Dranzeit freigeschaltet bis {datum}.', { datum: grantUntil ?? '' })
            : t('Von Dranzeit freigeschaltet bis {datum}. Danach Gratis, wenn du kein Abo wählst.', { datum: grantUntil ?? '' })
        : current.source === 'test'
          ? app
            ? tn(current.trialDaysLeft, 'Testphase mit allen Funktionen, noch {n} Tag.', 'Testphase mit allen Funktionen, noch {n} Tage.')
            : tn(
                current.trialDaysLeft,
                'Testphase mit allen Funktionen, noch {n} Tag. Danach Gratis, wenn du kein Abo wählst.',
                'Testphase mit allen Funktionen, noch {n} Tage. Danach Gratis, wenn du kein Abo wählst.',
              )
          : app
            ? t('Gratis-Tarif.')
            : t('Gratis-Tarif. Für Termine, Benachrichtigungen und Team wähl ein Abo.');

  const maxCustomers = current.plan.maxCustomersPerMonth;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Mein Tarif')}</h1>
      </header>

      {testmodus && (
        <p role="status" className="rounded-2xl border-2 border-dashed border-signal bg-signal/10 px-4 py-3">
          <strong>{t('Testmodus:')}</strong>{' '}
          {t('Hier wird nichts abgebucht. Zum Bezahlen die Testkarte 4242 4242 4242 4242 nehmen, mit einem beliebigen Ablaufdatum in der Zukunft und einer beliebigen Prüfnummer.')}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3 rounded-3xl bg-foreground p-6 text-background">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-background/70">{shop.name}</p>
          <p className="font-display text-3xl font-extrabold">
            {current.source === 'test' ? t('Testphase') : t(current.plan.name)}
            {shop.founder && <span className="ms-3 rounded-full bg-signal px-2.5 py-1 align-middle text-xs font-bold text-signal-foreground">{t('Gründer')}</span>}
          </p>
          <p className="text-background/80">{status}</p>
          {hasAbo && !app && (
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

      {(billing?.status || billing?.customerId) && (
        <InvoiceList shopId={shop.id} refreshKey={`${billing.status ?? ''}-${billing.currentPeriodEnd?.seconds ?? ''}`} />
      )}

      {telefon?.sichtbar && (
        <section className="flex flex-col items-start gap-2 rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-2xl font-extrabold">{t('Zusatz: Telefon-Assistent')}</h2>
          <p className="text-muted-foreground">
            {telefon.zusatz && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(telefon.zusatz.status)
              ? t('Gebucht. Er hat ein eigenes Monatsabo mit eigener Rechnung, dein Tarif bleibt, wie er ist.')
              : t('Nimmt Anrufe an, wenn im Laden niemand rangeht. {grundpreis} netto im Monat mit {inklusiv} Minuten, danach {minute} je Minute.', {
                  grundpreis: euro(TELEFON_PREIS.grundpreis),
                  inklusiv: TELEFON_PREIS.inklusiv,
                  minute: euro(TELEFON_PREIS.minute),
                })}
          </p>
          <Button variant="outline" asChild>
            <Link to="/telefon-assistent">{t('Zum Telefon-Assistenten')}</Link>
          </Button>
        </section>
      )}

      {!app && !shop.founder && !hasAbo && foundersLeft !== null && foundersLeft > 0 && (
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

      {!app && (
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
      )}
    </div>
  );
}
