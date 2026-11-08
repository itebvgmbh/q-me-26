import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { t, tTeile } from '@/i18n';
import { COOKIE_EINSTELLUNGEN, einwilligungOffen, einwilligungSetzen, statistikMoeglich } from '../utils/statistik';

/**
 * Einwilligung für Google Analytics (utils/statistik.ts, public/statistik.js). Erscheint, solange nichts gewählt ist,
 * und wieder über „Cookie-Einstellungen“ in der Fußzeile oder auf der Datenschutzseite. Beide Knöpfe gleich groß und
 * gleich auffällig. Nicht in der App aus dem Store und nicht auf dem Wartezimmer-Bildschirm (dort ist statistik.js aus).
 * Die Seiten vom Backend (Stadtseiten, Hilfe …) haben dasselbe in backend/app/seo.py (COOKIE_BANNER).
 */
export const CookieBanner = () => {
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    // statistik.js lädt mit defer vor der App; zur Sicherheit erst nach dem ersten Zeichnen fragen
    setOffen(einwilligungOffen());
    const oeffnen = () => setOffen(statistikMoeglich());
    window.addEventListener(COOKIE_EINSTELLUNGEN, oeffnen);
    return () => window.removeEventListener(COOKIE_EINSTELLUNGEN, oeffnen);
  }, []);

  if (!offen) return null;

  const waehlen = (erlaubt: boolean) => {
    einwilligungSetzen(erlaubt);
    setOffen(false);
  };

  return (
    <section
      aria-label={t('Cookie-Einstellungen')}
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-border bg-card/95 px-4 py-4 shadow-lg backdrop-blur print:hidden sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {tTeile(
            'Dürfen wir mit Google Analytics messen, wie Dranzeit genutzt wird? Dafür setzt Google Cookies, Daten können in die USA gehen. Ändern kannst du das jederzeit unter „Cookie-Einstellungen“. <link>Datenschutz</link>',
            {
              link: (inhalt) => (
                <Link to="/datenschutz" className="text-foreground underline underline-offset-2">
                  {inhalt}
                </Link>
              ),
            },
          )}
        </p>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => waehlen(true)} data-testid="cookie-alle">
            {t('Alle akzeptieren')}
          </Button>
          <Button variant="outline" onClick={() => waehlen(false)} data-testid="cookie-notwendig">
            {t('Nur notwendige')}
          </Button>
        </div>
      </div>
    </section>
  );
};
