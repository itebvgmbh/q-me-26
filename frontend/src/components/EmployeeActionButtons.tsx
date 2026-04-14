import { Button } from '@/components/ui/button';

interface Props {
  onCreateCustomer: () => void;
  onEditWorkingHours: () => void;
}

/**
 * Action buttons for the employee dashboard
 */
export const EmployeeActionButtons = ({ onCreateCustomer, onEditWorkingHours }: Props) => {
  return (
    <div className="flex justify-end mb-6 gap-3">
      <Button
        size="sm"
        variant="outline"
        onClick={onCreateCustomer}
      >
        Kunde anlegen
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onEditWorkingHours}
      >
        Arbeitszeiten bearbeiten
      </Button>
    </div>
  );
};
