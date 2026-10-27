import { Clock } from 'lucide-react';
import { BusinessHoursDay } from '../utils/firestore';
import { DAY_NAMES } from '../utils/opening-hours';
import { t } from '@/i18n';

interface Props {
  businessHours: BusinessHoursDay[];
}

/**
 * Displays a shop's business hours organized by day of week
 * Shows open/closed status and hours of operation for each day
 */
export const BusinessHours = ({ businessHours }: Props) => {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium flex items-center gap-1">
        <Clock className="h-4 w-4" /> {t('Öffnungszeiten')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {businessHours.map((day) => (
          <div key={day.dayOfWeek} className="flex justify-between text-sm">
            <span className="font-medium">{DAY_NAMES[day.dayOfWeek]}:</span>
            <span>
              {day.isOpen ? `${day.openTime} - ${day.closeTime}` : t('Geschlossen')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
