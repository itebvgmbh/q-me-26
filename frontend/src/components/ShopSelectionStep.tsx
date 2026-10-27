import React from 'react';
import { Link } from 'react-router-dom';
import { Shop } from '../utils/firestore/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';
import { t } from '@/i18n';

export interface ShopSelectionStepProps {
  shops: Shop[];
  selectedShop: string;
  onSelectShop: (shopId: string) => void;
}

const address = (shop: Shop) =>
  [shop.street, [shop.postalCode, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || shop.address || '';

export const ShopSelectionStep: React.FC<ShopSelectionStepProps> = ({ shops, selectedShop, onSelectShop }) => (
  <QueueStepShell title={t('Wo möchtest du hin?')} description={t('Wähl den Laden, in dessen Schlange du dich einreihen willst.')}>
    {shops.length === 0 ? (
      <p className="text-muted-foreground">
        {t('Noch kein Laden eingetragen.')}{' '}
        <Link to="/" className="font-semibold underline">
          {t('Zur Startseite')}
        </Link>
      </p>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {shops.map((shop) => (
          <QueueOption key={shop.id} selected={selectedShop === shop.id} onClick={() => onSelectShop(shop.id)} title={shop.name} meta={address(shop)} />
        ))}
      </div>
    )}
  </QueueStepShell>
);
