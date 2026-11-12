import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronRight, Globe, Phone, Search, StickyNote, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CreateCustomerDialog } from '../components/EmployeeDialogs';
import { KarteiHinweis } from '../components/kartei/KarteiHinweis';
import { ladeKartei } from '../utils/firestore/kartei';
import { inGruppe, passtZurSuche, sortiere, zaehleGruppen, type Gruppe, type KarteiEintrag, type Sortierung } from '../utils/kartei-logik';
import { useLadenWahl } from '../utils/laden-kontext';
import { euro } from '../utils/plans';
import { datumsLocale, merke, t, tn } from '@/i18n';

const GRUPPEN: { id: Gruppe; label: string }[] = [
  { id: 'alle', label: merke('Alle') },
  { id: 'stamm', label: merke('Stammkunden') },
  { id: 'neu', label: merke('Neu') },
  { id: 'lange', label: merke('Lange nicht da') },
];

const SORTIERUNGEN: { id: Sortierung; label: string }[] = [
  { id: 'zuletzt', label: merke('Zuletzt da') },
  { id: 'name', label: merke('Name') },
  { id: 'umsatz', label: merke('Umsatz') },
  { id: 'besuche', label: merke('Besuche') },
];

/**
 * Kunden des Ladens (Kundenkartei): Suche, Gruppen, Sortierung; ein Tipp öffnet die Kundenseite (pages/Kunde.tsx).
 * Für Inhaber und Team, nicht für das Tablet am Tresen. Kennzahlen und Gruppen ab Tarif Solo, sonst nur die Liste.
 * Gruppen und Suche: utils/kartei-logik.ts, Kennzahlen: backend/app/libs/kartei.py.
 */
export default function Kunden() {
  const { laden: shop, laeden, fehler: ladenFehler, inhaber } = useLadenWahl();
  const shopId = shop?.id ?? '';
  const [stand, setStand] = useState<{ kunden: KarteiEintrag[]; kartei: boolean } | null>(null);
  const [fehler, setFehler] = useState(false);
  const [suche, setSuche] = useState('');
  const [gruppe, setGruppe] = useState<Gruppe>('alle');
  const [sortierung, setSortierung] = useState<Sortierung>('zuletzt');
  const [anlegen, setAnlegen] = useState(false);
  const [runde, setRunde] = useState(0);
  const jetzt = useMemo(() => new Date(), [stand]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shopId) return;
    let aktiv = true;
    setFehler(false);
    ladeKartei(shopId)
      .then((s) => aktiv && setStand(s))
      .catch((e) => {
        console.error('Kundenkartei nicht geladen:', e);
        if (aktiv) setFehler(true);
      });
    return () => {
      aktiv = false;
    };
  }, [shopId, runde]);

  // Anderer Laden: alte Liste weg
  useEffect(() => {
    setStand(null);
    setGruppe('alle');
  }, [shopId]);

  const zahl = useMemo(() => (stand?.kartei ? zaehleGruppen(stand.kunden, jetzt) : null), [stand, jetzt]);
  const gezeigt = useMemo(() => {
    if (!stand) return [];
    const gefiltert = stand.kunden.filter((k) => passtZurSuche(k, suche) && inGruppe(k, stand.kartei ? gruppe : 'alle', jetzt));
    return sortiere(gefiltert, stand.kartei ? sortierung : 'name');
  }, [stand, suche, gruppe, sortierung, jetzt]);

  if (laeden === null && !ladenFehler) return <div className="mx-auto max-w-4xl px-4 py-16 text-muted-foreground sm:px-6">{t('Kunden werden geladen …')}</div>;
  if (!shop) return <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">{ladenFehler ? t('Dein Laden lädt gerade nicht.') : t('Richte zuerst deinen Laden ein.')}</div>;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Kunden')}</h1>
          <p className="text-muted-foreground">
            {shop.name}
            {stand && ` · ${tn(stand.kunden.length, '{n} Kunde', '{n} Kunden')}`}
          </p>
        </div>
        <Button onClick={() => setAnlegen(true)}>
          <UserPlus className="me-2 h-4 w-4" aria-hidden="true" />
          {t('Kunde anlegen')}
        </Button>
      </header>

      {stand && !stand.kartei && <KarteiHinweis inhaber={inhaber} />}

      <div className="flex flex-col gap-3">
        <label className="relative block">
          <span className="sr-only">{t('Kunden suchen')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={t('Name, Telefon oder E-Mail')}
            className="h-12 w-full rounded-2xl border border-border bg-card ps-10 pe-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {stand?.kartei && zahl && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="radiogroup" aria-label={t('Gruppe')} className="flex flex-wrap gap-2">
              {GRUPPEN.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={gruppe === g.id}
                  onClick={() => setGruppe(g.id)}
                  className={cn(
                    'min-h-10 rounded-full border px-4 text-sm font-semibold',
                    gruppe === g.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {t(g.label)} <span className="tabular-nums opacity-70">{zahl[g.id]}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t('Sortieren')}
              <select
                value={sortierung}
                onChange={(e) => setSortierung(e.target.value as Sortierung)}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
              >
                {SORTIERUNGEN.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {stand?.kartei && gruppe !== 'alle' && <p className="text-sm text-muted-foreground">{gruppenText(gruppe)}</p>}
      </div>

      {fehler ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground">{t('Die Kundenliste konnte nicht geladen werden. Versuch es gleich noch einmal.')}</p>
          <Button variant="outline" onClick={() => setRunde((r) => r + 1)}>
            {t('Neu laden')}
          </Button>
        </div>
      ) : !stand ? (
        <div className="h-40 animate-pulse rounded-3xl bg-muted" aria-busy="true" aria-label={t('Kundenliste wird geladen')} />
      ) : stand.kunden.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-3xl border border-dashed border-border p-6">
          <p className="font-semibold">{t('Noch keine Kunden.')}</p>
          <p className="text-sm text-muted-foreground">
            {t('Kunden kommen von selbst dazu, wenn sie mit Handynummer buchen oder eine Nummer ziehen, und über den Telefon-Assistenten. Du kannst sie auch selbst anlegen.')}
          </p>
        </div>
      ) : gezeigt.length === 0 ? (
        <p className="text-muted-foreground">{t('Niemand passt dazu.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
          {gezeigt.map((k) => (
            <li key={k.id}>
              <Zeile kunde={k} shopId={shopId} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {t('Ohne verbundenes Konto löscht Dranzeit einen Kunden von selbst, wenn 24 Monate kein Termin war.')}
      </p>

      <CreateCustomerDialog
        shopId={shopId}
        open={anlegen}
        onOpenChange={setAnlegen}
        onCustomerCreated={() => setRunde((r) => r + 1)}
      />
    </div>
  );
}

const gruppenText = (g: Gruppe) =>
  g === 'stamm'
    ? t('Mindestens 3 Besuche.')
    : g === 'neu'
      ? t('Höchstens ein Besuch, zum ersten Mal in den letzten 60 Tagen.')
      : t('Länger nicht da als sonst üblich (bei nur einem Besuch: 90 Tage) und kein Termin geplant.');

function Zeile({ kunde, shopId }: { kunde: KarteiEintrag; shopId: string }) {
  const z = kunde.kennzahlen;
  const kontakt = kunde.phone || kunde.email || '';
  const teile: string[] = [];
  if (z) {
    teile.push(z.zuletzt ? t('zuletzt {datum}', { datum: format(z.zuletzt, t('d. MMM yyyy'), { locale: datumsLocale() }) }) : t('noch nie da'));
    if (z.besuche) teile.push(tn(z.besuche, '{n} Besuch', '{n} Besuche'));
    if (z.umsatz) teile.push(euro(z.umsatz));
  }
  return (
    <Link
      to={`/kunden/${encodeURIComponent(kunde.id)}?shopId=${encodeURIComponent(shopId)}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{kunde.name || t('Ohne Namen')}</span>
          {kunde.hatNotiz && <StickyNote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t('Mit Notiz')} />}
          {kunde.source === 'telefon' && <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t('Vom Telefon-Assistenten angelegt')} />}
          {kunde.source === 'online' && <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" role="img" aria-label={t('Beim Online-Buchen angelegt')} />}
        </span>
        {teile.length > 0 && <span className="block truncate text-sm text-muted-foreground">{teile.join(' · ')}</span>}
        {kontakt && (
          <span className="block truncate text-xs text-muted-foreground">
            <bdi dir="ltr">{kontakt}</bdi>
          </span>
        )}
        {z?.naechster && (
          <span className="block text-xs font-semibold">
            {t('Nächster Termin: {zeit}', { zeit: format(z.naechster, t('EEE d. MMM, HH:mm'), { locale: datumsLocale() }) })}
          </span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}
