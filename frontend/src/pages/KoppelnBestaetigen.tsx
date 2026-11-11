import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, TabletSmartphone } from 'lucide-react';
import { nurTresen, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { FormError } from '../components/auth/AuthShell';
import { koppelnBestaetigen, koppelnInfo, type KoppelInfo } from '../utils/geraete-koppeln';
import { LiveFehlt } from '../utils/live';

type Stand =
  | { art: 'laedt' }
  | { art: 'frage'; info: KoppelInfo }
  | { art: 'fertig' }
  | { art: 'abgebrochen' }
  | { art: 'fehler'; text: string };

const ABGELAUFEN = () => t('Dieser Code gilt nicht mehr. Am Tablet erscheint gleich ein neuer – scanne den.');

/**
 * Handy des Inhabers nach dem Scannen des QR-Codes am Tablet (pages/Koppeln.tsx): Prüfzahl vergleichen, Laden wählen,
 * bestätigen. Läuft im UserGuard: Wer nicht angemeldet ist, meldet sich an und landet danach wieder hier.
 */
export default function KoppelnBestaetigen() {
  const { user } = useCurrentUser();
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const [stand, setStand] = useState<Stand>({ art: 'laedt' });
  const [laden, setLaden] = useState('');
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const tablet = nurTresen(user);

  useEffect(() => {
    if (!code || tablet) return;
    let aktuell = true;
    koppelnInfo(code)
      .then((info) => {
        if (!aktuell) return;
        setStand({ art: 'frage', info });
        const offen = info.laeden.filter((l) => !l.gesperrt);
        if (info.laeden.length === 1) setLaden(info.laeden[0].id);
        else if (offen.length === 1) setLaden(offen[0].id);
      })
      .catch((e) => {
        if (aktuell) setStand({ art: 'fehler', text: e instanceof LiveFehlt ? ABGELAUFEN() : e instanceof Error ? e.message : String(e) });
      });
    return () => {
      aktuell = false;
    };
  }, [code, tablet]);

  const bestaetigen = async () => {
    if (!laden) {
      setFehler(t('Wähl den Laden, für den das Tablet ist.'));
      return;
    }
    setSendet(true);
    setFehler(null);
    try {
      await koppelnBestaetigen(code, laden);
      setStand({ art: 'fertig' });
    } catch (e) {
      const status = (e as { status?: number }).status;
      setFehler(status === 404 ? ABGELAUFEN() : e instanceof Error ? e.message : String(e));
    } finally {
      setSendet(false);
    }
  };

  const rahmen = (inhalt: ReactNode) => (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:py-16">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Tablet koppeln')}</h1>
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">{inhalt}</div>
    </div>
  );

  if (tablet) {
    return rahmen(<p>{t('Bestätige das auf deinem eigenen Handy, nicht auf dem Tablet am Tresen.')}</p>);
  }
  if (!code) {
    return rahmen(<p>{t('Öffne am Tablet dranzeit.de/koppeln und scanne den QR-Code dort mit diesem Handy.')}</p>);
  }
  if (stand.art === 'laedt') {
    return rahmen(
      <div className="flex justify-center py-8" role="status">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">{t('Wird geladen …')}</span>
      </div>,
    );
  }
  if (stand.art === 'fehler') return rahmen(<FormError>{stand.text}</FormError>);
  if (stand.art === 'abgebrochen') {
    return rahmen(<p>{t('Abgebrochen. Am Tablet hat sich nichts geändert.')}</p>);
  }
  if (stand.art === 'fertig') {
    return rahmen(
      <>
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
          {t('Fertig. Das Tablet zeigt gleich den Tresen.')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('Deine Tablets siehst du unter „Laden“. Dort kannst du jedes wieder abmelden.')}
        </p>
        <Button variant="outline" asChild className="self-start">
          <Link to="/shop-profile">{t('Zu „Laden“')}</Link>
        </Button>
      </>,
    );
  }

  const { info } = stand;
  return rahmen(
    <>
      <p className="flex items-start gap-3">
        <TabletSmartphone className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
        <span>
          {info.geraet
            ? t('Soll das Gerät „{geraet}“ als Tablet am Tresen angemeldet werden?', { geraet: info.geraet })
            : t('Soll dieses Gerät als Tablet am Tresen angemeldet werden?')}
        </span>
      </p>
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-muted px-4 py-3">
        <span className="text-sm text-muted-foreground">{t('Prüfzahl')}</span>
        <span className="font-mono text-4xl font-bold tracking-[0.3em]">{info.pruefzahl}</span>
      </div>
      <p className="text-sm">
        {t('Steht genau diese Zahl auf dem Tablet vor dir? Wenn nicht, brich ab – dann hat dir jemand einen fremden Code gezeigt.')}
      </p>

      {info.laeden.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('Für welchen Laden?')}</legend>
          {info.laeden.map((l) => (
            <label
              key={l.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3',
                laden === l.id ? 'border-foreground bg-signal text-signal-foreground' : 'border-border',
              )}
            >
              <input type="radio" name="laden" value={l.id} checked={laden === l.id} onChange={() => setLaden(l.id)} />
              <span className="font-medium">{l.name || t('Ohne Namen')}</span>
            </label>
          ))}
        </fieldset>
      )}

      {fehler && <FormError>{fehler}</FormError>}

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={bestaetigen} disabled={sendet}>
          {sendet ? t('Wird angemeldet …') : t('Tablet anmelden')}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => setStand({ art: 'abgebrochen' })} disabled={sendet}>
          {t('Abbrechen')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('Das Tablet sieht danach nur den Tresen: Termine, Nummern und Kunden. Tarif, Team und Einstellungen bleiben auf deinem Handy.')}
      </p>
    </>,
  );
}
