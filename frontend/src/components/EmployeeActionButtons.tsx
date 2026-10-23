import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CustomerListDialog } from './CustomerListDialog';

interface Props {
  shopId: string;
  onCreateCustomer: () => void;
  onEditWorkingHours: () => void;
}

/** Nebenaktionen in "Mein Tag" */
export const EmployeeActionButtons = ({ shopId, onCreateCustomer, onEditWorkingHours }: Props) => {
  const [showCustomers, setShowCustomers] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onCreateCustomer}>
        Kunde anlegen
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowCustomers(true)}>
        Kundenliste
      </Button>
      <Button size="sm" variant="outline" onClick={onEditWorkingHours}>
        Meine Arbeitszeiten
      </Button>
      <CustomerListDialog shopId={shopId} open={showCustomers} onOpenChange={setShowCustomers} />
    </div>
  );
};
