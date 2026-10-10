import { Button } from '@/components/ui/button';

interface Props {
  onCreateCustomer: () => void;
  onEditWorkingHours: () => void;
}

/** Nebenaktionen in "Mein Tag" */
export const EmployeeActionButtons = ({ onCreateCustomer, onEditWorkingHours }: Props) => (
  <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" onClick={onCreateCustomer}>
      Kunde anlegen
    </Button>
    <Button size="sm" variant="outline" onClick={onEditWorkingHours}>
      Meine Arbeitszeiten
    </Button>
  </div>
);
