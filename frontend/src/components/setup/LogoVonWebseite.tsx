import { CSSProperties, useEffect, useState } from 'react';
import { Check, ImageOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WebsiteLogo, WebsiteLogoData } from '../../brain/data-contracts';
import { websiteLogo } from '../../utils/shop-setup';
import { alsPng } from '../../utils/logo-bild';
import { t } from '@/i18n';

const host = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Hell kariert, damit auch durchsichtige und weiße Logos zu sehen sind – auch im dunklen Modus
const KARIERT: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #e7e7e7 25%, transparent 25%), linear-gradient(-45deg, #e7e7e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e7e7e7 75%), linear-gradient(-45deg, transparent 75%, #e7e7e7 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
};

type Stand = { art: 'laedt' } | { art: 'gefunden'; logos: WebsiteLogo[] } | { art: 'nichts' } | { art: 'fehler'; text: string };

/** Antworten je Adresse, solange die Seite offen ist – die Suche zählt gegen ein Stundenlimit */
const gemerkt = new Map<string, WebsiteLogoData>();

interface Props {
  /** Webseite, wie eingetragen */
  url: string;
  /** quelle des schon gespeicherten Logos – dann steht dort „Logo gespeichert“ */
  gespeichert?: string;
  /** Bekommt das im Browser gerasterte PNG (≤ 400 px); wirft bei Fehlern, die Meldung erscheint hier */
  onSave: (logo: { dataUrl: string; quelle: string }) => Promise<void> | void;
  /** Bei „nichts gefunden“ auf „Laden“ → „Bearbeiten“ verweisen (im Assistenten, nicht beim Bearbeiten selbst) */
  spaeterHochladen?: boolean;
}

/**
 * Logo von der Webseite des Ladens holen (POST /shop-setup/website-logo), zur Auswahl zeigen und als PNG speichern.
 * SVG kommt nur als Vorschau – gespeichert wird immer das hier gerasterte PNG.
 */
export const LogoVonWebseite = ({ url, gespeichert, onSave, spaeterHochladen = true }: Props) => {
  const [stand, setStand] = useState<Stand>({ art: 'laedt' });
  const [wahl, setWahl] = useState(0);
  const [speichert, setSpeichert] = useState(false);
  const [problem, setProblem] = useState('');
  const [versuch, setVersuch] = useState(0);
  const adresse = url.trim();
  const seite = host(adresse);

  useEffect(() => {
    if (!adresse) return;
    setProblem('');
    const zeigen = (antwort: WebsiteLogoData) => {
      const schon = antwort.logos.findIndex((logo) => logo.quelle === gespeichert);
      setWahl(Math.max(0, schon));
      setStand(antwort.logos.length ? { art: 'gefunden', logos: antwort.logos } : { art: 'nichts' });
    };
    const vorher = gemerkt.get(adresse);
    if (vorher) {
      zeigen(vorher); // „Zurück“ und wieder hin fragt nicht noch einmal
      return;
    }
    setStand({ art: 'laedt' });
    const controller = new AbortController();
    // Kurz warten: Wer die Adresse noch tippt, löst nicht bei jedem Zeichen eine Suche aus
    const timer = window.setTimeout(async () => {
      try {
        const antwort = await websiteLogo(adresse, controller.signal);
        if (controller.signal.aborted) return;
        gemerkt.set(adresse, antwort);
        zeigen(antwort);
      } catch (e) {
        if (!controller.signal.aborted) setStand({ art: 'fehler', text: (e as Error).message });
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // gespeichert nur zum Vorauswählen – ändert es sich, wird nicht neu gesucht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adresse, versuch]);

  if (!adresse) return null;

  if (stand.art === 'laedt') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-4" role="status">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        <p className="text-sm">{t('Ich suche das Logo auf {seite} …', { seite })}</p>
      </div>
    );
  }

  if (stand.art === 'nichts') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4" role="status">
        <ImageOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm">
          {spaeterHochladen
            ? t('Auf {seite} habe ich kein Logo gefunden. Du kannst es später unter „Laden“ → „Bearbeiten“ hochladen.', { seite })
            : t('Auf {seite} habe ich kein Logo gefunden.', { seite })}
        </p>
      </div>
    );
  }

  if (stand.art === 'fehler') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
        <p className="text-sm">
          {t('Das Logo von {seite} ließ sich nicht holen.', { seite })} {stand.text}
        </p>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setVersuch((v) => v + 1)}>
          {t('Noch einmal')}
        </Button>
      </div>
    );
  }

  const { logos } = stand;
  const gewaehlt = logos[Math.min(wahl, logos.length - 1)];
  const istGespeichert = Boolean(gespeichert) && gewaehlt.quelle === gespeichert;

  const speichern = async () => {
    setSpeichert(true);
    setProblem('');
    let png: string;
    try {
      png = await alsPng(gewaehlt.dataUrl);
    } catch (e) {
      // z. B. SecurityError, wenn der Browser die Zeichenfläche bei einem SVG sperrt
      console.error('Logo umwandeln fehlgeschlagen:', e);
      setProblem(t('Dieses Logo lässt sich hier nicht übernehmen. Nimm ein anderes oder lade es selbst hoch.'));
      setSpeichert(false);
      return;
    }
    try {
      await onSave({ dataUrl: png, quelle: gewaehlt.quelle });
    } catch (e) {
      console.error('Logo speichern fehlgeschlagen:', e);
      setProblem((e as Error).message || t('Das hat nicht geklappt.'));
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">
        {logos.length > 1 ? t('Auf {seite} habe ich mehrere Bilder gefunden. Tipp das passende Logo an.', { seite }) : t('Das habe ich auf {seite} gefunden.', { seite })}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={t('Logos von {seite}', { seite })}>
        {logos.map((logo, i) => {
          const an = logo === gewaehlt;
          return (
            <button
              key={logo.quelle + i}
              type="button"
              aria-pressed={an}
              onClick={() => {
                setWahl(i);
                setProblem('');
              }}
              className={cn(
                'relative flex h-24 items-center justify-center rounded-xl border-2 p-2 transition-colors',
                an ? 'border-foreground ring-2 ring-foreground/20' : 'border-border hover:border-foreground/60',
              )}
              style={KARIERT}
            >
              <img src={logo.dataUrl} alt={t('Logo {nr} von {seite}', { nr: i + 1, seite })} className="max-h-full max-w-full object-contain" />
              {an && (
                <span className="absolute end-1 top-1 rounded-full bg-foreground p-0.5 text-background">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {istGespeichert ? (
        <p className="flex items-center gap-2 text-sm font-semibold" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('Logo gespeichert')}
        </p>
      ) : (
        <Button type="button" variant="outline" className="w-full sm:w-auto sm:self-start" onClick={speichern} disabled={speichert}>
          {speichert ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {t('Dieses Logo speichern')}
        </Button>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
};
