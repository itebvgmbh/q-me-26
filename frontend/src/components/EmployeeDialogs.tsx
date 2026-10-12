import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Staff } from '../utils/firestore';
import { WorkingHoursForm } from './WorkingHoursForm';
import { CreateCustomerForm } from './CreateCustomerForm';

interface WorkingHoursDialogProps {
  employee: Staff;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updatedEmployee: Staff) => void;
}

/**
 * Dialog for editing working hours
 */
export const WorkingHoursDialog = ({ 
  employee, 
  open, 
  onOpenChange, 
  onUpdate 
}: WorkingHoursDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Arbeitszeiten bearbeiten</DialogTitle>
          <DialogDescription>
            Deine regulären Arbeitszeiten. Nur darin kann man bei dir buchen.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <WorkingHoursForm
            employee={employee}
            onUpdate={(updatedEmployee) => {
              console.log('Updating employee working hours:', updatedEmployee);
              onUpdate(updatedEmployee);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface CreateCustomerDialogProps {
  shopId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerCreated: () => void;
}

/**
 * Dialog for creating a new customer
 */
export const CreateCustomerDialog = ({ 
  shopId, 
  open, 
  onOpenChange, 
  onCustomerCreated 
}: CreateCustomerDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuen Kunden anlegen</DialogTitle>
          <DialogDescription>
            Die Person bekommt einen Link, um ihr Konto zu aktivieren.
          </DialogDescription>
        </DialogHeader>
        <CreateCustomerForm
          shopId={shopId}
          onCustomerCreated={() => {
            onCustomerCreated();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
