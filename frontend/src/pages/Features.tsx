import { Link } from "react-router-dom";
import { CalendarClock, Megaphone, QrCode, Store, Users, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ticket } from "../components/brand/Ticket";

// Nur, was die App heute wirklich kann – keine Erinnerungen/SMS versprechen
const FEATURES = [
  {
    icon: QrCode,
    title: "QR-Code an die Tür",
    text: "Kunden scannen, wählen Leistung und Person und ziehen eine Nummer. Ohne App, ohne Konto.",
  },
  {
    icon: Megaphone,
    title: "Tresen mit einem Knopf",
    text: "Pro Person siehst du, wer dran ist und wer als Nächstes kommt. „Nächste Nummer aufrufen“ – fertig.",
  },
  {
    icon: CalendarClock,
    title: "Feste Termine und Schlange in einem",
    text: "Gebuchte Termine und spontane Nummern landen im selben Tag. Freie Zeiten ergeben sich aus Arbeitszeiten und Leistungen.",
  },
  {
    icon: ArrowUpRight,
    title: "Früher dran",
    text: "Wer möchte, bekommt einen früheren Platz angeboten, wenn einer frei wird – und nimmt ihn mit einem Tipp.",
  },
  {
    icon: Users,
    title: "Team mit eigenem Tag",
    text: "Lade Leute per Link ein. Jede Person sieht unter „Mein Tag“ nur ihre eigenen Kunden.",
  },
  {
    icon: Store,
    title: "Gefunden werden",
    text: "Dein Laden erscheint in der Shop-Suche und auf der Karte – mit Leistungen, Preisen und Öffnungszeiten.",
  },
];

export default function Features() {
  return (
    <div className="flex flex-col">
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr] md:py-20">
        <div className="flex flex-col gap-5">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Für Betriebe</p>
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-[-0.04em] sm:text-6xl">
            Volles Wartezimmer? Muss nicht sein.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            q-me ordnet Laufkundschaft und feste Termine in eine Reihenfolge. Deine Kunden warten draußen statt im Laden – und
            kommen zurück, wenn sie dran sind.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" size="lg" asChild>
              <Link to="/register-shop-owner">Betrieb anmelden</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/login">Anmelden</Link>
            </Button>
          </div>
        </div>
        <Ticket
          size="lg"
          eyebrow="Tresen · Jetzt dran"
          eyebrowRight="Haarschnitt · Alex"
          number="31"
          stats={[
            { label: "Wartet noch", value: "4" },
            { label: "Nächste um", value: "14:20" },
          ]}
          className="mx-auto w-full max-w-sm rotate-[1.5deg]"
        />
      </section>

      <section className="bg-foreground py-16 text-background md:py-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6">
          <h2 className="max-w-2xl font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Was du damit machst</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.06] p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-signal text-signal-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-xl font-bold">{title}</h3>
                <p className="text-sm text-white/75">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 md:py-20">
        <h2 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">In drei Schritten startklar</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            ["Laden anlegen", "Name, Adresse, Öffnungszeiten. Dauert zwei Minuten."],
            ["Leistungen und Team", "Was man buchen kann, wie lange es dauert und wer es macht."],
            ["QR-Code aufhängen", "Ausdrucken, an Tür oder Tresen kleben. Ab jetzt reihen sich Kunden selbst ein."],
          ].map(([title, text], i) => (
            <li key={title} className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-6">
              <span className="font-mono text-4xl font-bold">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-display text-xl font-bold">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-signal">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-14 text-signal-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Probier’s mit deinem Laden aus.</h2>
            <p className="mt-1">Einrichten dauert ein paar Minuten.</p>
          </div>
          <Button size="lg" asChild>
            <Link to="/register-shop-owner">Betrieb anmelden</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
