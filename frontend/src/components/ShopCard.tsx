import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Shop, Service } from '../utils/firestore/types';
import { hasFeature } from '../utils/plans';
import { telLink, useTelefonAnnahme } from '../utils/telefon-hinweis';
import { oeffnungJetzt, wartendeText } from '../utils/laden-live';
import { t, intlSprache } from '@/i18n';

export interface ShopCardProps {
  shop: Shop;
  services?: Service[];
  /** "dark" für den schwarzen Abschnitt der Startseite */
  tone?: 'light' | 'dark';
  /** Entfernung zum Nutzer (Shop-Karte) */
  distanceKm?: number;
  /** Wie viele gerade warten (useWartende); fehlt die Zahl, steht nur die Öffnungszeit da */
  wartende?: number;
}

const formatAddress = (shop: Shop) =>
  shop.street || shop.city || shop.postalCode
    ? [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : shop.address || '';

/** Shop-Karte mit den Wegen: einreihen, festen Termin buchen (nur, wenn der Tarif Online-Termine hat), per Telefon buchen (nur, wenn der Assistent abnimmt) */
export const ShopCard: React.FC<ShopCardProps> = ({ shop, services = [], tone = 'light', distanceKm, wartende }) => {
  const address = formatAddress(shop);
  const dark = tone === 'dark';
  const telefonAnnahme = useTelefonAnnahme(shop.id);
  // Offen oder zu, und wer gerade wartet – wie im Einbau-Kasten nur, solange offen ist
  const oeffnung = oeffnungJetzt(shop);
  const outlineDark = dark && 'border-white/40 text-background hover:bg-background hover:text-foreground';

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-4 rounded-3xl border p-5',
        dark ? 'border-white/10 bg-white/[0.06] text-background' : 'border-border bg-card',
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-xl font-bold">
          <Link to={`/shop-details?shopId=${shop.id}`} className="rounded hover:underline">
            {shop.name}
          </Link>
        </h3>
        {address && (
          <p className={cn('flex items-start gap-1.5 text-sm', dark ? 'text-white/70' : 'text-muted-foreground')}>
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {address}
              {distanceKm !== undefined && <span className="font-mono"> · {distanceKm.toLocaleString(intlSprache(), { maximumFractionDigits: 1 })} km</span>}
            </span>
          </p>
        )}
        {oeffnung && (
          <p className={cn('flex items-center gap-1.5 text-sm', dark ? 'text-white/70' : 'text-muted-foreground')}>
            <span
              className={cn('mx-[3px] h-2 w-2 shrink-0 rounded-full', oeffnung.offen ? 'bg-emerald-500' : dark ? 'bg-white/30' : 'bg-muted-foreground/40')}
              aria-hidden="true"
            />
            <span>
              {oeffnung.text}
              {oeffnung.offen && wartende !== undefined && (
                <span className={cn('font-semibold', dark ? 'text-background' : 'text-foreground')}> · {wartendeText(wartende)}</span>
              )}
            </span>
          </p>
        )}
      </div>

      {services.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('Leistungen')}>
          {services.slice(0, 3).map((service) => (
            <li key={service.id} className={cn('rounded-full border px-2.5 py-1 text-xs', dark ? 'border-white/15' : 'border-border')}>
              {service.name}
            </li>
          ))}
          {services.length > 3 && (
            <li className={cn('rounded-full px-2 py-1 text-xs', dark ? 'text-white/70' : 'text-muted-foreground')}>+{services.length - 3}</li>
          )}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant={dark ? 'signal' : 'default'} className="flex-1" asChild>
          <Link to={`/public-join-queue?shopId=${shop.id}`}>{t('Nummer ziehen')}</Link>
        </Button>
        {hasFeature(shop, 'termine') && (
          <Button variant="outline" className={cn('flex-1', outlineDark)} asChild>
            <Link to={`/book-appointment?shopId=${shop.id}&fromMarketplace=true`}>{t('Termin buchen')}</Link>
          </Button>
        )}
        {telefonAnnahme && shop.phone && (
          <Button variant="outline" className={cn('h-auto min-h-10 basis-full flex-wrap whitespace-normal py-2', outlineDark)} asChild>
            <a href={telLink(shop.phone)}>
              <Phone className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('Per Telefon buchen')}
              <span dir="ltr" className="ms-2 font-mono font-normal">
                {shop.phone}
              </span>
            </a>
          </Button>
        )}
      </div>
    </article>
  );
};
