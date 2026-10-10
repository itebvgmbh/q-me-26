import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnonymousBookingHandler } from '../components/AnonymousBookingHandler';
import { MarketplaceSection } from '../components/MarketplaceSection';
import { Ticket } from '../components/brand/Ticket';

const STEPS = [
  {
    nr: '01',
    title: 'Nummer ziehen',
    text: 'Shop und Leistung wählen. Ein Konto brauchst du dafür nicht.',
  },
  {
    nr: '02',
    title: 'Weitermachen',
    text: 'Du bekommst eine Nummer und eine ungefähre Uhrzeit. Bis dahin bist du frei.',
  },
  {
    nr: '03',
    title: 'Früher dran',
    text: 'Mit Konto bieten wir dir automatisch einen früheren Platz an, sobald einer frei wird.',
  },
];

/** Startseite im Stil "Wartemarke" */
export default function App() {
  return (
    <div>
      {/* Verknüpft anonyme Buchungen nach dem Anmelden */}
      <AnonymousBookingHandler />

      <section className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-14 gap-y-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
          <h1 className="text-balance font-display text-[44px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-6xl lg:text-[84px]">
            Nummer ziehen. Rausgehen. Pünktlich zurück sein.
          </h1>
          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Reih dich bei deinem Friseur von unterwegs in die Schlange ein oder buch einen festen Termin – ohne Anruf und
            ohne Wartezimmer.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link to="/public-join-queue">In die Schlange</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/book-appointment?fromMarketplace=true">Termin buchen</Link>
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] justify-center" aria-hidden="true">
          <Ticket
            className="w-[320px] max-w-full -rotate-3 shadow-[0_30px_60px_-30px_rgba(20,20,20,0.45)]"
            eyebrow="Deine Nummer"
            eyebrowRight="Herrenschnitt"
            number="A14"
            stats={[
              { label: 'Vor dir', value: '3' },
              { label: 'Dran um ca.', value: '11:52' },
            ]}
          />
        </div>
      </section>

      <section id="shops" className="bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Shops in deiner Nähe</h2>
            <Link to="/shop-map" className="inline-flex items-center gap-1.5 font-semibold text-signal hover:underline">
              Auf der Karte ansehen <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <MarketplaceSection />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-8 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">So läuft’s</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.nr} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-6">
              <span className="font-mono text-sm font-bold text-muted-foreground">{step.nr}</span>
              <h3 className="font-display text-2xl font-bold">{step.title}</h3>
              <p className="leading-relaxed text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-8 rounded-3xl bg-signal p-8 text-signal-foreground sm:p-12">
          <h2 className="min-w-0 flex-[1_1_420px] text-balance font-display text-4xl font-extrabold leading-none tracking-[-0.04em] sm:text-5xl">
            Dein Laden ohne volles Wartezimmer.
          </h2>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <p className="text-lg leading-relaxed">
              Laufkundschaft reiht sich per QR-Code selbst ein. Termine und Schlange siehst du am Tresen in einer
              Ansicht.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/register-shop-owner">Kostenlos testen</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/features">Mehr erfahren</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
