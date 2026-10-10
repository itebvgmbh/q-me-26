import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserGuardContext } from 'app';
import { ShopLogo } from '../components/brand/ShopLogo';
import { getShopByOwner, Shop } from '../utils/firestore';
import { EditShopForm } from '../components/EditShopForm';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getIndustryNameById } from '../utils/industries';

const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// Montag zuerst
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
    <div>{children}</div>
  </div>
);

/** Mein Laden: so sehen Kunden den Laden, plus QR-Code zum Aufhängen */
const ShopProfile = () => {
  const { user } = useUserGuardContext();
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);

  useEffect(() => {
    getShopByOwner(user.uid)
      .then((data) => setShop(data as Shop | null))
      .catch((error) => console.error('Error loading shop:', error))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6" aria-busy="true" aria-label="Laden wird geladen">
        <div className="h-16 w-72 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">Noch kein Laden.</h1>
        <p className="text-muted-foreground">Leg deinen Laden am Tresen an. Danach siehst du ihn hier so, wie Kunden ihn sehen.</p>
        <Button variant="signal" asChild>
          <Link to="/shop-dashboard">Zum Tresen</Link>
        </Button>
      </div>
    );
  }

  const address = [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address;
  const hours = ORDER.map((day) => ({ day, entry: shop.businessHoursByDay?.find((h) => h.dayOfWeek === day) }));
  const hasHours = hours.some((h) => h.entry);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <ShopLogo url={shop.logoUrl} />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">{shop.name}</h1>
            {shop.industry && <p className="text-muted-foreground">{getIndustryNameById(shop.industry)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowEditDialog(true)}>Bearbeiten</Button>
          <Button variant="outline" asChild>
            <Link to={`/shop-details?shopId=${shop.id}`}>Kundenansicht</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="grid gap-6 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6" aria-label="Angaben zum Laden">
          <Block title="Adresse">{address || <span className="text-muted-foreground">Noch keine Adresse – ohne sie findet dich niemand auf der Karte.</span>}</Block>
          <Block title="Kontakt">
            <p>{shop.phone || '–'}</p>
            <p className="break-all">{shop.email || '–'}</p>
          </Block>
          <Block title="Öffnungszeiten">
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
              <p>{shop.businessHours || <span className="text-muted-foreground">Noch nicht eingetragen.</span>}</p>
            )}
          </Block>
          {shop.description && <Block title="Beschreibung">{shop.description}</Block>}
        </section>
        <QRCodeDisplay shopId={shop.id} shopName={shop.name} />
      </div>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Laden bearbeiten</DialogTitle>
            <DialogDescription>Änderungen gelten sofort, auch für die Shop-Suche.</DialogDescription>
          </DialogHeader>
          <EditShopForm
            shop={shop}
            onUpdate={(updatedShop) => {
              setShop(updatedShop);
              setShowEditDialog(false);
            }}
            onCancel={() => setShowEditDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShopProfile;
