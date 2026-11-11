import { useCallback, useEffect, useState } from 'react';
import { QrCode, TabletSmartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { intlSprache, t } from '@/i18n';
import { ladeTablets, tabletAbmelden, type GekoppeltesTablet } from '../utils/geraete-koppeln';

const datum = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(intlSprache(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Tablets, die per QR-Code für den Tresen angemeldet sind (pages/Koppeln.tsx), mit „Abmelden“ – etwa wenn eins
 * verloren geht. Steht unter „Laden“ → „Auf diesem Gerät“ (components/LadenUebersicht.tsx).
 */
export function GekoppelteTablets() {
  const [tablets, setTablets] = useState<GekoppeltesTablet[] | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const laden = useCallback(() => {
    ladeTablets()
      .then(setTablets)
      .catch(() => setTablets([]));
  }, []);

  useEffect(laden, [laden]);

  const abmelden = async (tablet: GekoppeltesTablet) => {
    setLaeuft(tablet.kennung);
    try {
      await tabletAbmelden(tablet.kennung);
      setTablets((alt) => (alt ?? []).filter((x) => x.kennung !== tablet.kennung));
      toast.success(t('Tablet abgemeldet. Es zeigt beim nächsten Laden wieder den QR-Code.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      laden();
    } finally {
      setLaeuft(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <QrCode className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{t('Tablet am Tresen koppeln')}</p>
          <p className="text-sm text-muted-foreground">
            {t('Öffne am Tablet dranzeit.de/koppeln und scanne den QR-Code mit diesem Handy. Das Tablet zeigt dann nur den Tresen, ohne dein Passwort.')}{' '}
            <a href="/hilfe/tablet-fuer-den-tresen" className="font-semibold text-foreground underline underline-offset-4">
              {t('Anleitung')}
            </a>
          </p>
        </div>
      </div>
      {tablets && tablets.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {tablets.map((tablet) => (
            <li key={tablet.kennung} className="flex flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between [&:not(:first-child)]:pt-3">
              <div className="flex items-start gap-3">
                <TabletSmartphone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">
                    {tablet.geraet || t('Tablet')}
                    {tablet.ladenName ? ` · ${tablet.ladenName}` : ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('Gekoppelt am {datum}, zuletzt aktiv am {zuletzt}', { datum: datum(tablet.angelegt), zuletzt: datum(tablet.zuletzt) })}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => abmelden(tablet)} disabled={laeuft === tablet.kennung}>
                {t('Abmelden')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
