import { Staff, Shop, Service, deleteStaff } from '../utils/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { EditStaffDialog } from './EditStaffDialog';

/**
 * Props for StaffCard component
 */
export interface StaffCardProps {
  /** Staff member to display */
  employee: Staff;
  /** Current shop */
  shop: Shop;
  /** Available services */
  services: Service[];
  /** Callback function when staff data is updated */
  onStaffUpdated: () => Promise<void>;
}

/**
 * Card component for displaying individual staff member information
 * Includes profile details and actions like edit and deactivate
 */
export const StaffCard = ({ employee, shop, services, onStaffUpdated }: StaffCardProps) => {
  /**
   * Handle staff deactivation (soft delete)
   */
  const handleDeactivateStaff = async () => {
    try {
      await deleteStaff(employee.id);
      await onStaffUpdated();
      toast.success('Mitarbeiter deaktiviert');
    } catch (error) {
      console.error('Error deleting staff:', error);
      toast.error('Fehler beim Deaktivieren des Mitarbeiters');
    }
  };
  
  return (
    <Card key={employee.id}>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          {employee.profileImageUrl ? (
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-primary">
              <img 
                src={employee.profileImageUrl} 
                alt={`${employee.name} Profilbild`} 
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
              {employee.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h3 className="font-semibold">{employee.name}</h3>
            <p className="text-sm text-gray-500">{employee.role}</p>
            <p className="text-sm">{employee.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EditStaffDialog
            staff={employee}
            services={services}
            shop={shop}
            onStaffUpdated={onStaffUpdated}
          />
          <Button
            variant="destructive"
            onClick={handleDeactivateStaff}
          >
            Deaktivieren
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};