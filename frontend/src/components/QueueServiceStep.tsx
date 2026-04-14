import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ServiceSelection } from './ServiceSelection';
import { Service } from '../utils/firestore/types';
import { CheckCircle2 } from 'lucide-react';

export interface QueueServiceStepProps {
  services: Service[];
  selectedService: string;
  onSelectService: (serviceId: string) => void;
  onBack: () => void;
  arrivedFromQR: boolean;
  shopName: string | undefined;
}

/**
 * Component for selecting a service in the queue process
 * Displays available services for the user to select
 */
export const QueueServiceStep: React.FC<QueueServiceStepProps> = ({
  services,
  selectedService,
  onSelectService,
  onBack,
  arrivedFromQR,
  shopName,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service auswählen</CardTitle>
        <CardDescription>
          {arrivedFromQR && (
            <span className="text-green-600 flex items-center mb-2">
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Shop vorausgewählt über QR-Code: {shopName}
            </span>
          )}
          Wählen Sie den gewünschten Service
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ServiceSelection 
          services={services} 
          selectedService={selectedService} 
          onSelectService={onSelectService} 
        />
      </CardContent>
      <CardFooter className="flex justify-start">
        <Button 
          variant="outline" 
          onClick={onBack}
        >
          Zurück
        </Button>
      </CardFooter>
    </Card>
  );
};
