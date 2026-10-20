import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { IntervalSwitch, PlanCards } from '../components/pricing/PlanCards';
import { getFoundersLeft, type Interval } from '../utils/billing';
import { FOUNDER_LIMIT } from '../utils/plans';
import { HILFE_MAIL } from '../components/HilfeLink';

const FAQ: [string, string][] = [
  ['Nehmt ihr Provision?', 'Nein. Du zahlst den festen Monatspreis, egal wie viele Kunden über Dranzeit kommen. Auch nicht für Neukunden.'],
  ['Wie lange kann ich testen?', '30 Tage mit allen Funktionen, ohne Zahlungsdaten. Danach läuft dein Laden im Gratis-Tarif weiter, bis du ein Abo wählst. Nichts verschwindet.'],
  ['Wie kündige ich?', 'Jederzeit unter „Tarif“, zum Ende des bezahlten Monats. Beim Jahresabo endet der Vertrag zum Ende des bezahlten Jahres.'],
  ['Wie bezahle ich?', 'Per SEPA-Lastschrift oder Karte. Die Rechnung kommt per E-Mail, beim Jahresabo einmal im Jahr.'],
  ['Ich bin Kleinunternehmer. Was zahle ich wirklich?', 'Die Preise sind netto. Wenn du keine Vorsteuer abziehen kannst, zählt der Bruttopreis, der unter jedem Preis steht.'],
  ['Brauchen meine Kunden eine App?', 'Nein. Sie scannen den QR-Code an der Tür, ziehen eine Nummer im Browser und bekommen Bescheid, kurz bevor sie dran sind.'],
];

export default function Preise() {
  const [interval, setInterval] = useState<Interval>('monat');
  const [foundersLeft, setFoundersLeft] = useState<number | null>(null);

  useEffect(() => {
    getFoundersLeft().then(setFoundersLeft);
  }, []);

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 md:py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Preise</p>
        <h1 className="max-w-3xl text-balance font-display text-5xl font-extrabold leading-[0.95] tracking-[-0.04em] sm:text-6xl">
          Ein fester Preis pro Laden. Keine Provision.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Volle Läden zahlen nicht mehr, weil sie voll sind. Monatlich kündbar, 30 Tage kostenlos testen, ohne Zahlungsdaten.
        </p>
        <IntervalSwitch value={interval} onChange={setInterval} />
        <PlanCards
          interval={interval}
          action={(plan) => (
            <Button variant={plan === 'laden' ? 'default' : 'outline'} asChild>
              <Link to="/register-shop-owner">{plan === 'gratis' ? 'Gratis starten' : '30 Tage testen'}</Link>
            </Button>
          )}
        />
      </section>

      {foundersLeft !== 0 && (
        <section className="bg-signal">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-12 text-signal-foreground sm:px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Gründerangebot für die ersten {FOUNDER_LIMIT} Läden</h2>
            <p className="max-w-2xl text-lg">
              3 Monate kostenlos, danach den Laden-Tarif dauerhaft für 19 € statt 39 € im Monat, solange du dabei bleibst.
              Dafür hängt unser QR-Plakat sichtbar an deiner Tür, und du sagst uns in den ersten 3 Monaten einmal im Monat, was dich stört.
            </p>
            {foundersLeft !== null && <p className="font-mono font-bold">Noch {foundersLeft} Plätze frei.</p>}
            <p className="text-sm">Den Platz sicherst du nach der Anmeldung unter „Tarif“.</p>
            <div>
              <Button size="lg" asChild>
                <Link to="/register-shop-owner">Gründerplatz sichern</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-14 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em]">Häufige Fragen</h2>
        <dl className="flex flex-col gap-5">
          {FAQ.map(([q, a]) => (
            <div key={q} className="flex flex-col gap-1 border-b border-border pb-5">
              <dt className="font-semibold">{q}</dt>
              <dd className="text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground">
          Noch Fragen? Mehr Antworten unter{' '}
          <a href="/hilfe/fragen-fuer-laeden" className="font-semibold text-foreground underline underline-offset-4">
            Häufige Fragen von Läden
          </a>
          , oder schreib uns an{' '}
          <a href={`mailto:${HILFE_MAIL}`} className="font-semibold text-foreground underline underline-offset-4">
            {HILFE_MAIL}
          </a>
          .
        </p>
        <p className="text-sm text-muted-foreground">
          Alle Preise netto zuzüglich Mehrwertsteuer, nur für Unternehmen. Es gelten unsere <Link to="/agb" className="underline underline-offset-2">AGB</Link>.
        </p>
      </section>
    </div>
  );
}
