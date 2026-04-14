import { Staff } from '../utils/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  staff: Staff[];
  selectedStaff: string;
  onStaffChange: (staffId: string) => void;
}

export function StaffSelector({ staff, selectedStaff, onStaffChange }: Props) {
  return (
    <div className="space-y-2">
      <Label>Mitarbeiter auswählen <span className="text-red-500">*</span></Label>
      <Select value={selectedStaff} onValueChange={onStaffChange} required>
        <SelectTrigger className={!selectedStaff ? "border-red-500" : ""}>
          <SelectValue placeholder="Mitarbeiter auswählen" />
        </SelectTrigger>
        <SelectContent>
          {staff.map(employee => (
            <SelectItem key={employee.id} value={employee.id}>
              {employee.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!selectedStaff && <p className="text-red-500 text-sm mt-1">Bitte wählen Sie einen Mitarbeiter aus</p>}
    </div>
  );
}
