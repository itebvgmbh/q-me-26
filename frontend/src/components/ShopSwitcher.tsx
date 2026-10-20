import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Shop } from '../utils/firestore';

/** Ladenauswahl für Inhaber mehrerer Läden; bei einem Laden nichts */
export const ShopSwitcher = ({ shops, shopId, onChange }: { shops: Shop[]; shopId?: string; onChange: (shopId: string) => void }) =>
  shops.length > 1 ? (
    <Select value={shopId} onValueChange={onChange}>
      <SelectTrigger className="sm:w-72" aria-label="Laden wählen">
        <SelectValue placeholder="Laden wählen" />
      </SelectTrigger>
      <SelectContent>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;
