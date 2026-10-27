import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDoc } from 'firebase/firestore';
import { ArrowRight } from 'lucide-react';
import { firestore } from '../../utils/firestore-client';
import { publicRef } from '../../utils/firestore/public-appointments';
import { getRememberedTickets } from '../../utils/push';
import { t } from '@/i18n';

interface OpenTicket {
  id: string;
  /** Nummer, wenn es schon eine gibt */
  code?: string;
}

/** Hinweis auf eine heute noch offene Nummer dieses Geräts – wer die Seite geschlossen hat, findet sie hier. */
export const ActiveTicketBanner = () => {
  const [ticket, setTicket] = useState<OpenTicket | null>(null);

  useEffect(() => {
    const today = new Date().toDateString();
    const candidates = getRememberedTickets().filter((stored) => new Date(stored.start).toDateString() === today);
    if (candidates.length === 0) return;
    let alive = true;
    (async () => {
      for (const candidate of candidates) {
        try {
          const snap = await getDoc(publicRef(firestore, candidate.id));
          const data = snap.data();
          if (snap.exists() && (data?.status === 'scheduled' || data?.status === 'in-progress')) {
            if (alive) setTicket({ id: candidate.id, code: data?.referenceCode || undefined });
            return;
          }
        } catch {
          /* offline: kein Hinweis */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!ticket) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
      <Link
        to={`/nummer/${ticket.id}`}
        className="flex items-center justify-between gap-3 rounded-2xl bg-signal px-5 py-4 font-semibold text-signal-foreground"
      >
        <span>
          {ticket.code
            ? t('Nummer {nummer} ist noch offen. Zur Nummer', { nummer: ticket.code })
            : t('Deine Nummer ist noch offen. Zur Nummer')}
        </span>
        <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
      </Link>
    </div>
  );
};
