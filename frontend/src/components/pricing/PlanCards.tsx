import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { euro, gross, PLANS, type PlanId } from '../../utils/plans';
import type { Interval } from '../../utils/billing';

// Was in welchem Tarif steckt – Texte wie auf der Preisseite der Strategie
const INCLUDES: Record<PlanId, string[]> = {
  gratis: ['1 Person', 'bis 100 Kunden im Monat', 'Nummer ziehen per QR-Code', 'Tresen-Ansicht', 'Eintrag auf der Karte'],
  solo: ['1 Person, unbegrenzt Kunden', 'Online-Termine und Schlange in einem Tag', 'Früher dran', '„Gleich dran“-Nachricht per Push oder E-Mail', 'Termin-Erinnerungen'],
  laden: ['bis 4 Personen', 'alles aus Solo', 'Team mit „Mein Tag“', 'Wartezimmer-Bildschirm', 'Auswertung: Wartezeit, Kunden pro Tag'],
  team: ['bis 10 Personen', 'alles aus Laden', 'bevorzugter Support'],
};

const NOTES: Record<PlanId, string> = {
  gratis: 'Zum Ausprobieren und für kleine Läden.',
  solo: 'Ein Haarschnitt im Monat bezahlt den Tarif.',
  laden: 'Der typische Barbershop.',
  team: 'Mehr als 10 Personen? Schreib uns.',
};

interface Props {
  interval: Interval;
  /** aktueller Tarif (Mein Tarif) – wird markiert */
  current?: PlanId;
  /** Gründerpreis für Laden anzeigen */
  founder?: boolean;
  /** Knopf je Tarif; ohne: keine Knöpfe */
  action?: (plan: PlanId) => React.ReactNode;
}

export const PlanCards = ({ interval, current, founder = false, action }: Props) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {(Object.keys(PLANS) as PlanId[]).map((id) => {
      const plan = PLANS[id];
      const founderPrice = founder && id === 'laden';
      const net = interval === 'jahr' ? (founderPrice ? 190 : plan.yearly) : founderPrice ? 19 : plan.monthly;
      const recommended = id === 'laden';
      return (
        <article
          key={id}
          className={cn(
            'flex flex-col gap-4 rounded-3xl border bg-card p-6',
            recommended ? 'border-2 border-foreground' : 'border-border',
            current === id && 'ring-4 ring-signal',
          )}
        >
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-2xl font-extrabold">{plan.name}</h3>
            {current === id ? (
              <span className="rounded-full bg-signal px-2.5 py-0.5 text-xs font-bold text-signal-foreground">Dein Tarif</span>
            ) : recommended ? (
              <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-bold text-background">Empfohlen</span>
            ) : null}
          </header>
          <div className="flex flex-col gap-1">
            <p className="flex items-baseline gap-1.5">
              <span className="font-mono text-4xl font-bold tracking-tight">{euro(net)}</span>
              <span className="text-sm text-muted-foreground">{id === 'gratis' ? 'für immer' : interval === 'jahr' ? '/ Jahr' : '/ Monat'}</span>
            </p>
            {id !== 'gratis' && (
              <p className="font-mono text-xs text-muted-foreground">
                netto · {euro(gross(net))} inkl. MwSt.
                {founderPrice && ' · Gründerpreis'}
              </p>
            )}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {INCLUDES[id].map((line) => (
              <li key={line} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-auto border-t border-dashed border-border pt-3 text-sm text-muted-foreground">{NOTES[id]}</p>
          {action?.(id)}
        </article>
      );
    })}
  </div>
);

export const IntervalSwitch = ({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) => (
  <div role="radiogroup" aria-label="Zahlweise" className="inline-flex rounded-full border border-border bg-card p-1">
    {(['monat', 'jahr'] as Interval[]).map((v) => (
      <button
        key={v}
        type="button"
        role="radio"
        aria-checked={value === v}
        onClick={() => onChange(v)}
        className={cn('min-h-10 rounded-full px-4 text-sm font-semibold', value === v ? 'bg-foreground text-background' : 'text-muted-foreground')}
      >
        {v === 'monat' ? 'Monatlich' : 'Jährlich · 2 Monate geschenkt'}
      </button>
    ))}
  </div>
);
