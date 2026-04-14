import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { ServiceSelection } from './ServiceSelection';
import { Service } from '../utils/firestore';

interface ServiceSelectorStepProps {
  services: Service[];
  selectedService: string;
  onSelectService: (serviceId: string) => void;
  onBack: () => void;
  arrivedFromQR: boolean;
  shopName?: string;
}

/**
 * Component for the service selection step
 */
export const ServiceSelectorStep: React.FC<ServiceSelectorStepProps> = ({
  services,
  selectedService,
  onSelectService,
  onBack,
  arrivedFromQR,
  shopName
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
