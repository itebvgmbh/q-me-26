import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmployeeSelection } from './EmployeeSelection';
import { Staff } from '../utils/firestore';

interface StaffSelectorStepProps {
  staff: Staff[];
  selectedService: string;
  selectedStaff: string;
  useAnyStaff: boolean;
  onSelectStaff: (staffId: string) => void;
  onSelectAny: () => void;
  onBack: () => void;
}

/**
 * Component for the staff selection step
 */
export const StaffSelectorStep: React.FC<StaffSelectorStepProps> = ({
  staff,
  selectedService,
  selectedStaff,
  useAnyStaff,
  onSelectStaff,
  onSelectAny,
  onBack
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
