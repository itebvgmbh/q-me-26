import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { getAppointmentsInRange, getShopsByOwnerId, type Appointment, type Shop } from '../utils/firestore';
import { merkeLaden, waehleLaden } from '../utils/laden-wahl';
import { hasFeature, euro } from '../utils/plans';
import { computeStats } from '../utils/stats';
import { merke, t, tn } from '@/i18n';
import { inStoreApp } from '../utils/app-shell';

const RANGES = [
  { days: 7, label: merke('7 Tage') },
  { days: 30, label: merke('30 Tage') },
];

/** Auswertung für Inhaber: Kunden, Anteil Nummer/Termin, Wartezeit, Stoßzeiten. Ab Tarif Laden. */
export default function Auswertung() {
  const { user } = useCurrentUser();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [shopId, setShopId] = useState('');
  const [range, setRange] = useState(7);
  const [appts, setAppts] = useState<Appointment[] | null>(null);

  useEffect(() => {
    if (!user) return;
    getShopsByOwnerId(user.uid).then((list) => {
      setShops(list);
      setShopId((current) => current || waehleLaden(list)?.id || '');
    });
  }, [user]);

  useEffect(() => {
    if (shopId) merkeLaden(shopId);
  }, [shopId]);

  const { from, to } = useMemo(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - range);
    return { from: start, to: end };
  }, [range]);

  useEffect(() => {
    if (!shopId) return;
    setAppts(null);
    getAppointmentsInRange(shopId, from, to).then(setAppts).catch(() => setAppts([]));
  }, [shopId, from, to]);

  const shop = shops?.find((s) => s.id === shopId) ?? null;
  const stats = useMemo(() => (appts ? computeStats(appts, from, to) : null), [appts, from, to]);

  if (shops === null) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">{t('Auswertung wird geladen …')}</div>;
  if (!shop) return <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">{t('Richte zuerst deinen Laden ein.')}</div>;
  if (!hasFeature(shop, 'auswertung')) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Auswertung')}</h1>
        <p>{t('Wie viele Kunden kommen, wie lange sie warten und wann am meisten los ist: Das gehört zum Tarif Laden.')}</p>
        {!inStoreApp() && (
          <Link to="/tarif" className="w-fit rounded-xl bg-foreground px-5 py-3 font-semibold text-background">
            {t('Tarif ansehen')}
          </Link>
        )}
      </div>
    );
  }

  const maxDay = stats ? Math.max(1, ...stats.days.map((d) => d.queue + d.booked)) : 1;
  const hours = stats ? stats.byHour.map((n, h) => ({ h, n })).filter(({ h, n }) => n > 0 || (h >= 8 && h <= 20)) : [];
  const maxHour = Math.max(1, ...hours.map((x) => x.n));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Auswertung')}</h1>
          {shops.length > 1 ? (
            <select aria-label={t('Laden wählen')} className="w-fit rounded-xl border border-border bg-card px-3 py-2" value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-muted-foreground">{shop.name}</p>
          )}
        </div>
        <div role="radiogroup" aria-label={t('Zeitraum')} className="inline-flex rounded-full border border-border bg-card p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="radio"
              aria-checked={range === r.days}
              onClick={() => setRange(r.days)}
              className={range === r.days ? 'min-h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background' : 'min-h-10 rounded-full px-4 text-sm font-semibold text-muted-foreground'}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
      </header>

      {!stats ? (
        <div className="h-40 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label={t('Auswertung wird berechnet')} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Tile label={t('Kunden')} value={String(stats.customers)} />
            <Tile label={t('Davon per Nummer')} value={t('{prozent} %', { prozent: Math.round(stats.queueShare * 100) })} />
            <Tile
              label={t('Ø Wartezeit (Nummer)')}
              value={stats.avgWaitMinutes === null ? '–' : t('{minuten} Min.', { minuten: stats.avgWaitMinutes })}
              hint={stats.avgWaitMinutes === null ? t('erst ab Aufruf am Tresen messbar') : tn(stats.waitSamples, 'aus {n} Nummer', 'aus {n} Nummern')}
            />
            <Tile label={t('Abgesagt')} value={String(stats.cancelled)} />
            <Tile label={t('Umsatz (erledigt)')} value={euro(stats.revenue)} />
          </dl>

          <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-6" aria-labelledby="pro-tag">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="pro-tag" className="font-display text-xl font-bold">
                {t('Kunden pro Tag')}
              </h2>
              <p className="flex gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <i className="h-3 w-3 rounded-sm bg-foreground" aria-hidden="true" /> {t('Nummer')}
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-3 w-3 rounded-sm bg-signal" aria-hidden="true" /> {t('Termin')}
                </span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <ol className="flex h-48 min-w-fit items-end gap-1.5">
                {stats.days.map((d) => (
                  <li key={d.key} className="flex h-full w-8 shrink-0 flex-col items-center justify-end gap-1" title={t('{tag}: {nummern} Nummern, {termine} Termine', { tag: d.label, nummern: d.queue, termine: d.booked })}>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{d.queue + d.booked || ''}</span>
                    <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${((d.queue + d.booked) / maxDay) * 100}%` }}>
                      <span className="bg-signal" style={{ flexGrow: d.booked }} />
                      <span className="bg-foreground" style={{ flexGrow: d.queue }} />
                    </span>
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{range <= 7 ? d.label : d.label.split(' ')[1]}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-6" aria-labelledby="stosszeiten">
            <h2 id="stosszeiten" className="font-display text-xl font-bold">
              {t('Stoßzeiten')}
            </h2>
            {stats.busiestHour !== null && (
              <p className="text-sm text-muted-foreground">
                {t('Am meisten los ist zwischen {von} und {bis} Uhr.', { von: stats.busiestHour, bis: stats.busiestHour + 1 })}
              </p>
            )}
            <div className="overflow-x-auto">
              <ol className="flex h-32 min-w-fit items-end gap-1.5">
                {hours.map(({ h, n }) => (
                  <li key={h} className="flex h-full w-8 shrink-0 flex-col items-center justify-end gap-1" title={t('{stunde} Uhr: {anzahl}', { stunde: h, anzahl: n })}>
                    <span className={h === stats.busiestHour ? 'w-full rounded-t-md bg-signal' : 'w-full rounded-t-md bg-foreground/80'} style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 3 : 0 }} />
                    <span className="font-mono text-[10px] text-muted-foreground">{h}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="flex flex-col gap-1 border-t-4 border-foreground pt-3">
    <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
    <dd className="font-mono text-3xl font-bold tabular-nums">{value}</dd>
    {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
  </div>
);
