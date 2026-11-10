import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { ArrowUpRight, Phone, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Ticket } from '../components/brand/Ticket';
import { HILFE_MAIL } from '../components/HilfeLink';
import { PLANS, euro } from '../utils/plans';
import { TELEFON_PREIS } from '../utils/telefon-assistent';
import { useTelefonOffen } from '../utils/telefon-hinweis';
import { inStoreApp } from '../utils/app-shell';
import { STANDARD, WOCHEN_JE_MONAT, rechne, type Eingaben } from '../utils/ersparnis';
import { intlSprache, istRtl, t, tn, tTeile } from '@/i18n';

/**
 * Ersparnis-Rechner für Inhaber: Was bringt Dranzeit im Monat, wenn der Telefon-Assistent ans Telefon geht und Absagen
 * neu besetzt werden – gegengerechnet mit Abo und Assistent. Rechnung in utils/ersparnis.ts (Test: dev/ersparnis.test.mjs).
 * Ersetzt die Vergleichsseite, die nach salonlotse.de umgezogen ist (backend/app/vergleich.py).
 */
export default function Rechner() {
  // In der App aus dem Store wird nichts verkauft (utils/app-shell.ts)
  return inStoreApp() ? <Navigate to="/features" replace /> : <RechnerSeite />;
}

const TARIFE = Object.values(PLANS);

const geld = (betrag: number, vorzeichen = false) =>
  new Intl.NumberFormat(intlSprache(), {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    signDisplay: vorzeichen ? 'exceptZero' : 'auto',
  }).format(Math.round(betrag));
const zahl = (wert: number, stellen = 1) => new Intl.NumberFormat(intlSprache(), { maximumFractionDigits: stellen }).format(wert);
const prozent = (anteil: number) => new Intl.NumberFormat(intlSprache(), { style: 'percent' }).format(anteil);
const minuten = (wert: number) => t('{n} Min.', { n: zahl(wert) });

function RechnerSeite() {
  const [e, setE] = useState<Eingaben>(STANDARD);
  const setze = <K extends keyof Eingaben>(feld: K) => (wert: Eingaben[K]) => setE((alt) => ({ ...alt, [feld]: wert }));
  const r = useMemo(() => rechne(e, TARIFE, TELEFON_PREIS), [e]);
  const telefonOffen = useTelefonOffen();
  const tarifName = t(PLANS[r.tarif.id as keyof typeof PLANS].name);

  // Schmale Bildschirme: Das Ergebnis steht unter den Eingaben – bis man dort ist, zeigt eine Leiste unten die Summe
  const ergebnisRef = useRef<HTMLElement>(null);
  const [ergebnisUnten, setErgebnisUnten] = useState(true);
  useEffect(() => {
    const ziel = ergebnisRef.current;
    if (!ziel || typeof IntersectionObserver === 'undefined') return;
    const beobachter = new IntersectionObserver(([eintrag]) => {
      setErgebnisUnten(!eintrag.isIntersecting && eintrag.boundingClientRect.top > 0);
    });
    beobachter.observe(ziel);
    return () => beobachter.disconnect();
  }, []);

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-8 pt-12 sm:px-6 md:pt-16">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Ersparnis-Rechner')}</p>
        <h1 className="max-w-3xl text-balance font-display text-5xl font-extrabold leading-[0.95] tracking-[-0.04em] sm:text-6xl">
          {t('Was bringt dir Dranzeit im Monat?')}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          {t('Jeder Anruf holt dich vom Stuhl, jede Absage reißt eine Lücke in den Tag. Stell ein, wie es bei dir läuft – wir rechnen gegen, was Dranzeit kostet.')}
        </p>
      </section>

      <section className="mx-auto grid w-full max-w-6xl items-start gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-4">
          <Baustein icon={Store} titel={t('Dein Laden')} an>
            <Feld
              label={t('Leute am Stuhl')}
              hilfe={t('Danach richtet sich der Tarif: {tarif} für {preis} im Monat.', { tarif: tarifName, preis: euro(r.tarif.monthly) })}
              wert={e.personen}
              anzeige={zahl(e.personen, 0)}
              min={1}
              max={10}
              schritt={1}
              onChange={setze('personen')}
            />
            <Feld
              label={t('Öffnungstage pro Woche')}
              wert={e.tageJeWoche}
              anzeige={zahl(e.tageJeWoche, 0)}
              min={1}
              max={7}
              schritt={1}
              onChange={setze('tageJeWoche')}
            />
            <Feld
              label={t('Umsatz je Kunde, netto')}
              hilfe={t('Im Schnitt, ohne Mehrwertsteuer.')}
              wert={e.umsatzJeKunde}
              anzeige={geld(e.umsatzJeKunde)}
              min={10}
              max={150}
              schritt={1}
              onChange={setze('umsatzJeKunde')}
            />
            <Feld
              label={t('Dauer je Kunde')}
              wert={e.minutenJeKunde}
              anzeige={minuten(e.minutenJeKunde)}
              min={10}
              max={120}
              schritt={5}
              onChange={setze('minutenJeKunde')}
            />
          </Baustein>

          <Baustein
            icon={Phone}
            titel={t('Telefon-Assistent')}
            text={t('Statt dass du vom Stuhl ans Telefon läufst, nimmt eine KI den Anruf an: Sie nennt freie Termine, bucht sie und zieht Nummern.')}
            an={e.telefon}
            onAn={setze('telefon')}
            hinweis={
              !telefonOffen &&
              tTeile('Im Testbetrieb auf Anfrage: <mail/>', {
                mail: () => (
                  <a href={`mailto:${HILFE_MAIL}`} dir="ltr" className="underline underline-offset-4">
                    {HILFE_MAIL}
                  </a>
                ),
              })
            }
          >
            <Feld
              label={t('Anrufe am Tag')}
              hilfe={t('Im ganzen Laden.')}
              wert={e.anrufeJeTag}
              anzeige={zahl(e.anrufeJeTag, 0)}
              min={0}
              max={60}
              schritt={1}
              onChange={setze('anrufeJeTag')}
            />
            <Feld
              label={t('So lange hält dich ein Anruf auf')}
              hilfe={t('Hingehen, Hände abwischen, Kalender, zurück zum Kunden.')}
              wert={e.minutenJeAnruf}
              anzeige={minuten(e.minutenJeAnruf)}
              min={0.5}
              max={10}
              schritt={0.5}
              onChange={setze('minutenJeAnruf')}
            />
            <Feld
              label={t('Davon wird Kundenzeit')}
              hilfe={t('An vollen Tagen fast alles, an ruhigen weniger.')}
              wert={Math.round(e.anteilKundenzeit * 100)}
              anzeige={prozent(e.anteilKundenzeit)}
              min={0}
              max={100}
              schritt={10}
              onChange={(wert) => setze('anteilKundenzeit')(wert / 100)}
            />
            <Feld
              label={t('Verpasste Anrufe pro Woche')}
              hilfe={t('Keiner kann ran, und der Kunde bucht woanders. Der Assistent geht immer ran.')}
              wert={e.verpassteJeWoche}
              anzeige={zahl(e.verpassteJeWoche, 0)}
              min={0}
              max={30}
              schritt={1}
              onChange={setze('verpassteJeWoche')}
            />
            <Feld
              label={t('Gesprächsdauer mit dem Assistenten')}
              hilfe={t('Zählt für den Preis: {inklusiv} Minuten im Monat inklusive, danach {minute} je Minute.', {
                inklusiv: TELEFON_PREIS.inklusiv,
                minute: euro(TELEFON_PREIS.minute),
              })}
              wert={e.gespraechMinuten}
              anzeige={minuten(e.gespraechMinuten)}
              min={0.5}
              max={5}
              schritt={0.5}
              onChange={setze('gespraechMinuten')}
            />
          </Baustein>

          <Baustein
            icon={ArrowUpRight}
            titel={t('Nachrücken')}
            text={t('Sagt jemand ab oder kommt nicht, rückt die Schlange nach, und Wartende bekommen den frei gewordenen Platz per „Früher dran“ angeboten.')}
            an={e.nachruecken}
            onAn={setze('nachruecken')}
          >
            <Feld
              label={t('Absagen, No-Shows und Lücken pro Woche')}
              hilfe={t('Im ganzen Laden.')}
              wert={e.lueckenJeWoche}
              anzeige={zahl(e.lueckenJeWoche, 0)}
              min={0}
              max={40}
              schritt={1}
              onChange={setze('lueckenJeWoche')}
            />
            <Feld
              label={t('Davon neu besetzt')}
              hilfe={t('Je mehr Laufkundschaft und Wartende, desto mehr.')}
              wert={Math.round(e.anteilNachbesetzt * 100)}
              anzeige={prozent(e.anteilNachbesetzt)}
              min={0}
              max={100}
              schritt={10}
              onChange={(wert) => setze('anteilNachbesetzt')(wert / 100)}
            />
          </Baustein>
        </div>

        <aside ref={ergebnisRef} id="ergebnis" aria-live="polite" className="flex min-w-0 scroll-mt-24 flex-col gap-5 lg:sticky lg:top-24">
          <Ticket
            className="-rotate-1 drop-shadow-[0_18px_18px_rgba(20,20,20,0.2)]"
            eyebrow={t('Unterm Strich')}
            eyebrowRight={t('im Monat')}
            number={<span className="text-[48px] sm:text-[56px]">{geld(r.plusMonat, true)}</span>}
            stats={[
              { label: t('Im Jahr'), value: geld(r.plusJahr, true) },
              { label: t('Mehr Kunden'), value: zahl(r.mehrKunden, 0) },
            ]}
          />

          <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <dl className="flex flex-col divide-y divide-border">
              {r.telefon && (
                <>
                  <Zeile
                    titel={t('Zeit vom Telefon zurück')}
                    unter={t('{stunden} Std. · {kunden} Kunden', { stunden: zahl(r.telefon.stunden), kunden: zahl(r.telefon.kundenAusZeit, 0) })}
                    betrag={r.telefon.umsatzAusZeit}
                  />
                  <Zeile
                    titel={t('Verpasste Anrufe angenommen')}
                    unter={tn(Math.round(r.telefon.kundenAusVerpassten), '{n} Kunde', '{n} Kunden')}
                    betrag={r.telefon.umsatzAusVerpassten}
                  />
                </>
              )}
              {r.nachruecken && (
                <Zeile
                  titel={t('Lücken neu besetzt')}
                  unter={tn(Math.round(r.nachruecken.kunden), '{n} Kunde', '{n} Kunden')}
                  betrag={r.nachruecken.umsatz}
                />
              )}
              <Zeile
                titel={t('Tarif {tarif}', { tarif: tarifName })}
                unter={tn(r.tarif.maxStaff, 'für {n} Person', 'bis {n} Leute')}
                betrag={-r.tarif.monthly}
              />
              {r.telefon && (
                <Zeile
                  titel={t('Telefon-Assistent')}
                  unter={t('{n} Gesprächsminuten', { n: zahl(r.telefon.minuten, 0) })}
                  betrag={-r.telefon.kosten}
                />
              )}
              <Zeile titel={t('Unterm Strich im Monat')} betrag={r.plusMonat} summe />
            </dl>
            <p className="text-sm text-muted-foreground">
              {r.plusMonat > 0
                ? tn(
                    r.kundenFuerKosten,
                    'Schon {n} zusätzlicher Kunde im Monat bezahlt Dranzeit.',
                    'Schon {n} zusätzliche Kunden im Monat bezahlen Dranzeit.',
                  )
                : t('Mit diesen Zahlen rechnet sich Dranzeit noch nicht. Stell ein, wie es an vollen Tagen bei dir aussieht, oder schalte einen Baustein ab.')}
            </p>
            {r.telefon && r.telefon.kosten > TELEFON_PREIS.deckel && (
              <p className="text-sm text-muted-foreground">
                {t('Bei so vielen Minuten den Kostendeckel des Assistenten auf mindestens {betrag} stellen. Ohne eigene Angabe hört er bei {deckel} im Monat auf.', {
                  betrag: geld(Math.ceil(r.telefon.kosten)),
                  deckel: euro(TELEFON_PREIS.deckel),
                })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" asChild>
                <Link to="/register-shop-owner">{t('Kostenlos testen')}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/preise">{t('Preise ansehen')}</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('30 Tage mit allen Funktionen, ohne Zahlungsdaten.')}</p>
          </div>
        </aside>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-14 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em]">{t('So rechnen wir')}</h2>
          <ul className="flex list-disc flex-col gap-3 ps-5 text-muted-foreground marker:text-foreground">
            <li>
              {t('Ein Monat hat bei uns {wochen} Wochen (52 durch 12). Deine Arbeitstage im Monat sind die Öffnungstage mal {wochen}.', {
                wochen: zahl(WOCHEN_JE_MONAT, 2),
              })}
            </li>
            <li>
              {t('Telefon: Anrufe am Tag mal Minuten je Anruf mal Arbeitstage ist die Zeit, die du nicht mehr am Telefon verbringst. Der Teil davon, der zu Kundenzeit wird, geteilt durch die Dauer je Kunde, ergibt die zusätzlichen Kunden.')}
            </li>
            <li>
              {t('Verpasste Anrufe: Wer heute niemanden erreicht und woanders bucht, erreicht den Assistenten. Pro Woche mal {wochen}, mal Umsatz je Kunde.', {
                wochen: zahl(WOCHEN_JE_MONAT, 2),
              })}
            </li>
            <li>
              {t('Nachrücken: Lücken pro Woche mal {wochen}, mal dem Teil, der neu besetzt wird, mal Umsatz je Kunde.', {
                wochen: zahl(WOCHEN_JE_MONAT, 2),
              })}
            </li>
            <li>
              {t('Kosten: der Tarif nach Leuten am Stuhl (Solo {solo}, Laden {laden} bis {maxLaden} Leute, Team {team} bis {maxTeam} Leute) und der Telefon-Assistent für {grundpreis} im Monat mit {inklusiv} Minuten, danach {minute} je Minute. Gezählt werden nur die Minuten, in denen er spricht.', {
                solo: euro(PLANS.solo.monthly),
                laden: euro(PLANS.laden.monthly),
                maxLaden: PLANS.laden.maxStaff,
                team: euro(PLANS.team.monthly),
                maxTeam: PLANS.team.maxStaff,
                grundpreis: euro(TELEFON_PREIS.grundpreis),
                inklusiv: TELEFON_PREIS.inklusiv,
                minute: euro(TELEFON_PREIS.minute),
              })}
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            {t('Eine Schätzung, kein Versprechen: Wie viel davon ankommt, hängt davon ab, ob die Kunden da sind. Material und Steuern sind nicht abgezogen, alle Preise netto.')}
          </p>
        </div>
      </section>

      {/* Platzhalter, damit die Leiste unten nichts verdeckt */}
      <div className="h-16 lg:hidden" aria-hidden="true" />
      {ergebnisUnten && (
        <a
          href="#ergebnis"
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden print:hidden"
        >
          <span className="text-sm font-semibold">{t('Unterm Strich im Monat')}</span>
          <span className="font-mono text-xl font-bold">{geld(r.plusMonat, true)}</span>
        </a>
      )}
    </div>
  );
}

function Baustein({
  icon: Icon,
  titel,
  text,
  an,
  onAn,
  hinweis,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  titel: string;
  text?: string;
  an: boolean;
  onAn?: (an: boolean) => void;
  hinweis?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-signal text-signal-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={id} className="font-display text-xl font-bold">
            {titel}
          </h2>
          {text && <p className="text-sm text-muted-foreground">{text}</p>}
          {hinweis && <p className="text-sm font-semibold">{hinweis}</p>}
        </div>
        {onAn && (
          <Switch checked={an} onCheckedChange={onAn} aria-label={t('{baustein} einrechnen', { baustein: titel })} className="mt-2" />
        )}
      </div>
      {an && <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">{children}</div>}
    </section>
  );
}

function Feld({
  label,
  hilfe,
  wert,
  anzeige,
  min,
  max,
  schritt,
  onChange,
}: {
  label: string;
  hilfe?: string;
  wert: number;
  anzeige: string;
  min: number;
  max: number;
  schritt: number;
  onChange: (wert: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={id} className="text-sm font-semibold">
          {label}
        </span>
        <span className="shrink-0 font-mono text-lg font-bold" aria-hidden="true">
          {anzeige}
        </span>
      </div>
      <SliderPrimitive.Root
        value={[wert]}
        min={min}
        max={max}
        step={schritt}
        dir={istRtl() ? 'rtl' : 'ltr'}
        onValueChange={([neu]) => onChange(neu)}
        className="relative flex h-7 w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-foreground/15">
          <SliderPrimitive.Range className="absolute h-full bg-foreground" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-labelledby={id}
          aria-valuetext={anzeige}
          className="block h-6 w-6 rounded-full border-2 border-foreground bg-signal shadow transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        />
      </SliderPrimitive.Root>
      {hilfe && <p className="text-xs leading-relaxed text-muted-foreground">{hilfe}</p>}
    </div>
  );
}

function Zeile({ titel, unter, betrag, summe = false }: { titel: string; unter?: string; betrag: number; summe?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0', summe && 'border-t-2 !border-foreground')}>
      <dt className="flex min-w-0 flex-col">
        <span className={cn('text-sm', summe ? 'font-bold' : 'font-semibold')}>{titel}</span>
        {unter && <span className="text-xs text-muted-foreground">{unter}</span>}
      </dt>
      <dd className={cn('shrink-0 font-mono font-bold', summe ? 'text-xl' : 'text-base', betrag < 0 && !summe && 'text-muted-foreground')}>
        {geld(betrag, true)}
      </dd>
    </div>
  );
}
