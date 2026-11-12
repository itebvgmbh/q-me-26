import { Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { KopfLadenWahl } from '../utils/laden-kontext';

/**
 * Ladenauswahl in der Kopfzeile, gleich neben dem Logo – kein Menüpunkt, sondern „in welchem Laden bin ich“.
 * Nachgeladen (Navigation.tsx), nur wer mehrere Läden hat, braucht sie. Unten: „Alle Läden …“ (pages/Laeden.tsx).
 */
const ALLE = '__alle__';

const LadenWahlKopf = ({ wahl, className }: { wahl: KopfLadenWahl; className?: string }) => {
  const navigate = useNavigate();
  return (
  <Select value={wahl.laden.id} onValueChange={(id) => (id === ALLE ? navigate('/laeden') : wahl.waehle(id))}>
    <SelectTrigger
      aria-label={t('Laden wechseln')}
      className={cn(
        // Handy: was neben Zeichen und Menüknopf frei ist; ab md teilt sie sich die Zeile mit den Menüpunkten
        'h-10 w-auto min-w-0 max-w-[min(14rem,calc(100vw_-_8.5rem))] gap-2 rounded-full border-border bg-card px-3 text-[15px] font-semibold sm:max-w-[14rem] md:max-w-[12rem] lg:max-w-[16rem]',
        className,
      )}
    >
      <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-start">
        <SelectValue />
      </span>
    </SelectTrigger>
    <SelectContent>
      {wahl.laeden.map((s) => (
        <SelectItem key={s.id} value={s.id}>
          {s.name}
        </SelectItem>
      ))}
      <SelectSeparator />
      <SelectItem value={ALLE}>{t('Alle Läden …')}</SelectItem>
    </SelectContent>
  </Select>
  );
};

export default LadenWahlKopf;
