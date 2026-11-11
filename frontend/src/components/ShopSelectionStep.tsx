import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LocateFixed, Map as KartenIcon, Search } from 'lucide-react';
import { Shop } from '../utils/firestore/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';
import { oeffnungJetzt } from '../utils/laden-live';
import { hatLage, km, ladenPasst, normSuche, ortVorschlaege, passt, type Punkt, type SuchLaden } from '../utils/suche';
import { kmText, ORTE, suchGruppe, useSuchDaten } from '../utils/suche-daten';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

export interface ShopSelectionStepProps {
  shops: Shop[];
  selectedShop: string;
  onSelectShop: (shopId: string) => void;
}

const address = (shop: Shop) =>
  [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address || '';

/** Ab so vielen Läden gibt es das Suchfeld; darunter reicht die Liste */
const SUCHE_AB = 5;

/**
 * Erster Schritt beim Buchen ohne Laden aus dem Link: Suchfeld (Name, Leistung, Ort), „In meiner Nähe“ und offen/zu.
 * Lage, Ortsteil und Leistungen kommen aus derselben Quelle wie „Läden finden“ (utils/suche-daten.ts).
 */
export const ShopSelectionStep: React.FC<ShopSelectionStepProps> = ({ shops, selectedShop, onSelectShop }) => {
  const { daten } = useSuchDaten();
  const [eingabe, setEingabe] = useState('');
  const [nahe, setNahe] = useState<Punkt | null>(null);
  const [naheAbgelehnt, setNaheAbgelehnt] = useState(false);
  const extra = useMemo(() => new Map((daten?.laeden ?? []).map((l) => [l.id, l])), [daten]);

  // Ort eingetippt (Bezirk, Ortsteil): nach Entfernung dorthin sortieren statt filtern
  const ort = eingabe.trim().length >= 3 ? ortVorschlaege(eingabe, ORTE, 1)[0] : undefined;
  const ortPasst = ort && normSuche(ort.name).startsWith(normSuche(eingabe));
  const mitte: Punkt | null = ortPasst && ort ? ort : nahe;
  // „Herrenschnitt“ findet auch Läden, die ihn „Maschinenschnitt“ nennen (Leistungsgruppen)
  const gruppe = ortPasst ? null : suchGruppe(eingabe);

  const liste = shops
    .map((shop) => {
      const s: SuchLaden | undefined = extra.get(shop.id);
      const lage = s && hatLage(s) ? { lat: s.lat as number, lng: s.lng as number } : null;
      return { shop, s, entfernung: mitte && lage ? km(lage, mitte) : null };
    })
    .filter(({ shop, s }) => {
      if (!eingabe.trim() || ortPasst) return true;
      const text = [shop.name, address(shop), s?.ortsteil, s?.bezirk].filter(Boolean).join(' ');
      return passt(text, eingabe) || (!!s && ladenPasst(s, eingabe, gruppe));
    })
    .sort((a, b) => (mitte ? (a.entfernung ?? Infinity) - (b.entfernung ?? Infinity) : 0) || a.shop.name.localeCompare(b.shop.name, 'de'));

  const standort = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setNahe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNaheAbgelehnt(false);
      },
      () => setNaheAbgelehnt(true),
      { timeout: 10_000, maximumAge: 300_000 },
    );

  return (
    <QueueStepShell title={t('Wo möchtest du hin?')} description={t('Such nach Laden, Leistung oder Ort – oder lass dir zeigen, was in deiner Nähe ist.')}>
      {shops.length === 0 ? (
        <p className="text-muted-foreground">
          {t('Noch kein Laden eingetragen.')}{' '}
          <Link to="/" className="font-semibold underline">
            {t('Zur Startseite')}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shops.length >= SUCHE_AB && (
            <div className="relative">
              <Search className="absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={eingabe}
                onChange={(e) => setEingabe(e.target.value)}
                placeholder={t('Laden, Leistung oder Ort')}
                aria-label={t('Laden, Leistung oder Ort')}
                className="h-12 w-full rounded-2xl border border-input bg-card pe-3 ps-10 text-[15px] outline-none focus:border-foreground"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={standort}
              aria-pressed={!!nahe}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
                nahe ? 'border-foreground bg-foreground text-signal' : 'border-border bg-card hover:border-foreground',
              )}
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
              {t('In meiner Nähe')}
            </button>
            <Link to="/shop-map" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium hover:border-foreground">
              <KartenIcon className="h-4 w-4" aria-hidden="true" />
              {t('Auf der Karte suchen')}
            </Link>
          </div>
          {naheAbgelehnt && <p className="text-sm text-muted-foreground">{t('Du hast den Standort nicht freigegeben. Gib einfach oben einen Ort oder eine PLZ ein.')}</p>}
          {ortPasst && ort && <p className="text-sm text-muted-foreground">{t('Nach Entfernung zu {ort} sortiert', { ort: ort.name })}</p>}
          {liste.length === 0 ? (
            <p className="text-muted-foreground">{t('Dazu haben wir keinen Laden gefunden.')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {liste.map(({ shop, s, entfernung }) => {
                const oeffnung = oeffnungJetzt(shop);
                const ortsteil = s?.ortsteil && !address(shop).includes(s.ortsteil) ? s.ortsteil : '';
                return (
                  <QueueOption
                    key={shop.id}
                    selected={selectedShop === shop.id}
                    onClick={() => onSelectShop(shop.id)}
                    title={shop.name}
                    meta={
                      <span className="flex flex-col">
                        <span>{[address(shop), ortsteil].filter(Boolean).join(' · ')}</span>
                        {(oeffnung || entfernung !== null) && (
                          <span className="flex items-center gap-1.5">
                            {oeffnung && <span className={cn('h-2 w-2 shrink-0 rounded-full', oeffnung.offen ? 'bg-emerald-500' : 'bg-current opacity-40')} aria-hidden="true" />}
                            {[oeffnung?.text, entfernung !== null ? kmText(entfernung) : ''].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </QueueStepShell>
  );
};
