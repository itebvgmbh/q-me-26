import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Shop, Service } from '../utils/firestore/types';

export interface ShopCardProps {
  shop: Shop;
  services?: Service[];
  /** "dark" für den schwarzen Abschnitt der Startseite */
  tone?: 'light' | 'dark';
}

const formatAddress = (shop: Shop) =>
  shop.street || shop.city || shop.postalCode
    ? [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : shop.address || '';

/** Shop-Karte mit den zwei Wegen: einreihen oder festen Termin buchen */
export const ShopCard: React.FC<ShopCardProps> = ({ shop, services = [], tone = 'light' }) => {
  const address = formatAddress(shop);
  const dark = tone === 'dark';

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
            <span>{address}</span>
          </p>
        )}
      </div>

      {services.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Leistungen">
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

      <div className="mt-auto flex gap-2">
        <Button variant={dark ? 'signal' : 'default'} className="flex-1" asChild>
          <Link to={`/public-join-queue?shopId=${shop.id}`}>Einreihen</Link>
        </Button>
        <Button
          variant="outline"
          className={cn('flex-1', dark && 'border-white/40 text-background hover:bg-background hover:text-foreground')}
          asChild
        >
          <Link to={`/book-appointment?shopId=${shop.id}&fromMarketplace=true`}>Termin</Link>
        </Button>
      </div>
    </article>
  );
};
