import { Service } from '../utils/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  services: Service[];
  selectedService: string;
  onServiceChange: (serviceId: string) => void;
}

export function ServiceSelector({ services, selectedService, onServiceChange }: Props) {
  return (
    <div className="space-y-2">
      <Label>Service auswählen</Label>
      <Select value={selectedService} onValueChange={onServiceChange}>
        <SelectTrigger>
          <SelectValue placeholder="Service auswählen" />
        </SelectTrigger>
        <SelectContent>
          {services.map(service => (
            <SelectItem key={service.id} value={service.id}>
              {service.name} - {service.duration} Min. - {service.price.toFixed(2)} €
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
