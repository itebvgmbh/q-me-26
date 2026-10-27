import React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Service, offeredServices, restoreService } from '../utils/firestore';
import { DeleteServiceDialog, EditServiceDialog } from './ServiceDialogs';

export interface ServicesListProps {
  /** alle Leistungen des Ladens, auch gelöschte (archived) */
  services: Service[];
  onServiceUpdated: (success: boolean) => void;
}

const euro = (value: number) => `${Number(value || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Leistungen als Liste: Name, Dauer, Preis, Bearbeiten, Löschen; darunter die gelöschten zum Zurückholen */
export const ServicesList: React.FC<ServicesListProps> = ({ services, onServiceUpdated }) => {
  const offered = offeredServices(services);
  const archived = services.filter((s) => s.archived);

  const restore = async (service: Service) => {
    try {
      await restoreService(service.id);
      toast.success(`„${service.name}“ ist wieder buchbar.`);
      onServiceUpdated(true);
    } catch (error) {
      console.error('Error restoring service:', error);
      toast.error('Zurückholen hat nicht geklappt.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {offered.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-6">
          <p className="font-display text-xl font-bold">Noch keine Leistung.</p>
          <p className="mt-1 text-sm text-muted-foreground">Leg mindestens eine an, zum Beispiel „Haarschnitt, 30 Minuten“. Ohne Leistung kann niemand buchen.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-card px-5">
          {offered.map((service) => (
            <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <p className="break-words font-display text-lg font-bold">{service.name}</p>
                {(service.category || service.description) && (
                  <p className="text-sm text-muted-foreground">{[service.category, service.description].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <p className="font-mono text-[15px]">
                {service.duration} Min{service.setupTime ? ` + ${service.setupTime} Vor-/Nachbereitung` : ''}
              </p>
              <p className="w-24 text-end font-mono text-[15px] font-semibold">{euro(service.price)}</p>
              <div className="flex gap-1">
                <EditServiceDialog service={service} onServiceUpdated={onServiceUpdated} />
                <DeleteServiceDialog service={service} onServiceUpdated={onServiceUpdated} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="rounded-3xl border border-dashed border-border px-5 py-3">
          <summary className="cursor-pointer py-1 text-sm font-semibold text-muted-foreground">Gelöschte Leistungen ({archived.length})</summary>
          <p className="pt-1 text-sm text-muted-foreground">Nicht mehr buchbar. Termine, die schon damit gebucht waren, behalten sie.</p>
          <ul className="flex flex-col divide-y divide-border">
            {archived.map((service) => (
              <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <p className="min-w-0 flex-1 break-words text-muted-foreground line-through">{service.name}</p>
                <Button variant="outline" size="sm" onClick={() => restore(service)}>
                  Zurückholen
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
