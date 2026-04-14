import React from 'react';
import { Service } from '../utils/firestore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EditServiceDialog } from './ServiceDialogs';

/**
 * Props for the ServicesList component
 */
export interface ServicesListProps {
  /** Array of services to display */
  services: Service[];
  /** Function to call when a service is updated */
  onServiceUpdated: (success: boolean) => void;
}

/**
 * Displays a list of services with their details
 */
export const ServicesList: React.FC<ServicesListProps> = ({ services, onServiceUpdated }) => {
  if (services.length === 0) {
    return (
      <p className="text-center text-muted-foreground">
        Noch keine Services vorhanden. Fügen Sie Ihren ersten Service hinzu.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {services.map((service) => (
        <ServiceCard 
          key={service.id} 
          service={service} 
          onServiceUpdated={onServiceUpdated} 
        />
      ))}
    </div>
  );
};

/**
 * Props for the ServiceCard component
 */
interface ServiceCardProps {
  /** The service to display */
  service: Service;
  /** Function to call when the service is updated */
  onServiceUpdated: (success: boolean) => void;
}

/**
 * Card component for displaying a single service
 */
const ServiceCard: React.FC<ServiceCardProps> = ({ service, onServiceUpdated }) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-lg">{service.name}</CardTitle>
          {service.category && (
            <CardDescription>{service.category}</CardDescription>
          )}
        </div>
        <EditServiceDialog
          service={service}
          onServiceUpdated={onServiceUpdated}
        />
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {service.description && (
            <p className="text-sm text-muted-foreground">
              {service.description}
            </p>
          )}
          <div className="flex justify-between text-sm">
            <div>
              <span>Dauer: {service.duration} Minuten</span>
              {service.setupTime && (
                <span className="ml-2">(Rüstzeit: {service.setupTime} Min.)</span>
              )}
            </div>
            <span>Preis: {service.price.toFixed(2)} €</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
