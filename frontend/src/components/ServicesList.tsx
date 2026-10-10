import React from 'react';
import { Service } from '../utils/firestore';
import { EditServiceDialog } from './ServiceDialogs';

export interface ServicesListProps {
  services: Service[];
  onServiceUpdated: (success: boolean) => void;
}

const euro = (value: number) => `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Leistungen als Liste: Name, Dauer, Preis, Bearbeiten */
export const ServicesList: React.FC<ServicesListProps> = ({ services, onServiceUpdated }) => {
  if (services.length === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6">
        <p className="font-display text-xl font-bold">Noch keine Leistung.</p>
        <p className="mt-1 text-sm text-muted-foreground">Leg mindestens eine an, zum Beispiel „Haarschnitt, 30 Minuten“. Ohne Leistung kann niemand buchen.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card px-5">
      {services.map((service) => (
        <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold">{service.name}</p>
            {(service.category || service.description) && (
              <p className="text-sm text-muted-foreground">{[service.category, service.description].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <p className="font-mono text-[15px]">
            {service.duration} Min{service.setupTime ? ` + ${service.setupTime} Rüstzeit` : ''}
          </p>
          <p className="w-24 text-right font-mono text-[15px] font-semibold">{euro(service.price)}</p>
          <EditServiceDialog service={service} onServiceUpdated={onServiceUpdated} />
        </li>
      ))}
    </ul>
  );
};
