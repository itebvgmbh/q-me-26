import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Service, Staff } from '../utils/firestore';

interface Props {
  staff: Staff[];
  services: Service[];
}

/**
 * Displays the staff/team members of a shop
 * Shows staff details and their services
 */
export const StaffList = ({ staff, services }: Props) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Unser Team</CardTitle>
        <CardDescription>
          {staff.length} Mitarbeiter
        </CardDescription>
      </CardHeader>
      <CardContent>
        {staff.length > 0 ? (
          <div className="space-y-4">
            {staff.map(employee => (
              <StaffMember 
                key={employee.id} 
                employee={employee} 
                services={services} 
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Mitarbeiter verfügbar</p>
        )}
      </CardContent>
    </Card>
  );
};

interface StaffMemberProps {
  employee: Staff;
  services: Service[];
}

/**
 * Individual staff member component
 * Displays profile image, name, role, and services
 */
const StaffMember = ({ employee, services }: StaffMemberProps) => {
  return (
    <div className="flex items-center space-x-4">
      <Avatar className="h-16 w-16">
        {employee.profileImageUrl ? (
          <img src={employee.profileImageUrl} alt={employee.name} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            {employee.name.substring(0, 2).toUpperCase()}
          </div>
        )}
      </Avatar>
      <div className="space-y-1">
        <h4 className="text-base font-medium">{employee.name}</h4>
        <p className="text-sm text-muted-foreground">{employee.role || 'Mitarbeiter'}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {employee.serviceIds && employee.serviceIds.length > 0 && 
            employee.serviceIds
              .map(serviceId => services.find(s => s.id === serviceId))
              .filter(Boolean)
              .slice(0, 3)
              .map(service => (
                <Badge key={service!.id} variant="outline" className="text-xs">
                  {service!.name}
                </Badge>
              ))
          }
          {employee.serviceIds && employee.serviceIds.length > 3 && (
            <Badge variant="outline" className="text-xs">+{employee.serviceIds.length - 3} weitere</Badge>
          )}
        </div>
      </div>
    </div>
  );
};
