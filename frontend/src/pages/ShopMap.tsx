import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { List, LocateFixed, Map as KartenIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { merke, t, tn } from '@/i18n';
import { ConnectionProblem } from '../components/ConnectionProblem';
import { SuchLeiste, type WoWahl } from '../components/suche/SuchLeiste';
import { SuchKarte } from '../components/suche/SuchKarte';
import { SalonZeile, TrefferKarte } from '../components/suche/TrefferKarte';
import {
  ergebnis,
  ortAusListe,
  RADIUS_KM,
  zeitenFuer,
  zustandAus,
  zustandParams,
  type Bereich,
  type Filter,
  type Grenzen,
  type Ort,
  type Punkt,
  type Sortierung,
  type Zustand,
} from '../utils/suche';
import { ORTE, ortAufloesen, useFreieZeiten, useSuchDaten } from '../utils/suche-daten';

const FILTER_TEXT: Record<Filter, string> = {
  offen: merke('Jetzt geöffnet'),
  heute: merke('Heute Termin frei'),
  kurz: merke('Kaum Wartezeit'),
  termine: merke('Online-Termine'),
};
const SORT_TEXT: Record<Sortierung, string> = {
  empfohlen: merke('Empfohlen'),
  entfernung: merke('Entfernung'),
  warten: merke('Wartezeit'),
  preis: merke('Preis'),
};
const BERLIN: Ort = { name: 'Berlin', typ: 'stadt', lat: 52.517, lng: 13.389 };

/** Uhrzeit für offen/zu und „heute“: jede Minute neu */
const useJetzt = () => {
  const [jetzt, setJetzt] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setJetzt(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return jetzt;
};

/**
 * Läden finden: Was? + Wo?, Filter, Liste und Karte nebeneinander (am Handy umschaltbar). Logik in utils/suche.ts,
 * Daten aus backend/app/apis/suche. In der Adresse stehen nur Eingaben (?was=…&wo=…&filter=…&sort=…), nie der
 * eigene Standort oder der Kartenausschnitt.
 */
const ShopMap = () => {
  const [params, setParams] = useSearchParams();
  const zustand = useMemo(() => zustandAus(params), [params]);
  const { daten, fehler, nochmal } = useSuchDaten();
  const jetzt = useJetzt();

  const [ort, setOrt] = useState<Ort | null>(null);
  const [ortStatus, setOrtStatus] = useState<'ok' | 'sucht' | 'nicht' | 'fehler'>('ok');
  const [nahe, setNahe] = useState<Punkt | null>(null);
  const [naheStatus, setNaheStatus] = useState<'aus' | 'sucht' | 'an' | 'abgelehnt'>('aus');
  const [kartenBereich, setKartenBereich] = useState<Grenzen | null>(null);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<'liste' | 'karte'>('liste');
  const [zaehler, setZaehler] = useState(0);
  const karten = useRef<Record<string, HTMLElement | null>>({});

  const setzeZustand = useCallback(
    (neu: Partial<Zustand>, ersetzen = false) => setParams(zustandParams({ ...zustand, ...neu }, params), { replace: ersetzen }),
    [params, setParams, zustand],
  );

  // Ort aus der Adresse: erst die eigene Liste, sonst Backend (PLZ, Straße, andere Stadt)
  useEffect(() => {
    const wo = zustand.wo;
    if (!wo) {
      setOrt(null);
      setOrtStatus('ok');
      return;
    }
    if (ort && ort.name === wo) return;
    const ausListe = /^berlin$/i.test(wo.trim()) ? BERLIN : ortAusListe(wo, ORTE);
    if (ausListe) {
      setOrt(ausListe);
      setOrtStatus('ok');
      setZaehler((z) => z + 1);
      return;
    }
    let aktuell = true;
    setOrtStatus('sucht');
    ortAufloesen(wo)
      .then((o) => {
        if (!aktuell) return;
        setOrt(o ? { ...o, name: wo } : null);
        setOrtStatus(o ? 'ok' : 'nicht');
        setZaehler((z) => z + 1);
      })
      .catch(() => aktuell && setOrtStatus('fehler'));
    return () => {
      aktuell = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zustand.wo]);

  const bereich: Bereich | null = kartenBereich
    ? { grenzen: kartenBereich }
    : ort
      ? { mitte: ort, radiusKm: RADIUS_KM[ort.typ], ort }
      : nahe
        ? { mitte: nahe, radiusKm: RADIUS_KM.nahe }
        : null;
  const anfrage = { was: zustand.was, bereich, filter: zustand.filter, sortierung: zustand.sortierung };
  const laeden = daten?.laeden ?? [];
  const frei = useFreieZeiten(daten ? zeitenFuer(laeden, anfrage) : [], zustand.was);
  const e = daten ? ergebnis(laeden, daten.salons, anfrage, frei, jetzt) : null;
  const alleTreffer = e ? [...e.treffer, ...e.weiter] : [];
  const woAnzeige = kartenBereich ? t('Kartenausschnitt') : ort ? ort.name : nahe ? t('In deiner Nähe') : '';

  const standortHolen = () => {
    if (!navigator.geolocation) {
      setNaheStatus('abgelehnt');
      return;
    }
    setNaheStatus('sucht');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNahe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNaheStatus('an');
        setKartenBereich(null);
        setOrt(null);
        setzeZustand({ wo: '' });
        setZaehler((z) => z + 1);
      },
      () => setNaheStatus('abgelehnt'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const suchen = (was: string, wo: WoWahl) => {
    setKartenBereich(null);
    setGewaehlt(null);
    if (wo.art === 'nahe') {
      setzeZustand({ was });
      standortHolen();
      return;
    }
    if (wo.art === 'gleich') {
      setzeZustand({ was });
    } else if (wo.art === 'leer') {
      setNahe(null);
      setNaheStatus('aus');
      setzeZustand({ was, wo: '' });
    } else if (wo.art === 'ort') {
      setNahe(null);
      setNaheStatus('aus');
      setOrt(wo.ort);
      setOrtStatus('ok');
      setzeZustand({ was, wo: wo.ort.name });
    } else {
      setNahe(null);
      setNaheStatus('aus');
      setzeZustand({ was, wo: wo.text });
    }
    setZaehler((z) => z + 1);
  };

  const filterUmschalten = (f: Filter) =>
    setzeZustand({ filter: zustand.filter.includes(f) ? zustand.filter.filter((x) => x !== f) : [...zustand.filter, f] }, true);

  // Klick auf eine Stecknadel: am Rechner zur Karte in der Liste scrollen, am Handy unten zeigen
  const waehlen = (id: string) => {
    setGewaehlt(id);
    setAktiv(id);
    if (window.matchMedia('(min-width: 1024px)').matches) karten.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const gewaehlterTreffer = alleTreffer.find((x) => x.laden.id === gewaehlt);
  const anzahl = e?.treffer.length ?? 0;
  const ueberschrift = !e
    ? ''
    : bereich && anzahl === 0 && !zustand.filter.length && !zustand.was
      ? t('In {ort} gibt es noch keinen Laden mit Dranzeit.', { ort: woAnzeige })
      : kartenBereich
        ? tn(anzahl, '{n} Laden im Kartenausschnitt', '{n} Läden im Kartenausschnitt')
        : bereich
          ? tn(anzahl, '{n} Laden in {ort}', '{n} Läden in {ort}', { ort: woAnzeige })
        : tn(anzahl, '{n} Laden mit Dranzeit', '{n} Läden mit Dranzeit');

  return (
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-4 pt-6 sm:px-6">
        {/* Am Handy in der Kartenansicht ohne Überschrift: die Karte bekommt den Platz */}
        <div className={cn('flex flex-col gap-1', ansicht === 'karte' && 'hidden lg:flex')}>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">{t('Läden finden')}</h1>
          <p className="text-muted-foreground">{t('Nummer ziehen oder Termin buchen – bei Friseuren und Barbershops in deiner Nähe.')}</p>
        </div>
        <SuchLeiste was={zustand.was} wo={woAnzeige} laeden={laeden} onSuchen={suchen} />

        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label={t('Filter')}>
          <button
            type="button"
            onClick={standortHolen}
            aria-pressed={naheStatus === 'an' && !zustand.wo && !kartenBereich}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
              naheStatus === 'an' && !zustand.wo && !kartenBereich ? 'border-foreground bg-foreground text-signal' : 'border-border bg-card hover:border-foreground',
            )}
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            {naheStatus === 'sucht' ? t('Standort wird gesucht …') : t('In meiner Nähe')}
          </button>
          {(Object.keys(FILTER_TEXT) as Filter[]).map((f) => {
            const an = zustand.filter.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={an}
                onClick={() => filterUmschalten(f)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors',
                  an ? 'border-signal bg-signal text-signal-foreground' : 'border-border bg-card hover:border-foreground',
                )}
              >
                {t(FILTER_TEXT[f])}
              </button>
            );
          })}
          <label className="ms-auto inline-flex shrink-0 items-center gap-2 ps-2 text-sm text-muted-foreground">
            {t('Sortieren')}
            <select
              className="h-9 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground"
              value={zustand.sortierung}
              onChange={(ev) => setzeZustand({ sortierung: ev.target.value as Sortierung }, true)}
            >
              {(Object.keys(SORT_TEXT) as Sortierung[])
                .filter((s) => s !== 'entfernung' || bereich)
                .map((s) => (
                  <option key={s} value={s}>
                    {t(SORT_TEXT[s])}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {naheStatus === 'abgelehnt' && (
          <p className="rounded-2xl bg-muted p-3 text-sm">{t('Du hast den Standort nicht freigegeben. Gib einfach oben einen Ort oder eine PLZ ein.')}</p>
        )}
        {ortStatus === 'nicht' && <p className="rounded-2xl bg-muted p-3 text-sm">{t('„{ort}“ haben wir nicht gefunden. Versuch es mit einer Postleitzahl oder einem Bezirk.', { ort: zustand.wo })}</p>}
        {ortStatus === 'fehler' && <p className="rounded-2xl bg-muted p-3 text-sm">{t('Die Ortssuche ist gerade nicht erreichbar. Versuch es gleich noch einmal oder wähl einen Bezirk.')}</p>}
      </div>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Liste */}
        <section aria-label={t('Ergebnisse')} className={cn('flex min-w-0 flex-col gap-3', ansicht === 'karte' && 'hidden lg:flex')}>
          {fehler ? (
            <div className="flex flex-col gap-3">
              <ConnectionProblem error={fehler} />
              <button type="button" className="self-start text-sm font-semibold underline" onClick={nochmal}>
                {t('Nochmal versuchen')}
              </button>
            </div>
          ) : !e ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('Läden werden geladen')}>
              <div className="h-44 animate-pulse rounded-3xl bg-muted" />
              <div className="h-44 animate-pulse rounded-3xl bg-muted" />
            </div>
          ) : (
            <>
              <h2 className="font-display text-lg font-bold" aria-live="polite">
                {ortStatus === 'sucht' ? t('Ort wird gesucht …') : ueberschrift}
              </h2>
              {e.wartetAufZeiten && <p className="text-sm text-muted-foreground">{t('Freie Zeiten werden geladen …')}</p>}
              {e.treffer.map((x) => (
                <TrefferKarte
                  key={x.laden.id}
                  ref={(el) => (karten.current[x.laden.id] = el)}
                  treffer={x}
                  frei={frei[x.laden.id]}
                  jetzt={jetzt}
                  aktiv={aktiv === x.laden.id || gewaehlt === x.laden.id}
                  onHover={setAktiv}
                />
              ))}
              {e.treffer.length === 0 && !e.wartetAufZeiten && (zustand.filter.length > 0 || !!zustand.was || !bereich) && (
                <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
                  <p className="font-semibold">
                    {zustand.filter.length > 0 ? t('Mit diesen Filtern passt gerade kein Laden.') : t('Dazu haben wir keinen Laden gefunden.')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {zustand.filter.length > 0 && (
                      <button type="button" className="text-sm font-semibold underline" onClick={() => setzeZustand({ filter: [] }, true)}>
                        {t('Filter zurücksetzen')}
                      </button>
                    )}
                    {zustand.was && (
                      <button type="button" className="text-sm font-semibold underline" onClick={() => setzeZustand({ was: '' })}>
                        {t('Alle Leistungen zeigen')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {e.weiter.length > 0 && (
                <>
                  <h3 className="pt-2 font-display text-base font-bold">{t('Etwas weiter weg')}</h3>
                  {e.weiter.map((x) => (
                    <TrefferKarte
                      key={x.laden.id}
                      ref={(el) => (karten.current[x.laden.id] = el)}
                      treffer={x}
                      frei={frei[x.laden.id]}
                      jetzt={jetzt}
                      aktiv={aktiv === x.laden.id || gewaehlt === x.laden.id}
                      onHover={setAktiv}
                    />
                  ))}
                </>
              )}
              {e.salons.length > 0 && (
                <>
                  <h3 className="pt-3 font-display text-base font-bold">{t('Weitere Salons in der Nähe')}</h3>
                  <p className="-mt-1 text-sm text-muted-foreground">{t('Noch ohne Dranzeit – Adresse, Zeiten und Preise auf ihrer Seite.')}</p>
                  {e.salons.slice(0, 20).map((s) => (
                    <SalonZeile key={s.salon.id} treffer={s} />
                  ))}
                </>
              )}
              <p className="pt-2 text-sm text-muted-foreground">
                {t('Dein Laden fehlt?')}{' '}
                <Link to="/features" className="font-semibold text-foreground underline">
                  {t('So kommst du zu Dranzeit')}
                </Link>
              </p>
            </>
          )}
        </section>

        {/* Karte: am Rechner rechts und mitlaufend, am Handy über den Knopf unten */}
        <div className={cn('min-w-0 lg:sticky lg:top-20 lg:block lg:h-[calc(100dvh-6.5rem)]', ansicht === 'karte' ? 'relative h-[calc(100dvh-14rem)]' : 'hidden')}>
          {daten && (
            <SuchKarte
              treffer={alleTreffer}
              salons={e?.salons ?? []}
              frei={frei}
              jetzt={jetzt}
              aktivId={aktiv ?? gewaehlt}
              onAktiv={setAktiv}
              onWaehlen={waehlen}
              mitte={bereich && 'mitte' in bereich ? bereich.mitte : null}
              nahe={nahe}
              fokus={e && bereich ? (e.treffer.length ? e.treffer : e.weiter.slice(0, 1)).map((x) => x.laden.id) : undefined}
              zaehler={zaehler}
              onBereichSuchen={(g) => {
                setKartenBereich(g);
                setGewaehlt(null);
              }}
            />
          )}
          {/* Handy: gewählter Laden unten über der Karte */}
          {ansicht === 'karte' && gewaehlterTreffer && (
            <div className="absolute inset-x-2 bottom-2 z-[1000] pt-4 lg:hidden">
              <div className="relative">
                <button
                  type="button"
                  className="absolute -top-4 end-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md"
                  aria-label={t('Schließen')}
                  onClick={() => setGewaehlt(null)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                <TrefferKarte treffer={gewaehlterTreffer} frei={frei[gewaehlterTreffer.laden.id]} jetzt={jetzt} kompakt />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Handy: zwischen Liste und Karte wechseln */}
      {daten && (
        <button
          type="button"
          onClick={() => setAnsicht((a) => (a === 'liste' ? 'karte' : 'liste'))}
          className={cn(
            'fixed bottom-5 left-1/2 z-40 inline-flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 font-semibold text-signal shadow-lg lg:hidden',
            ansicht === 'karte' && gewaehlterTreffer && 'hidden',
          )}
        >
          {ansicht === 'liste' ? <KartenIcon className="h-4 w-4" aria-hidden="true" /> : <List className="h-4 w-4" aria-hidden="true" />}
          {ansicht === 'liste' ? t('Karte') : t('Liste')}
        </button>
      )}
    </div>
  );
};

export default ShopMap;
