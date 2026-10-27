import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useCurrentUser } from 'app';
import { Switch } from '@/components/ui/switch';
import { firestore } from '../utils/firestore-client';
import { FRUEHER_DRAN_VORLAUF_MINUTEN, setFrueherDran } from '../utils/frueher-dran';
import { t, tTeile } from '@/i18n';

/**
 * „Früher dran“ auf der Nummernseite für eine Nummer im eigenen Konto – etwa gleich nach „Konto anlegen und Nummer
 * behalten“ oder nach dem Anmelden. Vorher ging das nur unter „Meine Termine“. Ob es die eigene Nummer ist, zeigt der
 * Termin selbst: Lesen darf ihn nur das eigene Konto (firestore.rules); bis zum Übernehmen bleibt der Schalter weg.
 * claimedKey: ändert sich, sobald die Nummer übernommen ist (isAnonymous der Kurzfassung), dann neu nachsehen.
 */
export function FrueherDranSchalter({ appointmentId, start, claimedKey }: { appointmentId: string; start: Date; claimedKey: unknown }) {
  const { user } = useCurrentUser();
  const [on, setOn] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!user) {
      setOn(null);
      return;
    }
    let alive = true;
    getDoc(doc(firestore, 'appointments', appointmentId))
      .then((snap) => {
        const data = snap.data();
        if (alive) setOn(snap.exists() && data?.customerId === user.uid && data?.status === 'scheduled' ? data.checkEarlierOptions === true : null);
      })
      .catch(() => alive && setOn(null)); // nicht die eigene Nummer (noch nicht übernommen)
    return () => {
      alive = false;
    };
  }, [user, appointmentId, claimedKey]);

  if (on === null || start.getTime() - Date.now() <= FRUEHER_DRAN_VORLAUF_MINUTEN * 60_000) return null;

  const toggle = async (next: boolean) => {
    setSwitching(true);
    try {
      const now = await setFrueherDran(appointmentId, next);
      setOn(now);
      toast.success(now ? t('Früher dran ist an. Wird ein Platz frei, bekommst du ein Angebot.') : t('Früher dran ist aus.'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Das hat nicht geklappt. Versuch es noch einmal.'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border p-4">
      <label htmlFor="frueher-dran-nummer" className="flex cursor-pointer flex-col text-sm">
        <strong className="text-foreground">{t('Früher dran, wenn etwas frei wird')}</strong>
        <span className="text-muted-foreground">
          {on
            ? tTeile(
                'Ist an. Wird vorher ein Platz frei, bieten wir ihn dir an – annehmen unter <termine>Meine Termine</termine>. Deine Nummer bleibt sicher, bis du zusagst.',
                {
                  termine: (inhalt) => (
                    <Link to="/my-bookings" className="font-semibold underline underline-offset-2">
                      {inhalt}
                    </Link>
                  ),
                },
              )
            : t('Wir bieten dir einen früheren Platz an, wenn einer frei wird. Deine Nummer bleibt sicher, bis du zusagst.')}
        </span>
      </label>
      <Switch id="frueher-dran-nummer" checked={on} disabled={switching} onCheckedChange={toggle} className="mt-0.5" />
    </div>
  );
}
