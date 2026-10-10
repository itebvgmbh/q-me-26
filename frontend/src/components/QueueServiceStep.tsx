import React from 'react';
import { Service } from '../utils/firestore/types';
import { QueueOption, QueueStepShell } from './queue/QueueStepShell';

export interface QueueServiceStepProps {
  services: Service[];
  selectedService: string;
  onSelectService: (serviceId: string) => void;
  onBack: () => void;
  arrivedFromQR: boolean;
  shopName: string | undefined;
}

const meta = (s: Service) =>
  [s.duration && `${s.duration} Min`, typeof s.price === 'number' && `${s.price.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`]
    .filter(Boolean)
    .join(' · ');

export const QueueServiceStep: React.FC<QueueServiceStepProps> = ({ services, selectedService, onSelectService, onBack, arrivedFromQR, shopName }) => (
  <QueueStepShell
    title="Was soll gemacht werden?"
    description={shopName ? <>bei <strong className="text-foreground">{shopName}</strong></> : undefined}
    onBack={onBack}
    backLabel={arrivedFromQR ? 'Auswahl zurücksetzen' : 'Anderen Shop wählen'}
  >
    {services.length === 0 ? (
      <p className="text-muted-foreground">Dieser Shop hat noch keine Leistungen eingetragen.</p>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => (
          <QueueOption key={s.id} selected={s.id === selectedService} onClick={() => onSelectService(s.id)} title={s.name} meta={meta(s)} />
        ))}
      </div>
    )}
  </QueueStepShell>
);
