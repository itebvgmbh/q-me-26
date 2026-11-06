import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { auth } from 'app';
import { Button } from '@/components/ui/button';
import { COMPANY } from '@/constants/legal';
import { t, tTeile } from '@/i18n';
import { UserRole } from '../utils/types';
import { deleteOwnAccount } from '../utils/datenschutz';

/** Konto löschen (Mein Profil): Kunden selbst, Läden und Teams per E-Mail. Was gelöscht wird: backend/app/libs/privacy.py */
export const DeleteAccountCard = ({ role }: { role: UserRole }) => {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteOwnAccount();
      await auth.signOut().catch(() => undefined);
      toast.success(t('Dein Konto ist gelöscht.'));
      navigate('/', { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Das hat nicht geklappt.'));
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="konto-loeschen">
      <h2 id="konto-loeschen" className="font-display text-xl font-bold">
        {t('Konto löschen')}
      </h2>
      {role !== 'customer' ? (
        <p className="text-sm text-muted-foreground">
          {tTeile('An Konten von Läden und Teams hängen Abo, Rechnungen und die Daten des Ladens. Die löschen wir auf Anfrage: Schreib an <mail/>, am besten von der E-Mail-Adresse deines Kontos.', {
            mail: () => (
              <a href={`mailto:${COMPANY.email}`} dir="ltr" className="font-semibold underline underline-offset-2">
                {COMPANY.email}
              </a>
            ),
          })}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('Wir löschen dein Konto und dein Profil. Kommende Termine sagen wir ab, bei früheren entfernen wir deinen Namen. Hat ein Laden dich in seine Kundenliste eingetragen und du hast dein Konto verbunden, verschwindet auch dieser Eintrag.')}
          </p>
          {asking ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
              <p className="text-sm font-semibold">{t('Wirklich? Das lässt sich nicht rückgängig machen.')}</p>
              <div className="flex gap-2">
                <Button variant="destructive" className="flex-1" onClick={remove} disabled={busy}>
                  {busy ? t('Wird gelöscht …') : t('Ja, Konto löschen')}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setAsking(false)} disabled={busy}>
                  {t('Behalten')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="self-start" onClick={() => setAsking(true)}>
              {t('Konto löschen')}
            </Button>
          )}
        </>
      )}
    </section>
  );
};
