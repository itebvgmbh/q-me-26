import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { anmeldung, gekoppelt, nurTresen, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { merke, t } from '@/i18n';
import { bestaetigenAdresse, koppelnAbholen, koppelnStarten, type KoppelStart } from '../utils/geraete-koppeln';
import { merkeGeraet } from '../utils/geraet';
import { merkeLaden } from '../utils/laden-wahl';

/** So oft fragt das Tablet nach, ob der Inhaber schon bestätigt hat */
const NACHFRAGEN_MS = 2_000;

const SCHRITTE = [
  merke('Öffne auf deinem Handy die Kamera und scanne den Code. Auf dem Handy musst du bei Dranzeit angemeldet sein.'),
  merke('Vergleiche die Prüfzahl auf dem Handy mit der Zahl hier und tipp auf „Tablet anmelden“.'),
  merke('Fertig. Das Tablet zeigt den Tresen – ohne dein Passwort, und nur den Tresen.'),
];

type Stand =
  | { art: 'startet' }
  | { art: 'bereit'; start: KoppelStart; bis: number }
  | { art: 'fertig' }
  | { art: 'fehler'; text: string };

/**
 * Tablet am Tresen koppeln (backend/app/apis/geraete): Das Tablet zeigt einen QR-Code, der Inhaber scannt ihn mit seinem
 * angemeldeten Handy (pages/KoppelnBestaetigen.tsx) und bestätigt. Danach ist das Tablet nur für den Tresen angemeldet.
 * Der Code gilt 10 Minuten; danach holt die Seite von selbst einen neuen.
 */
export default function Koppeln() {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [stand, setStand] = useState<Stand>({ art: 'startet' });
  const fragtGerade = useRef(false);

  const starten = useCallback(async () => {
    setStand({ art: 'startet' });
    try {
      const start = await koppelnStarten();
      setStand({ art: 'bereit', start, bis: Date.now() + start.gueltigSekunden * 1000 });
    } catch (e) {
      setStand({ art: 'fehler', text: e instanceof Error ? e.message : t('Das hat nicht geklappt.') });
    }
  }, []);

  const mitKonto = !loading && !!user;
  useEffect(() => {
    if (!loading && !user) void starten();
  }, [loading, user, starten]);

  const abholen = stand.art === 'bereit' ? stand.start.abholen : null;
  const bis = stand.art === 'bereit' ? stand.bis : 0;
  useEffect(() => {
    if (!abholen) return;
    const timer = window.setInterval(async () => {
      if (fragtGerade.current) return;
      if (Date.now() > bis) {
        void starten();
        return;
      }
      fragtGerade.current = true;
      try {
        const antwort = await koppelnAbholen(abholen);
        if (antwort.status === 'fertig') {
          window.clearInterval(timer);
          setStand({ art: 'fertig' });
          merkeGeraet({ rolle: 'tresen' });
          if (antwort.laden) merkeLaden(antwort.laden);
          gekoppelt(antwort);
          navigate('/shop-dashboard', { replace: true });
        } else if (antwort.status === 'abgelaufen') {
          void starten();
        }
      } catch {
        // Kein Netz o. Ä.: beim nächsten Mal wieder
      } finally {
        fragtGerade.current = false;
      }
    }, NACHFRAGEN_MS);
    return () => window.clearInterval(timer);
  }, [abholen, bis, navigate, starten]);

  if (mitKonto && stand.art !== 'fertig') {
    if (nurTresen(user)) return <Navigate to="/shop-dashboard" replace />;
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Tablet koppeln')}</h1>
        <p className="text-muted-foreground">
          {t('Dieses Gerät ist schon mit deinem Konto angemeldet. Zum Koppeln öffnest du diese Seite auf dem Tablet am Tresen, das noch nicht angemeldet ist, und scannst den Code dort mit diesem Gerät.')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/shop-dashboard">{t('Zum Tresen')}</Link>
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await anmeldung.signOut();
            }}
          >
            {t('Abmelden und dieses Gerät koppeln')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl items-center gap-8 px-4 py-8 sm:px-6 md:grid-cols-[1fr_auto] md:py-14">
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Tablet am Tresen anmelden')}</h1>
        <p className="text-lg text-muted-foreground">
          {t('Scanne den Code mit dem Handy, auf dem du bei Dranzeit angemeldet bist. Ein Passwort brauchst du hier nicht.')}
        </p>
        <ol className="flex flex-col gap-3">
          {SCHRITTE.map((schritt, i) => (
            <li key={schritt} className="flex items-baseline gap-3">
              <span className="font-mono text-lg font-bold">{i + 1}</span>
              <span>{t(schritt)}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          {t('Das Tablet sieht danach nur den Tresen: Termine, Nummern und Kunden. Tarif, Team und Einstellungen bleiben auf deinem Handy.')}{' '}
          <a href="/hilfe/tablet-fuer-den-tresen" className="font-semibold text-foreground underline underline-offset-4">
            {t('Mehr dazu')}
          </a>
        </p>
      </div>

      <div className="flex w-full flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 md:w-[22rem]">
        {stand.art === 'bereit' && (
          <>
            <div className="w-full rounded-2xl bg-[#ffc83d] p-4">
              <QRCodeSVG
                value={bestaetigenAdresse(stand.start.code)}
                size={512}
                className="h-auto w-full"
                bgColor="#ffc83d"
                fgColor="#141414"
                marginSize={0}
                title={t('QR-Code zum Koppeln')}
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-muted-foreground">{t('Prüfzahl')}</span>
              <span className="font-mono text-4xl font-bold tracking-[0.3em]" aria-live="polite">
                {stand.start.pruefzahl}
              </span>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/60" aria-hidden="true" />
              {t('Wartet auf dein Handy …')}
            </p>
          </>
        )}
        {(stand.art === 'startet' || stand.art === 'fertig') && (
          <div className="flex min-h-[20rem] items-center justify-center" role="status" aria-live="polite">
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
            <span className="sr-only">{stand.art === 'fertig' ? t('Angemeldet. Der Tresen öffnet sich.') : t('Code wird erstellt …')}</span>
          </div>
        )}
        {stand.art === 'fehler' && (
          <div className="flex min-h-[20rem] flex-col items-center justify-center gap-4 text-center">
            <p role="alert">{stand.text}</p>
            <Button onClick={() => void starten()}>{t('Noch einmal versuchen')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
