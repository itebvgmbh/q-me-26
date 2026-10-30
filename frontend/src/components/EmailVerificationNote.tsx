import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { firebaseAuth } from 'app';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { UserRole } from '../utils/types';
import { refreshVerified, sendVerificationMail, verificationMailMessage } from '../utils/email-verification';

/** Mein Profil: Ist die E-Mail-Adresse bestätigt? Sonst Hinweis und Knopf für eine neue Bestätigungs-Mail. Pflicht ist nichts. */
export const EmailVerificationNote = ({ role }: { role: UserRole }) => {
  const [verified, setVerified] = useState<boolean | null>(firebaseAuth.currentUser?.emailVerified ? true : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    const check = () => refreshVerified().then(setVerified, () => setVerified(firebaseAuth.currentUser?.emailVerified ?? false));
    check();
    // Link aus der Mail in einem anderen Tab geöffnet: beim Zurückkommen neu nachsehen
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendVerificationMail();
      if (result.status === 'bestaetigt') setVerified(true);
      setMessage({ text: verificationMailMessage(result), error: result.status !== 'verschickt' && result.status !== 'bestaetigt' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : t('Das hat nicht geklappt.'), error: true });
    } finally {
      setBusy(false);
    }
  };

  if (verified === null) return null;

  if (verified) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="email-bestaetigt">
        <BadgeCheck className="h-4 w-4 text-foreground" aria-hidden="true" />
        {t('E-Mail-Adresse bestätigt')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-signal bg-signal/10 p-4" data-testid="email-unbestaetigt">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{t('E-Mail-Adresse noch nicht bestätigt')}</p>
        <p className="text-sm text-muted-foreground">
          {t('Tipp auf den Link in unserer Bestätigungs-Mail, dann wissen wir, dass die Adresse dir gehört.')}
          {role === 'customer' && ' ' + t('Hat ein Laden dich mit dieser Adresse in seine Kundenliste eingetragen, kommen seine Termine dann in dein Konto, sobald du dort selbst buchst.')}
          {' ' + t('Keine E-Mail da? Schau im Spam-Ordner nach oder schick sie dir hier noch mal.')}
        </p>
      </div>
      {message && (
        <p role="status" className={message.error ? 'text-sm text-destructive' : 'text-sm'}>
          {message.text}
        </p>
      )}
      <Button type="button" variant="outline" className="self-start" onClick={send} disabled={busy}>
        {busy ? t('Wird verschickt …') : t('Bestätigungs-Mail noch mal schicken')}
      </Button>
    </div>
  );
};
