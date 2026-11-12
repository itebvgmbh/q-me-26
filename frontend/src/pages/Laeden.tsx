import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Settings, Store, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, tn } from '@/i18n';
import { ShopLogo } from '../components/brand/ShopLogo';
import { LadenLoeschenDialog } from '../components/LadenLoeschenDialog';
import { useInhaberLaden } from '../utils/laden-kontext';
import { effectivePlan, isSuspended } from '../utils/plans';
import { inStoreApp } from '../utils/app-shell';
import type { Shop } from '../utils/firestore';

/** Tarif in einer Zeile: „Testphase: noch 12 Tage“, „Tarif Laden“, „Gratis“ … */
const tarifZeile = (shop: Shop) => {
  const plan = effectivePlan(shop);
  if (plan.source === 'test') return tn(plan.trialDaysLeft, 'Testphase: noch {n} Tag', 'Testphase: noch {n} Tage');
  if (plan.source === 'gratis') return t('Gratis');
  const name = t('Tarif {tarif}', { tarif: t(plan.plan.name) });
  if (plan.source === 'freischaltung') return t('{tarif}, freigeschaltet', { tarif: name });
  return shop.billing?.cancelAtPeriodEnd ? t('{tarif}, gekündigt', { tarif: name }) : name;
};

const adresse = (shop: Shop) =>
  [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address || '';

/**
 * „Meine Läden“: alle Läden des Inhabers auf einen Blick – öffnen, verwalten, weiteren einrichten, löschen.
 * Gewechselt wird sonst oben in der Kopfzeile (components/LadenWahlKopf.tsx); jeder Laden hat seinen eigenen Tarif.
 */
const Laeden = () => {
  const navigate = useNavigate();
  const { laeden, laden: gewaehlt, fehler, entferne } = useInhaberLaden();
  const [loeschen, setLoeschen] = useState<Shop | null>(null);
  const verkauf = !inStoreApp();

  if (laeden === null) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6" aria-busy="true" aria-label={t('Wird geladen')}>
        <div className="h-12 w-64 animate-pulse rounded-2xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-48 animate-pulse rounded-3xl bg-muted" />
          <div className="h-48 animate-pulse rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  if (fehler) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{t('Läden nicht geladen.')}</h1>
        <p className="text-muted-foreground">{t('Deine Läden konnten gerade nicht geladen werden. Bitte lade die Seite neu.')}</p>
      </div>
    );
  }

  const oeffne = (shopId: string, ziel: string) => navigate(`${ziel}?shopId=${encodeURIComponent(shopId)}`);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('Konto')}</p>
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Meine Läden')}</h1>
          {laeden.length > 0 && (
            <p className="text-muted-foreground">
              {tn(laeden.length, 'Du hast {n} Laden.', 'Du hast {n} Läden.')} {verkauf && t('Jeder Laden hat seinen eigenen Tarif.')}
            </p>
          )}
        </div>
        <Button variant={laeden.length ? 'outline' : 'signal'} size="lg" className="self-start sm:self-auto" asChild>
          <Link to="/shop-setup">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {laeden.length ? t('Weiteren Laden einrichten') : t('Laden einrichten')}
          </Link>
        </Button>
      </header>

      {laeden.length === 0 ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">
          {t('Noch kein Laden. Richte deinen Laden in ein paar Fragen ein – das dauert etwa zehn Minuten.')}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {laeden.map((shop) => {
            const ort = adresse(shop);
            const aktuell = gewaehlt?.id === shop.id && laeden.length > 1;
            return (
              <li key={shop.id} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
                <div className="flex items-start gap-4">
                  <ShopLogo url={shop.logoUrl} className="h-14 w-14" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2 className="break-words font-display text-xl font-bold">{shop.name}</h2>
                    <p className="text-sm text-muted-foreground">{ort || t('ohne Adresse')}</p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-sm">
                      {verkauf && <span>{tarifZeile(shop)}</span>}
                      {aktuell && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{t('gerade gewählt')}</span>}
                      {isSuspended(shop) && (
                        <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">{t('gesperrt')}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button variant="signal" onClick={() => oeffne(shop.id, '/shop-dashboard')}>
                    <Store className="h-4 w-4" aria-hidden="true" />
                    {t('Öffnen')}
                  </Button>
                  <Button variant="outline" onClick={() => oeffne(shop.id, '/shop-profile')}>
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    {t('Verwalten')}
                  </Button>
                  {/* Handy: nur das Symbol, sonst passt die Zeile nicht */}
                  <Button variant="ghost" className="ms-auto px-3" onClick={() => setLoeschen(shop)} aria-label={t('„{name}“ löschen', { name: shop.name })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('Löschen')}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <LadenLoeschenDialog
        shop={loeschen}
        onClose={() => setLoeschen(null)}
        onDeleted={(id) => {
          setLoeschen(null);
          entferne(id);
        }}
      />
    </div>
  );
};

export default Laeden;
