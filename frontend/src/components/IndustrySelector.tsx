import { INDUSTRIES, getIndustryById } from '../utils/industries';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  selectedIndustry: string;
  onIndustryChange: (industry: string) => void;
}

export function IndustrySelector({ selectedIndustry, onIndustryChange }: Props) {
  return (
    <div className="space-y-2">
      <Label>Branche auswählen</Label>
      <Select value={selectedIndustry} onValueChange={onIndustryChange}>
        <SelectTrigger>
          <SelectValue placeholder="Branche auswählen" />
        </SelectTrigger>
        <SelectContent>
          {INDUSTRIES.map(industry => (
            <SelectItem key={industry.id} value={industry.id}>
              {industry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedIndustry && (
        <p className="text-sm text-gray-500 mt-1">
          {getIndustryById(selectedIndustry)?.description}
        </p>
      )}
    </div>
  );
}
