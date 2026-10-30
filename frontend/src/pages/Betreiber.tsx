import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { loadLog, loadOverview, type AdminAccount, type AdminShop, type LogEntry, type Overview } from '../utils/betreiber';
import { PLANS, type PlanId } from '../utils/plans';
import { LadenDetail } from '../components/betreiber/LadenDetail';
import { KontoDetail } from '../components/betreiber/KontoDetail';
import { Betrieb } from '../components/betreiber/Betrieb';
import { Protokoll } from '../components/betreiber/Protokoll';
import { Verzeichnis } from '../components/betreiber/Verzeichnis';
import { BILLING_LABEL, ROLE_LABEL, daysUntil, euro, fmtDate, fmtDateTime, planLine } from '../components/betreiber/format';

type Tab = 'uebersicht' | 'laeden' | 'konten' | 'verzeichnis' | 'betrieb' | 'protokoll';
type Selected = { kind: 'shop'; id: string } | { kind: 'account'; uid: string } | null;

const SHOP_FILTERS: { id: string; label: string; test: (s: AdminShop, now: number) => boolean }[] = [
  { id: 'alle', label: 'Alle', test: () => true },
  { id: 'test', label: 'Testphase', test: (s) => s.source === 'test' },
  { id: 'abo', label: 'Zahlend', test: (s) => ['active', 'past_due'].includes(s.billing) },
  { id: 'offen', label: 'Zahlung offen', test: (s) => s.billing === 'past_due' },
  { id: 'frei', label: 'Freigeschaltet', test: (s) => s.source === 'freischaltung' },
  { id: 'gratis', label: 'Gratis', test: (s) => s.source === 'gratis' },
  { id: 'gesperrt', label: 'Gesperrt', test: (s) => Boolean(s.suspended) },
];

const ACCOUNT_FILTERS: { id: string; label: string; test: (a: AdminAccount) => boolean }[] = [
  { id: 'alle', label: 'Alle', test: () => true },
  { id: 'inhaber', label: 'Inhaber', test: (a) => a.role === 'shopOwner' || a.shops.length > 0 },
  { id: 'team', label: 'Team', test: (a) => a.staff.length > 0 },
  { id: 'kunden', label: 'Kunden', test: (a) => a.role === 'customer' },
  { id: 'unbestaetigt', label: 'Unbestätigt', test: (a) => a.emailVerified === false },
  { id: 'gesperrt', label: 'Gesperrt', test: (a) => a.disabled },
];

const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
      active ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-foreground/10',
    )}
  >
    {children}
  </button>
);

const Tile = ({ label, value, hint, tone, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'alarm' | 'signal'; onClick?: () => void }) => {
  const body = (
    <>
      <span className={cn('text-xs font-semibold uppercase tracking-[0.08em]', tone === 'alarm' ? 'text-destructive-foreground/80' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className="font-display text-4xl font-extrabold tabular-nums tracking-[-0.03em]">{value}</span>
      {hint && <span className={cn('text-sm', tone === 'alarm' ? 'text-destructive-foreground/90' : 'text-muted-foreground')}>{hint}</span>}
    </>
  );
  const cls = cn(
    'flex flex-col gap-1 rounded-3xl p-5 text-start',
    tone === 'alarm' ? 'bg-destructive text-destructive-foreground' : tone === 'signal' ? 'bg-signal text-signal-foreground' : 'border border-border bg-card',
    onClick && 'transition-transform hover:-translate-y-0.5',
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

/** Schild für eigene Läden/Konten (ITEBV GmbH, Betreiber) und solche aus Testskripten; Grund im Tooltip */
const KIND_LABEL = { intern: 'eigener', test: 'Test' } as const;
const KindBadge = ({ kind, markers }: { kind: 'echt' | 'test' | 'intern'; markers: string[] }) =>
  kind === 'echt' ? null : (
    <span
      title={`Zählt in der Übersicht nicht mit: ${markers.join(', ')}`}
      className={cn(
        'ms-2 rounded-full px-2 py-0.5 text-xs font-semibold',
        kind === 'intern' ? 'bg-foreground text-background' : 'border border-border bg-muted text-muted-foreground',
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );

const matches = (q: string, ...values: (string | null | undefined)[]) => {
  const needle = q.trim().toLowerCase();
  return !needle || values.some((v) => (v || '').toLowerCase().includes(needle));
};

/** Betreiber-Bereich: alle Läden und Konten, Abo-Stand, Eingriffe. Das Backend prüft jeden Aufruf. */
export default function Betreiber() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('reiter') === 'verzeichnis' ? 'verzeichnis' : 'uebersicht')); // Link aus der Mail „Übernahme angefragt“
  const [selected, setSelected] = useState<Selected>(null);
  const [query, setQuery] = useState('');
  const [shopFilter, setShopFilter] = useState('alle');
  const [accountFilter, setAccountFilter] = useState('alle');
  // Verwalten heißt alle sehen; ausblenden nur auf Wunsch. Die Kennzahlen zählen Test- und eigene nie mit.
  const [hideTests, setHideTests] = useState(false);
  const [log, setLog] = useState<LogEntry[] | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadOverview());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (tab !== 'protokoll') return;
    setLog(null);
    loadLog()
      .then((r) => setLog(r.entries))
      .catch(() => setLog([]));
  }, [tab, data]);

  const shopsById = useMemo(() => new Map((data?.shops ?? []).map((s) => [s.id, s])), [data]);
  const accountsByUid = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.uid, a])), [data]);

  const nowMs = data ? new Date(data.now).getTime() : Date.now();
  const shops = useMemo(() => {
    const f = SHOP_FILTERS.find((x) => x.id === shopFilter)!;
    return (data?.shops ?? [])
      .filter((s) => !hideTests || s.kind === 'echt')
      .filter((s) => f.test(s, nowMs))
      .filter((s) => matches(query, s.name, s.city, s.email, s.id, accountsByUid.get(s.owner)?.email))
      .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  }, [data, shopFilter, hideTests, query, nowMs, accountsByUid]);

  const accounts = useMemo(() => {
    const f = ACCOUNT_FILTERS.find((x) => x.id === accountFilter)!;
    return (data?.accounts ?? [])
      .filter((a) => !hideTests || a.kind === 'echt')
      .filter(f.test)
      .filter((a) => matches(query, a.email, a.name, a.uid))
      .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  }, [data, accountFilter, hideTests, query]);

  // Nach dem Löschen ist die Auswahl weg: Seitenleiste schließen
  const selectedShop = selected?.kind === 'shop' ? shopsById.get(selected.id) : undefined;
  const selectedAccount = selected?.kind === 'account' ? accountsByUid.get(selected.uid) : undefined;
  useEffect(() => {
    if (data && selected && !selectedShop && !selectedAccount) setSelected(null);
  }, [data, selected, selectedShop, selectedAccount]);

  if (error && !data) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">Betreiber-Bereich</h1>
        <p>{error}</p>
        <p className="text-sm text-muted-foreground">
          Hinein kommt nur, wer auf dem Server als Betreiber eingetragen ist (QME_ADMIN_EMAILS, deploy/README.md „Betreiber der App“).
        </p>
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-6xl px-4 py-16 text-muted-foreground sm:px-6">Betreiber-Bereich wird geladen …</div>;

  const st = data.stats;
  const attention = data.shops.filter(
    (s) => s.kind === 'echt' && (s.billing === 'past_due' || s.suspended || (s.source === 'test' && daysUntil(s.trialEnd, nowMs) <= 7)),
  );
  const openShops = (filter: string) => {
    setShopFilter(filter);
    setQuery('');
    setTab('laeden');
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'uebersicht', label: 'Übersicht' },
    { id: 'laeden', label: `Läden ${hideTests ? st.shops : data.shops.length}` },
    { id: 'konten', label: `Konten ${hideTests ? st.accounts : data.accounts.length}` },
    { id: 'verzeichnis', label: 'Verzeichnis' },
    { id: 'betrieb', label: 'Betrieb' },
    { id: 'protokoll', label: 'Protokoll' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Betreiber</p>
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Dranzeit im Blick</h1>
          <p className="text-sm text-muted-foreground">Stand {fmtDateTime(data.now)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
          Neu laden
        </Button>
      </header>

      <nav aria-label="Bereiche" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn(
              'inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[15px] font-medium transition-colors',
              tab === t.id ? 'bg-signal text-signal-foreground' : 'hover:bg-foreground/5',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'uebersicht' && (
        <div className="flex flex-col gap-4">
          <section className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-3 rounded-3xl bg-foreground p-6 text-background">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-background/70">Monatsumsatz netto aus Abos</p>
              <p className="font-display text-5xl font-extrabold tabular-nums tracking-[-0.03em] sm:text-6xl">{euro(st.mrr)}</p>
              <p className="text-background/80">
                {st.paying} zahlend · {st.inTrial} in der Testphase · {st.granted} freigeschaltet ·{' '}
                {st.byPlan.gratis} gratis
                {data.system.stripe === 'test' && <span className="ms-2 rounded-full bg-signal px-2 py-0.5 text-xs font-bold text-signal-foreground">Stripe-Testmodus</span>}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(Object.keys(PLANS) as PlanId[]).map((p) => (
                  <span key={p} className="rounded-full bg-background/10 px-3 py-1 text-sm">
                    {PLANS[p].name} <strong className="tabular-nums">{st.byPlan[p]}</strong>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gründerplätze</p>
              <p className="font-display text-4xl font-extrabold tabular-nums">
                {st.founders.taken}
                <span className="text-lg text-muted-foreground"> / {st.founders.limit}</span>
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={st.founders.taken} aria-valuemax={st.founders.limit}>
                <div className="h-full bg-signal" style={{ width: `${Math.min(100, (st.founders.taken / st.founders.limit) * 100)}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">{st.founders.limit - st.founders.taken} noch frei</p>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Läden" value={st.shops} hint={`+${st.newShops7} in 7 Tagen · +${st.newShops30} in 30`} onClick={() => openShops('alle')} />
            <Tile
              label="Testphase endet"
              value={st.trialEndingSoon}
              hint="in den nächsten 7 Tagen"
              tone={st.trialEndingSoon ? 'signal' : undefined}
              onClick={() => openShops('test')}
            />
            <Tile label="Zahlung offen" value={st.pastDue} hint={`${st.cancelling} gekündigt zum Laufzeitende`} tone={st.pastDue ? 'alarm' : undefined} onClick={() => openShops('offen')} />
            <Tile label="Gesperrt" value={st.suspended} hint="Läden offline" onClick={() => openShops('gesperrt')} />
            <Tile
              label="Konten"
              value={st.accounts}
              hint={Object.entries(st.accountsByRole)
                .map(([r, n]) => `${n} ${ROLE_LABEL[r] || r}`)
                .join(' · ')}
              onClick={() => setTab('konten')}
            />
            <Tile label="E-Mail unbestätigt" value={st.accountsUnverified} hint={data.system.resend ? 'Mailversand läuft' : 'Mailversand noch aus'} />
            <Tile label="Kunden in 30 Tagen" value={st.appointments30} hint="Nummern und Termine, ohne abgesagte" />
            <Tile label="Test und intern" value={st.shopsTest} hint={`Läden, dazu ${st.accountsTest} Konten – nicht mitgezählt`} />
          </section>

          <section className="rounded-3xl border border-border bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Braucht Aufmerksamkeit</h2>
            {attention.length ? (
              <ul className="divide-y divide-border">
                {attention.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-start" onClick={() => setSelected({ kind: 'shop', id: s.id })}>
                      <span className="font-semibold">
                        {s.name}
                        {s.city && <span className="font-normal text-muted-foreground"> · {s.city}</span>}
                      </span>
                      <span className="text-sm">
                        {s.suspended
                          ? 'gesperrt'
                          : s.billing === 'past_due'
                            ? 'Zahlung offen'
                            : `Testphase endet ${daysUntil(s.trialEnd, nowMs) <= 0 ? 'heute' : `in ${daysUntil(s.trialEnd, nowMs)} Tagen`}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">Nichts Dringendes.</p>
            )}
          </section>
        </div>
      )}

      {(tab === 'laeden' || tab === 'konten') && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Suchen"
                placeholder={tab === 'laeden' ? 'Name, Ort, E-Mail, ID' : 'E-Mail, Name, UID'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="ps-9"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} />
              Test- und eigene {tab === 'laeden' ? 'Läden' : 'Konten'} ausblenden
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tab === 'laeden'
              ? SHOP_FILTERS.map((f) => (
                  <Chip key={f.id} active={shopFilter === f.id} onClick={() => setShopFilter(f.id)}>
                    {f.label}
                  </Chip>
                ))
              : ACCOUNT_FILTERS.map((f) => (
                  <Chip key={f.id} active={accountFilter === f.id} onClick={() => setAccountFilter(f.id)}>
                    {f.label}
                  </Chip>
                ))}
          </div>

          {tab === 'laeden' && <ShopTable shops={shops} owners={accountsByUid} onOpen={(id) => setSelected({ kind: 'shop', id })} />}
          {tab === 'konten' && <AccountTable accounts={accounts} shops={shopsById} onOpen={(uid) => setSelected({ kind: 'account', uid })} />}
        </div>
      )}

      {tab === 'verzeichnis' && <Verzeichnis />}

      {tab === 'betrieb' && <Betrieb data={data} />}

      {tab === 'protokoll' && (
        <section className="rounded-3xl border border-border bg-card p-5">
          <p className="pb-2 text-sm text-muted-foreground">Jeder Eingriff mit Grund. Liegt auf dem Server, nicht in der Datenbank – der Laden sieht es nicht.</p>
          {log ? <Protokoll entries={log} /> : <p className="text-sm text-muted-foreground">Wird geladen …</p>}
        </section>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background sm:max-w-2xl">
          <SheetTitle className="sr-only">{selectedShop ? `Laden ${selectedShop.name}` : `Konto ${selectedAccount?.email ?? ''}`}</SheetTitle>
          <SheetDescription className="sr-only">Stand und Eingriffe</SheetDescription>
          {selectedShop && (
            <LadenDetail key={selectedShop.id} shop={selectedShop} owner={accountsByUid.get(selectedShop.owner)} system={data.system} onChanged={reload} />
          )}
          {selectedAccount && (
            <KontoDetail
              key={selectedAccount.uid}
              account={selectedAccount}
              shopsById={shopsById}
              onOpenShop={(id) => setSelected({ kind: 'shop', id })}
              onChanged={reload}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ShopTable({ shops, owners, onOpen }: { shops: AdminShop[]; owners: Map<string, AdminAccount>; onOpen: (id: string) => void }) {
  if (!shops.length) return <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Keine Läden in dieser Auswahl.</p>;
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="hidden bg-muted/60 text-start text-xs uppercase tracking-[0.06em] text-muted-foreground md:table-header-group">
          <tr>
            <th className="px-4 py-3 font-semibold">Laden</th>
            <th className="px-4 py-3 font-semibold">Inhaber</th>
            <th className="px-4 py-3 font-semibold">Tarif</th>
            <th className="px-4 py-3 font-semibold">Abo</th>
            <th className="px-4 py-3 text-end font-semibold">Monat</th>
            <th className="px-4 py-3 font-semibold">Angelegt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shops.map((s) => (
            <tr
              key={s.id}
              tabIndex={0}
              onClick={() => onOpen(s.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(s.id))}
              className="grid cursor-pointer grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none md:table-row md:p-0"
            >
              <td className="col-span-2 md:px-4 md:py-3">
                <span className="font-semibold">{s.name}</span>
                {s.suspended && <span className="ms-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">gesperrt</span>}
                {s.founder && <span className="ms-2 rounded-full bg-signal px-2 py-0.5 text-xs font-bold text-signal-foreground">Gründer</span>}
                <KindBadge kind={s.kind} markers={s.markers} />
                <span className="block text-xs text-muted-foreground">{s.city || '–'}</span>
              </td>
              <td className="col-span-2 truncate text-muted-foreground md:max-w-[14rem] md:px-4 md:py-3">{owners.get(s.owner)?.email || s.ownerLabel}</td>
              <td className="md:px-4 md:py-3">{planLine(s)}</td>
              <td className={cn('md:px-4 md:py-3', s.billing === 'past_due' && 'font-semibold text-destructive')}>
                {s.billing ? BILLING_LABEL[s.billing] || s.billing : '–'}
                {s.cancelAtPeriodEnd && <span className="block text-xs text-muted-foreground">gekündigt zum {fmtDate(s.currentPeriodEnd)}</span>}
              </td>
              <td className="tabular-nums md:px-4 md:py-3 md:text-end">
                <span className="md:hidden">Diesen Monat: </span>
                {s.thisMonth}
              </td>
              <td className="text-muted-foreground md:px-4 md:py-3">{fmtDate(s.created)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountTable({ accounts, shops, onOpen }: { accounts: AdminAccount[]; shops: Map<string, AdminShop>; onOpen: (uid: string) => void }) {
  if (!accounts.length) return <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Keine Konten in dieser Auswahl.</p>;
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="hidden bg-muted/60 text-start text-xs uppercase tracking-[0.06em] text-muted-foreground md:table-header-group">
          <tr>
            <th className="px-4 py-3 font-semibold">Konto</th>
            <th className="px-4 py-3 font-semibold">Rolle</th>
            <th className="px-4 py-3 font-semibold">Laden</th>
            <th className="px-4 py-3 font-semibold">E-Mail</th>
            <th className="px-4 py-3 font-semibold">Zuletzt da</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((a) => {
            const shopNames = [...a.shops, ...a.staff.map((s) => s.shopId)].map((id) => shops.get(id)?.name).filter(Boolean);
            return (
              <tr
                key={a.uid}
                tabIndex={0}
                onClick={() => onOpen(a.uid)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(a.uid))}
                className="grid cursor-pointer grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none md:table-row md:p-0"
              >
                <td className="col-span-2 min-w-0 md:px-4 md:py-3">
                  <span className="break-all font-semibold">{a.email || '(ohne E-Mail)'}</span>
                  {a.disabled && <span className="ms-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">gesperrt</span>}
                  <KindBadge kind={a.kind} markers={a.markers} />
                  {a.name && <span className="block text-xs text-muted-foreground">{a.name}</span>}
                </td>
                <td className="md:px-4 md:py-3">{ROLE_LABEL[a.role] || a.role}</td>
                <td className="truncate text-muted-foreground md:max-w-[14rem] md:px-4 md:py-3">{shopNames.join(', ') || '–'}</td>
                <td className={cn('md:px-4 md:py-3', a.emailVerified === false && 'text-muted-foreground')}>
                  {a.emailVerified === null ? '–' : a.emailVerified ? 'bestätigt' : 'unbestätigt'}
                </td>
                <td className="text-muted-foreground md:px-4 md:py-3">{fmtDate(a.lastSignIn)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
