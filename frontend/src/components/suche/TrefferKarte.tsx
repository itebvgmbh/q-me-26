import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, Phone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { intlSprache, t, tn } from '@/i18n';
import { oeffnungJetzt } from '../../utils/laden-live';
import { telLink, useTelefonAnnahme } from '../../utils/telefon-hinweis';
import { abPreis, type Frei, type SalonTreffer, type Treffer } from '../../utils/suche';
import { kmText, zeitKurz } from '../../utils/suche-daten';

const preis = (wert: number) => t('{preis} €', { preis: wert.toLocaleString(intlSprache(), { minimumFractionDigits: 0, maximumFractionDigits: 2 }) });

const uhrzeit = (iso: string) => new Date(iso).toLocaleTimeString(intlSprache(), { hour: 'numeric', minute: '2-digit' });

/** Adresse für die Buchung mit Laden, Leistung und (für eine freie Zeit) Person und Uhrzeit */
export const buchenLink = (pfad: '/public-join-queue' | '/book-appointment', shopId: string, serviceId?: string, extra: Record<string, string> = {}) =>
  `${pfad}?${new URLSearchParams({ shopId, ...(serviceId ? { serviceId } : {}), ...extra })}`;

/** Ein Laden in der Ergebnisliste: Lage, offen/zu, Wartende, wann man mit einer Nummer dran wäre, freie Termine */
export const TrefferKarte = forwardRef<
  HTMLElement,
  { treffer: Treffer; frei?: Frei; jetzt: Date; aktiv?: boolean; kompakt?: boolean; onHover?: (id: string | null) => void }
>(({ treffer, frei, jetzt, aktiv = false, kompakt = false, onHover }, ref) => {
  const { laden, km, leistung } = treffer;
  const oeffnung = oeffnungJetzt(laden, jetzt);
  const ort = [laden.ortsteil || laden.city, laden.street].filter(Boolean).join(' · ');
  const leistungFuerZeiten = frei?.leistung ?? leistung;
  const ab = abPreis(laden);
  const nummerHeute = !!frei?.nummer;
  // Nimmt der Telefon-Assistent ab, auch per Telefon buchen (wie ShopCard)
  const telefonAnnahme = useTelefonAnnahme(laden.id);

  return (
    <article
      ref={ref}
      onMouseEnter={() => onHover?.(laden.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'flex flex-col gap-3 rounded-3xl border bg-card p-4 transition-shadow sm:p-5',
        aktiv ? 'border-foreground shadow-[0_0_0_1px_hsl(var(--foreground))]' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        {laden.logoUrl ? (
          <img src={laden.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-border bg-background object-cover" loading="lazy" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground font-display text-lg font-bold text-signal" aria-hidden="true">
            {laden.name.trim()[0]?.toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="min-w-0 font-display text-lg font-bold leading-tight">
              <Link to={`/shop-details?shopId=${encodeURIComponent(laden.id)}`} className="rounded hover:underline">
                {laden.name}
              </Link>
            </h3>
            {km !== null && <span className="shrink-0 font-mono text-xs text-muted-foreground">{kmText(km)}</span>}
          </div>
          {ort && (
            <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{ort}</span>
            </p>
          )}
          {oeffnung && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className={cn('mx-[3px] h-2 w-2 shrink-0 rounded-full', oeffnung.offen ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden="true" />
              {oeffnung.text}
            </p>
          )}
        </div>
      </div>

      {/* Live: wer wartet, wann wäre man mit einer Nummer dran */}
      {frei && oeffnung?.offen && (
        <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">
              {frei.warten === 0 ? t('Gerade wartet niemand') : tn(frei.warten, 'Gerade wartet {n} Person', 'Gerade warten {n} Personen')}
            </span>
            {nummerHeute && <> · {t('mit Nummer dran um ca. {zeit} Uhr', { zeit: uhrzeit(frei.nummer as string) })}</>}
          </span>
        </p>
      )}

      {(leistungFuerZeiten || ab) && !kompakt && (
        <p className="text-sm">
          {leistungFuerZeiten ? (
            <>
              <span className="font-medium">{leistungFuerZeiten.name}</span>
              {leistungFuerZeiten.price > 0 && <span className="text-muted-foreground"> · {preis(leistungFuerZeiten.price)}</span>}
            </>
          ) : (
            ab && <span className="text-muted-foreground">{t('Leistungen ab {preis}', { preis: preis(ab) })}</span>
          )}
        </p>
      )}

      {laden.termine && frei && frei.termine.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('Nächste freie Termine')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {frei.termine.map((termin) => (
              <Link
                key={termin.start}
                to={buchenLink('/book-appointment', laden.id, frei.leistung?.id, { staffId: termin.personId, zeit: termin.start })}
                className="inline-flex h-9 items-center rounded-full border border-border px-3 font-mono text-[13px] font-medium hover:border-foreground"
              >
                {zeitKurz(termin.start, jetzt)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" asChild>
          <Link to={buchenLink('/public-join-queue', laden.id, frei?.leistung?.id ?? leistung?.id)}>{t('Nummer ziehen')}</Link>
        </Button>
        {laden.termine && (
          <Button variant="outline" className="flex-1" asChild>
            <Link to={buchenLink('/book-appointment', laden.id, frei?.leistung?.id ?? leistung?.id)}>{t('Termin buchen')}</Link>
          </Button>
        )}
        {telefonAnnahme && laden.phone && !kompakt && (
          <Button variant="outline" className="h-auto min-h-10 basis-full flex-wrap whitespace-normal py-2" asChild>
            <a href={telLink(laden.phone)}>
              <Phone className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('Per Telefon buchen')}
              <span dir="ltr" className="ms-2 font-mono font-normal">
                {laden.phone}
              </span>
            </a>
          </Button>
        )}
      </div>
    </article>
  );
});
TrefferKarte.displayName = 'TrefferKarte';

/** Übernahme für Salons ohne Dranzeit: bewusst leise (klein, grau, nicht fett – Entscheidung nach PR #85) */
export const UebernehmenLink = ({ id }: { id: string }) => (
  <Link to={`/uebernehmen?eintrag=${encodeURIComponent(id)}`} className="text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground">
    {t('Dein Salon? Übernehmen')}
  </Link>
);

/** Salon ohne Dranzeit: Adresse und Link zu seiner Seite, kein Buchen (neutral, wie im Salon-Verzeichnis) */
export const SalonZeile = ({ treffer }: { treffer: SalonTreffer }) => {
  const { salon, km } = treffer;
  return (
    <div className="flex flex-col rounded-2xl border border-dashed border-border bg-card/60 hover:bg-card">
      <a href={salon.pfad} className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{salon.name}</span>
          <span className="truncate text-sm text-muted-foreground">{[salon.street, salon.ortsteil || salon.city].filter(Boolean).join(' · ')}</span>
        </span>
        {km !== null && <span className="shrink-0 font-mono text-xs text-muted-foreground">{kmText(km)}</span>}
      </a>
      <span className="self-start px-4 pb-3">
        <UebernehmenLink id={salon.id} />
      </span>
    </div>
  );
};
