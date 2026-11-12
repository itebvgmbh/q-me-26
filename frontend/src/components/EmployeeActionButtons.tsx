import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

interface Props {
  shopId: string;
  onCreateCustomer: () => void;
  onEditWorkingHours: () => void;
}

/** Nebenaktionen in "Mein Tag". Die Kunden mit Verlauf und Notizen stehen auf der eigenen Seite „Kunden“ (pages/Kunden.tsx). */
export const EmployeeActionButtons = ({ shopId, onCreateCustomer, onEditWorkingHours }: Props) => (
  <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" onClick={onCreateCustomer}>
      {t('Kunde anlegen')}
    </Button>
    <Button size="sm" variant="outline" asChild>
      <Link to={`/kunden?shopId=${encodeURIComponent(shopId)}`}>{t('Kunden')}</Link>
    </Button>
    <Button size="sm" variant="outline" onClick={onEditWorkingHours}>
      {t('Meine Arbeitszeiten')}
    </Button>
  </div>
);
