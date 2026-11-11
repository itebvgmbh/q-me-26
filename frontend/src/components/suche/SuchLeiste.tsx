import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LocateFixed, MapPin, Scissors, Search, Store, Tag, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { istPlz, ortVorschlaege, wasVorschlaege, type Ort, type SuchLaden, type SuchSalon } from '../../utils/suche';
import { gruppenWahl, ORTE } from '../../utils/suche-daten';

/** Was gewählt wurde: ein Ort aus der Liste, eigener Standort, freier Text (PLZ, Adresse) oder nichts */
/** gleich: Ort nicht angefasst, nur „Was?“ geändert */
export type WoWahl = { art: 'ort'; ort: Ort } | { art: 'nahe' } | { art: 'text'; text: string } | { art: 'leer' } | { art: 'gleich' };

type Vorschlag = { id: string; text: string; zusatz?: string; icon: ReactNode; gruppe: string; waehlen: () => void };

const BERLIN: Ort = { name: 'Berlin', typ: 'stadt', lat: 52.517, lng: 13.389 };

/** Eingabefeld mit Vorschlagsliste (Combobox nach WAI-ARIA): Pfeiltasten, Enter, Escape */
function Feld({
  id,
  label,
  platzhalter,
  icon,
  wert,
  setWert,
  vorschlaege,
  onEnter,
  autoFocus,
}: {
  id: string;
  label: string;
  platzhalter: string;
  icon: ReactNode;
  wert: string;
  setWert: (v: string) => void;
  vorschlaege: Vorschlag[];
  onEnter: () => void;
  autoFocus?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(-1);
  const liste = `${id}-liste`;
  const sichtbar = offen && vorschlaege.length > 0;
  useEffect(() => setAktiv(-1), [wert]);

  const taste = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && vorschlaege.length) {
      e.preventDefault();
      setOffen(true);
      setAktiv((a) => (a + 1) % vorschlaege.length);
    } else if (e.key === 'ArrowUp' && vorschlaege.length) {
      e.preventDefault();
      setAktiv((a) => (a <= 0 ? vorschlaege.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sichtbar && aktiv >= 0) vorschlaege[aktiv].waehlen();
      else onEnter();
      setOffen(false);
    } else if (e.key === 'Escape') {
      setOffen(false);
    }
  };

  let letzteGruppe = '';
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {/* Fokus zeigt das ganze Feld (rund), nicht das Eingabefeld als Kasten */}
      <div className="flex h-full items-center gap-2 rounded-[26px] px-4 focus-within:bg-muted/60">
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col py-1.5">
          <span className="text-xs font-semibold text-muted-foreground" aria-hidden="true">
            {label}
          </span>
          <input
            id={id}
            role="combobox"
            aria-expanded={sichtbar}
            aria-controls={liste}
            aria-autocomplete="list"
            aria-activedescendant={sichtbar && aktiv >= 0 ? `${id}-v${aktiv}` : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            enterKeyHint="search"
            className="w-full min-w-0 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder={platzhalter}
            value={wert}
            onChange={(e) => {
              setWert(e.target.value);
              setOffen(true);
            }}
            onFocus={() => setOffen(true)}
            onBlur={() => setTimeout(() => setOffen(false), 150)}
            onKeyDown={taste}
          />
        </div>
        {wert && (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5"
            aria-label={t('Eingabe löschen')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setWert('')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {sichtbar && (
        <ul
          id={liste}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-[1100] mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-lg"
        >
          {vorschlaege.map((v, i) => {
            const kopf = v.gruppe !== letzteGruppe ? v.gruppe : '';
            letzteGruppe = v.gruppe;
            return (
              <li key={v.id} role="presentation">
                {kopf && <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{kopf}</p>}
                <div
                  id={`${id}-v${i}`}
                  role="option"
                  aria-selected={i === aktiv}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5',
                    i === aktiv ? 'bg-signal/40' : 'hover:bg-foreground/5',
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    v.waehlen();
                    setOffen(false);
                  }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true">
                    {v.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-medium">{v.text}</span>
                    {v.zusatz && <span className="truncate text-xs text-muted-foreground">{v.zusatz}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const ortZusatz = (o: Ort) =>
  o.typ === 'bezirk' ? t('Bezirk in Berlin') : o.typ === 'ortsteil' ? t('Ortsteil in {bezirk}', { bezirk: o.bezirk ?? 'Berlin' }) : '';

/**
 * Suche oben auf „Läden finden“: Was? (Leistung oder Laden) und Wo? (Ort, PLZ, eigener Standort). Am Handy eine
 * Zeile zum Antippen, die die Suche im Vollbild öffnet; ab md beide Felder nebeneinander.
 */
export function SuchLeiste({
  was,
  wo,
  laeden,
  salons = [],
  onSuchen,
}: {
  was: string;
  /** Anzeige des gewählten Orts („Pankow“, „In deiner Nähe“, „Kartenausschnitt“) */
  wo: string;
  laeden: SuchLaden[];
  /** Salons ohne Dranzeit: ihre Leistungsgruppen kommen in die Vorschläge */
  salons?: SuchSalon[];
  onSuchen: (was: string, wo: WoWahl) => void;
}) {
  const id = useId();
  const [eWas, setEWas] = useState(was);
  const [eWo, setEWo] = useState(wo);
  const [woWahl, setWoWahl] = useState<WoWahl | null>(null);
  const [vollbild, setVollbild] = useState(false);
  const gesucht = useRef({ was, wo });

  // Neue Suche von außen (Adresse, Zurück-Taste, Kartenausschnitt): Felder nachziehen
  useEffect(() => {
    setEWas(was);
    setEWo(wo);
    setWoWahl(null);
    gesucht.current = { was, wo };
  }, [was, wo]);

  const abschicken = (wahl: WoWahl | null = woWahl, wasText = eWas) => {
    let w: WoWahl;
    if (wahl) w = wahl;
    else if (!eWo.trim()) w = { art: 'leer' };
    else if (eWo.trim() === gesucht.current.wo) w = { art: 'gleich' };
    else w = { art: 'text', text: eWo.trim() };
    onSuchen(wasText.trim(), w);
    setVollbild(false);
  };

  // Erst die festen Leistungsgruppen (passen über alle Läden), dann einzelne Leistungen, dann Läden
  const wasListe = wasVorschlaege(eWas, laeden, 5, gruppenWahl(), salons);
  const wasVorschlaegeListe: Vorschlag[] = [
    ...wasListe.gruppen.map((g) => ({
      id: `g-${g.key}`,
      text: g.name,
      icon: <Tag className="h-4 w-4" />,
      gruppe: eWas.trim() ? t('Leistungen') : t('Oft gesucht'),
      waehlen: () => setEWas(g.name),
    })),
    ...wasListe.leistungen.map((name) => ({
      id: `l-${name}`,
      text: name,
      icon: <Scissors className="h-4 w-4" />,
      gruppe: eWas.trim() ? t('Leistungen') : t('Oft gesucht'),
      waehlen: () => setEWas(name),
    })),
    ...wasListe.laeden.map((l) => ({
      id: `s-${l.id}`,
      text: l.name,
      zusatz: [l.ortsteil, l.city].filter(Boolean).join(', '),
      icon: <Store className="h-4 w-4" />,
      gruppe: t('Läden'),
      waehlen: () => setEWas(l.name),
    })),
  ];

  const waehleWo = (wahl: WoWahl, anzeige: string) => {
    setWoWahl(wahl);
    setEWo(anzeige);
  };
  const orte = ortVorschlaege(eWo, ORTE);
  const woVorschlaegeListe: Vorschlag[] = [
    {
      id: 'nahe',
      text: t('In meiner Nähe'),
      icon: <LocateFixed className="h-4 w-4" />,
      gruppe: '',
      waehlen: () => waehleWo({ art: 'nahe' }, t('In deiner Nähe')),
    },
    ...(istPlz(eWo)
      ? [{ id: 'plz', text: t('Postleitzahl {plz}', { plz: eWo.trim() }), icon: <MapPin className="h-4 w-4" />, gruppe: t('Orte'), waehlen: () => waehleWo({ art: 'text', text: eWo.trim() }, eWo.trim()) }]
      : []),
    ...orte.map((o) => ({
      id: `o-${o.typ}-${o.name}`,
      text: o.name,
      zusatz: ortZusatz(o),
      icon: <MapPin className="h-4 w-4" />,
      gruppe: t('Orte'),
      waehlen: () => waehleWo({ art: 'ort', ort: o }, o.name),
    })),
    ...(!eWo.trim()
      ? [{ id: 'berlin', text: t('Ganz Berlin'), icon: <MapPin className="h-4 w-4" />, gruppe: t('Orte'), waehlen: () => waehleWo({ art: 'ort', ort: BERLIN }, 'Berlin') }]
      : []),
  ];

  const felder = (imVollbild: boolean) => (
    <form
      role="search"
      aria-label={t('Läden suchen')}
      onSubmit={(e) => {
        e.preventDefault();
        abschicken();
      }}
      className={cn(
        'flex rounded-[28px] border border-border bg-card shadow-sm focus-within:border-foreground/40',
        imVollbild ? 'flex-col divide-y divide-border' : 'h-16 items-stretch divide-x divide-border',
      )}
    >
      <Feld
        id={`${id}-was`}
        label={t('Was?')}
        platzhalter={t('Leistung oder Laden, z. B. Herrenschnitt')}
        icon={<Search className="h-5 w-5" />}
        wert={eWas}
        setWert={setEWas}
        vorschlaege={wasVorschlaegeListe}
        onEnter={() => abschicken()}
        autoFocus={imVollbild}
      />
      <Feld
        id={`${id}-wo`}
        label={t('Wo?')}
        platzhalter={t('Bezirk, Ortsteil oder PLZ')}
        icon={<MapPin className="h-5 w-5" />}
        wert={eWo}
        setWert={(v) => {
          setEWo(v);
          setWoWahl(null);
        }}
        vorschlaege={woVorschlaegeListe}
        onEnter={() => abschicken()}
      />
      <div className={cn('flex items-center', imVollbild ? 'p-3' : 'pe-2')}>
        <button
          type="submit"
          className={cn(
            'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-5 font-semibold text-signal transition-colors hover:bg-foreground/90',
            imVollbild && 'w-full',
          )}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('Suchen')}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {/* Handy: eine Zeile zum Antippen */}
      <button
        type="button"
        onClick={() => setVollbild(true)}
        className="flex h-14 w-full items-center gap-3 rounded-full border border-border bg-card px-4 text-start shadow-sm md:hidden"
        aria-label={t('Suche öffnen')}
      >
        <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{was || t('Alle Leistungen')}</span>
          <span className="truncate text-xs text-muted-foreground">{wo || t('Überall')}</span>
        </span>
      </button>
      {vollbild && (
        <div className="fixed inset-0 z-[1200] flex flex-col gap-4 overflow-y-auto bg-background p-4 md:hidden" role="dialog" aria-modal="true" aria-label={t('Suche')}>
          <div className="flex items-center justify-between">
            <p className="font-display text-2xl font-bold">{t('Suche')}</p>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/5"
              aria-label={t('Schließen')}
              onClick={() => setVollbild(false)}
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          {felder(true)}
        </div>
      )}
      <div className="hidden md:block">{felder(false)}</div>
    </>
  );
}
