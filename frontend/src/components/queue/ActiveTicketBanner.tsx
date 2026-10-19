import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowRight } from 'lucide-react';
import { firestore } from '../../utils/firestore-client';
import { getRememberedTickets } from '../../utils/push';

interface OpenTicket {
  id: string;
  label: string;
}

/** Hinweis auf eine heute noch offene Nummer dieses Geräts – wer die Seite geschlossen hat, findet sie hier. */
export const ActiveTicketBanner = () => {
  const [ticket, setTicket] = useState<OpenTicket | null>(null);

  useEffect(() => {
    const today = new Date().toDateString();
    const candidates = getRememberedTickets().filter((t) => new Date(t.start).toDateString() === today);
    if (candidates.length === 0) return;
    let alive = true;
    (async () => {
      for (const t of candidates) {
        try {
          const snap = await getDoc(doc(firestore, 'appointments', t.id));
          const data = snap.data();
          if (snap.exists() && (data?.status === 'scheduled' || data?.status === 'in-progress')) {
            if (alive) setTicket({ id: t.id, label: data?.referenceCode ? `Nummer ${data.referenceCode}` : 'Deine Nummer' });
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
        <span>{ticket.label} ist noch offen. Zur Nummer</span>
        <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
      </Link>
    </div>
  );
};
