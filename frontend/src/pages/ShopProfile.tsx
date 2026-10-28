import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserGuardContext } from 'app';
import { ShopLogo } from '../components/brand/ShopLogo';
import { EditShopForm } from '../components/EditShopForm';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { ShopSwitcher } from '../components/ShopSwitcher';
import { WebseiteEinbau } from '../components/WebseiteEinbau';
import { LadenUebersicht } from '../components/LadenUebersicht';
import { useOwnedShops } from '../utils/hooks/useOwnedShops';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { merke, t } from '@/i18n';
import { getIndustryNameById } from '../utils/industries';
import { formatDayHours } from '../utils/opening-hours';

const DAYS = [merke('Sonntag'), merke('Montag'), merke('Dienstag'), merke('Mittwoch'), merke('Donnerstag'), merke('Freitag'), merke('Samstag')];
// Montag zuerst
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
    <div>{children}</div>
  </div>
);

/**
 * „Laden“ im Menü: Verwalten (Team, Leistungen, Auswertung, Tarif …), was auf diesem Gerät gilt, so sehen Kunden den
 * Laden, QR-Code mit Plakat und Wartezimmer-Bildschirm, Einbau auf der eigenen Webseite; bei mehreren Läden mit Ladenauswahl
 */
const ShopProfile = () => {
  const { user } = useUserGuardContext();
  const { shops, shop, selectShop, replaceShop, failed } = useOwnedShops(user.uid);
  const [showEditDialog, setShowEditDialog] = useState(false);

  if (shops === null) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6" aria-busy="true" aria-label={t('Laden wird geladen')}>
        <div className="h-16 w-72 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Laden nicht geladen.')}</h1>
        <p className="text-muted-foreground">{t('Deine Läden konnten gerade nicht geladen werden. Bitte lade die Seite neu.')}</p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Noch kein Laden.')}</h1>
        <p className="text-muted-foreground">{t('Richte deinen Laden in ein paar Fragen ein. Danach siehst du ihn hier so, wie Kunden ihn sehen.')}</p>
        <Button variant="signal" asChild>
          <Link to="/shop-setup">{t('Laden einrichten')}</Link>
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
            {shop.industry && <p className="text-muted-foreground">{t(getIndustryNameById(shop.industry))}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowEditDialog(true)}>{t('Bearbeiten')}</Button>
          <Button variant="outline" asChild>
            <Link to={`/shop-details?shopId=${shop.id}`}>{t('Kundenansicht')}</Link>
          </Button>
        </div>
      </div>

      <ShopSwitcher shops={shops} shopId={shop.id} onChange={selectShop} />

      <LadenUebersicht shopId={shop.id} />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="grid gap-6 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6" aria-label={t('Angaben zum Laden')}>
          <Block title={t('Adresse')}>{address || <span className="text-muted-foreground">{t('Noch keine Adresse – ohne sie findet dich niemand auf der Karte.')}</span>}</Block>
          <Block title={t('Kontakt')}>
            <p>{shop.phone ? <span dir="ltr">{shop.phone}</span> : '–'}</p>
            <p className="break-all">{shop.email || '–'}</p>
          </Block>
          <Block title={t('Öffnungszeiten')}>
            {hasHours ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                {hours.map(({ day, entry }) => (
                  <div key={day} className="contents">
                    <dt className="text-muted-foreground">{t(DAYS[day])}</dt>
                    <dd className="font-mono">{formatDayHours(entry)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>{shop.businessHours || <span className="text-muted-foreground">{t('Noch nicht eingetragen.')}</span>}</p>
            )}
          </Block>
          {shop.description && <Block title={t('Beschreibung')}>{shop.description}</Block>}
        </section>
        <QRCodeDisplay shopId={shop.id} shopName={shop.name} />
      </div>

      <WebseiteEinbau key={shop.id} shop={shop} />

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('Laden bearbeiten')}</DialogTitle>
            <DialogDescription>{t('Änderungen gelten sofort.')}</DialogDescription>
          </DialogHeader>
          <EditShopForm
            shop={shop}
            onUpdate={(updatedShop) => {
              replaceShop(updatedShop);
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
