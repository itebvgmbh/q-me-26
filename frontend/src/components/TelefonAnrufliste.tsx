import { useCallback, useEffect, useState } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Phone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ladeAnrufe, zumWaehlen, type TelefonAnruf, type TelefonGrund } from '../utils/telefon-assistent';
import { datumsLocale, merke, t } from '@/i18n';

/** Warum der Anrufer nur die Ansage gehört hat */
const GRUENDE: Record<Exclude<TelefonGrund, null>, string> = {
  test_verbraucht: merke('Testminuten aufgebraucht'),
  deckel: merke('Kostendeckel erreicht'),
  aus: merke('Assistent ausgeschaltet'),
  zahlung: merke('Zahlung offen'),
  gekuendigt: merke('Zusatz beendet'),
  nicht_frei: merke('Noch nicht freigeschaltet'),
  gesperrt: merke('Gesperrt'),
};

const wann = (d: Date) => {
  const uhr = format(d, 'HH:mm');
  if (isToday(d)) return `${t('Heute')}, ${uhr}`;
  if (isYesterday(d)) return `${t('Gestern')}, ${uhr}`;
  return format(d, t('EEE d. MMM, HH:mm'), { locale: datumsLocale() });
};

const dauer = (sekunden: number) => `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')}`;

/** Was aus dem Anruf wurde, in einer Zeile je Termin */
function Ergebnis({ anruf }: { anruf: TelefonAnruf }) {
  if (anruf.ergebnis === 'ansage') {
    return <p className="text-sm">{t('Nur Ansage: {grund}', { grund: anruf.grund ? t(GRUENDE[anruf.grund]) : '' })}</p>;
  }
  if (anruf.ergebnis === 'belegt') return <p className="text-sm">{t('Alle Leitungen waren belegt, nur Ansage')}</p>;
  if (anruf.ergebnis === 'stoerung') return <p className="text-sm">{t('Störung, nur Ansage')}</p>;
  if (anruf.laeuft) return <p className="text-sm font-semibold">{t('Gespräch läuft gerade')}</p>;
  if (!anruf.termine.length) return <p className="text-sm">{t('Kein Termin gebucht')}</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {anruf.termine.map((termin) => {
        const start = termin.startTime?.toDate();
        const was = termin.leistung && termin.person ? t('{leistung} bei {person}', { leistung: termin.leistung, person: termin.person }) : termin.leistung;
        const kopf =
          termin.type === 'queue'
            ? t('Nummer {nummer} gezogen', { nummer: termin.nummer ?? '' })
            : t('Termin gebucht: {zeit}', { zeit: start ? format(start, t('EEE d. MMM, HH:mm'), { locale: datumsLocale() }) : '' });
        return (
          <li key={termin.id} className={cn('text-sm', termin.status === 'cancelled' && 'text-muted-foreground line-through')}>
            {kopf}
            {was && <> · {was}</>}
            {termin.status === 'cancelled' && <span className="sr-only"> ({t('Abgesagt')})</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Wer den Telefon-Assistenten angerufen hat und was daraus wurde, die neuesten zuerst. Zurückrufen lohnt sich vor allem,
 * wo kein Termin herauskam oder der Anrufer nur die Ansage gehört hat. Backend: backend/app/libs/telefon_anrufliste.py
 */
export default function TelefonAnrufliste({ shopId, auchLeer }: { shopId: string; /** Auch ohne Anrufe zeigen (eingeschaltet) */ auchLeer: boolean }) {
  const [anrufe, setAnrufe] = useState<TelefonAnruf[] | null>(null);
  const [fehler, setFehler] = useState(false);
  const [laedt, setLaedt] = useState(false);

  const laden = useCallback(() => {
    setLaedt(true);
    ladeAnrufe(shopId)
      .then((liste) => {
        setAnrufe(liste);
        setFehler(false);
      })
      .catch(() => setFehler(true))
      .finally(() => setLaedt(false));
  }, [shopId]);

  useEffect(() => {
    setAnrufe(null);
    laden();
  }, [laden]);

  if (!fehler && (anrufe === null || (!anrufe.length && !auchLeer))) return null;

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5" aria-labelledby="anrufliste-titel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="anrufliste-titel" className="font-display text-xl font-bold">
          {t('Anrufe')}
        </h2>
        <Button type="button" size="sm" variant="ghost" onClick={laden} disabled={laedt}>
          <RefreshCw className={cn('h-4 w-4', laedt && 'animate-spin')} aria-hidden />
          {t('Aktualisieren')}
        </Button>
      </div>
      {fehler ? (
        <p role="alert" className="text-sm">
          {t('Die Anrufe konnten nicht geladen werden.')}
        </p>
      ) : !anrufe?.length ? (
        <p className="text-sm text-muted-foreground">{t('Noch keine Anrufe.')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {anrufe.map((anruf) => {
            const nummer = anruf.anrufer ? zumWaehlen(anruf.anrufer) : '';
            const zurueck = Boolean(anruf.anrufer) && !anruf.laeuft && !anruf.termine.some((x) => x.status !== 'cancelled');
            return (
              <li key={anruf.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-xs text-muted-foreground">
                    {wann(anruf.beginn.toDate())}
                    {anruf.ergebnis === 'assistent' && !anruf.laeuft && anruf.sekunden > 0 && <> · {t('{dauer} Min.', { dauer: dauer(anruf.sekunden) })}</>}
                  </p>
                  <p className="font-semibold">
                    {anruf.name ?? (nummer ? <span dir="ltr">{nummer}</span> : t('Unterdrückte Nummer'))}
                    {anruf.name && nummer && (
                      <span dir="ltr" className="ms-2 text-sm font-normal text-muted-foreground">
                        {nummer}
                      </span>
                    )}
                  </p>
                  <Ergebnis anruf={anruf} />
                </div>
                {zurueck && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={`tel:${anruf.anrufer}`}>
                      <Phone className="h-4 w-4" aria-hidden />
                      {t('Zurückrufen')}
                    </a>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('Anrufe der letzten 90 Tage. Ältere löschen wir.')}</p>
    </section>
  );
}
