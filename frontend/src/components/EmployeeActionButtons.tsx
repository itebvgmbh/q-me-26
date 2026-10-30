import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CustomerListDialog } from './CustomerListDialog';
import { t } from '@/i18n';

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
        {t('Kunde anlegen')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowCustomers(true)}>
        {t('Kundenliste')}
      </Button>
      <Button size="sm" variant="outline" onClick={onEditWorkingHours}>
        {t('Meine Arbeitszeiten')}
      </Button>
      <CustomerListDialog shopId={shopId} open={showCustomers} onOpenChange={setShowCustomers} />
    </div>
  );
};
