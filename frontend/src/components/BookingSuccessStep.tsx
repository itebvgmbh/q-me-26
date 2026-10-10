import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isTomorrow } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Ticket } from './brand/Ticket';
import { TimeSlot } from '../utils/types';

export interface BookingSuccessStepProps {
  bookingReference: string;
  shopId: string;
  slot?: TimeSlot | null;
  shopName?: string;
  serviceName?: string;
  staffName?: string;
}

// Kurz halten, damit die Monospace-Zeile im Ticket nicht umbricht
const dayLabel = (d: Date) => (isToday(d) ? 'Heute' : isTomorrow(d) ? 'Morgen' : format(d, 'EEEEEE d.M.', { locale: de }));

/** Wartemarke nach dem Einreihen ohne Konto */
export const BookingSuccessStep: React.FC<BookingSuccessStepProps> = ({ bookingReference, shopId, slot, shopName, serviceName, staffName }) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5">
      <Ticket
        size="lg"
        eyebrow="Deine Nummer"
        eyebrowRight={[serviceName, staffName].filter(Boolean).join(' · ')}
        number={bookingReference || '—'}
        stats={
          slot
            ? [
                { label: 'Dran um ca.', value: format(slot.start, 'HH:mm') },
                { label: 'Wann', value: dayLabel(slot.start) },
              ]
            : []
        }
        footer={shopName ? <p className="text-sm font-semibold">{shopName}</p> : undefined}
      />

      <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
        <p className="font-semibold">Mach einen Screenshot von deiner Nummer.</p>
        <p className="text-sm text-muted-foreground">
          Ohne Konto schicken wir dir keine Erinnerung. Mit Konto siehst du die Nummer unter „Meine Termine“ und bekommst frühere
          Plätze angeboten. Deine Nummer wird dabei übernommen.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="lg"
          className="sm:flex-1"
          onClick={() =>
            navigate('/register-customer', {
              state: { redirectAfterLogin: '/my-bookings', linkAnonymousBooking: true, shopId, referenceCode: bookingReference },
            })
          }
        >
          Konto anlegen und Nummer behalten
        </Button>
        <Button size="lg" variant="outline" className="sm:flex-1" onClick={() => navigate('/')}>
          Fertig
        </Button>
      </div>
    </div>
  );
};
