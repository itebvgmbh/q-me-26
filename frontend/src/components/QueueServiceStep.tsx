import React from 'react';
import { Service } from '../utils/firestore/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';
import { intlSprache, t, tTeile } from '@/i18n';

export interface QueueServiceStepProps {
  services: Service[];
  selectedService: string;
  onSelectService: (serviceId: string) => void;
  onBack: () => void;
  arrivedFromQR: boolean;
  shopName: string | undefined;
}

const meta = (s: Service) =>
  [
    s.duration && t('{dauer} Min', { dauer: s.duration }),
    typeof s.price === 'number' &&
      t('{preis} €', { preis: s.price.toLocaleString(intlSprache(), { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }),
  ]
    .filter(Boolean)
    .join(' · ');

export const QueueServiceStep: React.FC<QueueServiceStepProps> = ({ services, selectedService, onSelectService, onBack, arrivedFromQR, shopName }) => (
  <QueueStepShell
    title={t('Was soll gemacht werden?')}
    description={
      shopName
        ? tTeile('bei <laden>{name}</laden>', { laden: (inhalt) => <strong className="text-foreground">{inhalt}</strong> }, { name: shopName })
        : undefined
    }
    onBack={onBack}
    backLabel={arrivedFromQR ? t('Auswahl zurücksetzen') : t('Anderen Laden wählen')}
  >
    {services.length === 0 ? (
      <p className="text-muted-foreground">{t('Dieser Laden hat noch keine Leistungen eingetragen.')}</p>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => (
          <QueueOption key={s.id} selected={s.id === selectedService} onClick={() => onSelectService(s.id)} title={s.name} meta={meta(s)} />
        ))}
      </div>
    )}
  </QueueStepShell>
);
