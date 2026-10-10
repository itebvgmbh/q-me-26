import { Link, useSearchParams } from 'react-router-dom';
import { MapPin, Phone } from 'lucide-react';
import { ShopLogo } from '../components/brand/ShopLogo';
import { Button } from '@/components/ui/button';
import { useShopDetails } from '../utils/hooks/useShopDetails';
import { getIndustryNameById } from '../utils/industries';

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const euro = (value: number) => `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Öffentliche Seite eines Ladens: einreihen oder Termin buchen, Leistungen, Öffnungszeiten, Team */
const ShopDetails = () => {
  const [searchParams] = useSearchParams();
  const shopId = searchParams.get('shopId');
  const { shop, services, staff, loading } = useShopDetails(shopId);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6" aria-busy="true" aria-label="Shop wird geladen">
        <div className="h-14 w-80 max-w-full animate-pulse rounded-2xl bg-muted" />
        <div className="h-48 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">Shop nicht gefunden.</h1>
        <p className="text-muted-foreground">Vielleicht ist der Link alt. Such den Laden einfach neu.</p>
        <Button asChild>
          <Link to="/shop-map">Shops finden</Link>
        </Button>
      </div>
    );
  }

  const address = [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address;
  const hours = ORDER.map((day) => ({ day, entry: shop.businessHoursByDay?.find((h) => h.dayOfWeek === day) }));
  const hasHours = hours.some((h) => h.entry);
  const team = staff.filter((s) => s.isActive !== false);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <ShopLogo url={shop.logoUrl} />
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{shop.name}</h1>
            {shop.industry && <p className="text-muted-foreground">{getIndustryNameById(shop.industry)}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {address && (
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {address}
            </p>
          )}
          {shop.phone && (
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              <a href={`tel:${shop.phone.replace(/\s/g, '')}`} className="underline-offset-4 hover:underline">
                {shop.phone}
              </a>
            </p>
          )}
        </div>
        {shop.description && <p className="max-w-2xl">{shop.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="signal" size="lg" asChild>
            <Link to={`/public-join-queue?shopId=${shop.id}`}>Nummer ziehen</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to={`/book-appointment?shopId=${shop.id}&fromMarketplace=true`}>Termin buchen</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="flex flex-col gap-3" aria-labelledby="leistungen">
          <h2 id="leistungen" className="font-display text-2xl font-bold">
            Leistungen
          </h2>
          {services.length === 0 ? (
            <p className="rounded-3xl border border-border bg-card p-5 text-muted-foreground">Noch keine Leistungen eingetragen.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card px-5">
              {services.map((service) => (
                <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-bold">{service.name}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono">{service.duration} Min</span> · <span className="font-mono">{euro(service.price)}</span>
                      {service.description && ` · ${service.description}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/public-join-queue?shopId=${shop.id}&serviceId=${service.id}`}>Einreihen</Link>
                    </Button>
                    <Button size="sm" asChild>
                      <Link to={`/book-appointment?shopId=${shop.id}&serviceId=${service.id}&fromMarketplace=true`}>Termin</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5" aria-labelledby="oeffnungszeiten">
            <h2 id="oeffnungszeiten" className="font-display text-lg font-bold">
              Öffnungszeiten
            </h2>
            {hasHours ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                {hours.map(({ day, entry }) => (
                  <div key={day} className="contents">
                    <dt className="text-muted-foreground">{DAYS[day]}</dt>
                    <dd className="font-mono">{entry?.isOpen ? `${entry.openTime}–${entry.closeTime}` : 'zu'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{shop.businessHours || 'Nicht angegeben.'}</p>
            )}
          </section>
          {team.length > 0 && (
            <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5" aria-labelledby="team">
              <h2 id="team" className="font-display text-lg font-bold">
                Team
              </h2>
              <ul className="flex flex-col gap-2">
                {team.map((person) => (
                  <li key={person.id} className="flex items-center gap-3">
                    {person.profileImageUrl ? (
                      <img src={person.profileImageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-sm font-bold text-signal" aria-hidden="true">
                        {person.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium">{person.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default ShopDetails;
