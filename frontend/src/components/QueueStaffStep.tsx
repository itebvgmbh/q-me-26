import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmployeeSelection } from './EmployeeSelection';
import { Staff } from '../utils/firestore/types';

export interface QueueStaffStepProps {
  staff: Staff[];
  selectedService: string;
  selectedStaff: string;
  onSelectStaff: (staffId: string) => void;
  onSelectAny: () => void;
  useAnyStaff: boolean;
  onBack: () => void;
}

/**
 * Component for selecting a staff member in the queue process
 * Displays available staff members for the selected service
 */
export const QueueStaffStep: React.FC<QueueStaffStepProps> = ({
  staff,
  selectedService,
  selectedStaff,
  onSelectStaff,
  onSelectAny,
  useAnyStaff,
  onBack,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mitarbeiter auswählen</CardTitle>
        <CardDescription>
          Wählen Sie einen Mitarbeiter oder den nächsten freien Mitarbeiter
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmployeeSelection 
          staff={staff}
          selectedService={selectedService}
          selectedStaff={selectedStaff}
          onSelectStaff={onSelectStaff}
          onSelectAny={onSelectAny}
          useAnyStaff={useAnyStaff}
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
