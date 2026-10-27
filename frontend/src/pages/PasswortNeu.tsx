import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from 'firebase/auth';
import { firebaseAuth } from 'app';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t, tTeile } from '@/i18n';
import { AuthShell, FormError, PasswordField } from '../components/auth/AuthShell';
import { authErrorMessage } from '../utils/auth-errors';
import { getRedirectPath } from '../utils/user-profile-service';

// Link aus der Passwort-Mail (backend/app/apis/password_reset): /passwort-neu?code=…
// Der Code gilt eine Stunde und nur einmal. Danach meldet die Seite direkt an.

type State = 'pruefen' | 'formular' | 'fertig' | 'ungueltig' | 'offline';

const PasswortNeu = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code') || '';
  const [state, setState] = useState<State>(code ? 'pruefen' : 'ungueltig');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    // Nur prüfen, nicht einlösen – das passiert erst beim Speichern
    if (!code || checked.current) return;
    checked.current = true;
    verifyPasswordResetCode(firebaseAuth, code)
      .then((address) => {
        setEmail(address);
        setState('formular');
      })
      .catch((e: { code?: string }) => setState(e?.code === 'auth/network-request-failed' ? 'offline' : 'ungueltig'));
  }, [code]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await confirmPasswordReset(firebaseAuth, code, password);
    } catch (err) {
      const errCode = (err as { code?: string })?.code;
      if (errCode === 'auth/expired-action-code' || errCode === 'auth/invalid-action-code') setState('ungueltig');
      else setError(authErrorMessage(err));
      setSaving(false);
      return;
    }
    try {
      const { user } = await signInWithEmailAndPassword(firebaseAuth, email, password);
      toast.success(t('Dein neues Passwort ist gespeichert. Du bist angemeldet.'));
      navigate(await getRedirectPath(user.uid).catch(() => '/'), { replace: true });
    } catch {
      // Passwort ist geändert, nur das Anmelden klappte nicht (z. B. Netz weg): von Hand anmelden
      setState('fertig');
      setSaving(false);
    }
  };

  if (state === 'pruefen') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">{t('Link wird geprüft …')}</span>
      </div>
    );
  }

  if (state === 'formular') {
    return (
      <AuthShell
        title={t('Neues Passwort.')}
        intro={tTeile('Für dein Konto <email/>.', { email: () => <strong className="text-foreground" dir="ltr">{email}</strong> })}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          {error && <FormError>{error}</FormError>}
          {/* Für Passwort-Manager: zu welchem Konto das neue Passwort gehört */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <PasswordField value={password} onChange={(v) => { setPassword(v); setError(null); }} isNew label={t('Neues Passwort')} />
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? t('Wird gespeichert …') : t('Passwort speichern')}
          </Button>
        </form>
      </AuthShell>
    );
  }

  if (state === 'fertig') {
    return (
      <AuthShell title={t('Gespeichert.')} intro={t('Dein neues Passwort gilt ab sofort. Melde dich damit an.')}>
        <Button asChild size="lg" className="w-full">
          <Link to="/login">{t('Anmelden')}</Link>
        </Button>
      </AuthShell>
    );
  }

  if (state === 'offline') {
    return (
      <AuthShell title={t('Keine Verbindung.')} intro={t('Prüf dein Internet und öffne den Link aus der E-Mail noch einmal.')}>
        <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
          {t('Noch mal versuchen')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('Dieser Link klappt nicht.')}
      intro={t('Der Link ist abgelaufen oder wurde schon benutzt. Er gilt nur eine Stunde. Fordere beim Anmelden unter „Passwort vergessen?“ einfach einen neuen an.')}
    >
      <Button asChild size="lg" className="w-full">
        <Link to="/login">{t('Zum Anmelden')}</Link>
      </Button>
    </AuthShell>
  );
};

export default PasswortNeu;
