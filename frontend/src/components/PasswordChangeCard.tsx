import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { toast } from 'sonner';
import { firebaseAuth } from 'app';
import { Button } from '@/components/ui/button';
import { FormError, PasswordField } from './auth/AuthShell';
import { authErrorMessage } from '../utils/auth-errors';
import { requestPasswordReset } from '../utils/password-reset';

const MIN_LENGTH = 6; // wie beim Registrieren (Firebase verlangt mindestens 6)
const WRONG_CURRENT = new Set(['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password']);

/**
 * Passwort ändern (Mein Profil, alle Rollen): Firebase verlangt dafür eine frische Anmeldung, deshalb zuerst das
 * aktuelle Passwort. Andere Geräte meldet Firebase nach der Änderung ab. Wer das aktuelle nicht mehr weiß, bekommt
 * die Mail wie bei „Passwort vergessen?“ (utils/password-reset.ts).
 */
export const PasswordChangeCard = () => {
  const user = firebaseAuth.currentUser;
  const email = user?.email || '';
  const hasPassword = Boolean(user?.providerData.some((p) => p.providerId === 'password'));
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !email) return;
    if (next.length < MIN_LENGTH) return setError(`Das neue Passwort ist zu kurz. Nimm mindestens ${MIN_LENGTH} Zeichen.`);
    if (next === current) return setError('Das neue Passwort ist dasselbe wie das alte.');
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, current));
      await updatePassword(user, next);
      setCurrent('');
      setNext('');
      toast.success('Dein Passwort ist geändert.');
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      setError(WRONG_CURRENT.has(code) ? 'Das aktuelle Passwort stimmt nicht.' : authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    setResetting(true);
    try {
      await requestPasswordReset(email);
      toast.success(`Wir haben dir eine E-Mail an ${email} geschickt. Über den Link darin legst du ein neues Passwort fest.`);
    } catch (err) {
      toast.error(authErrorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6" aria-labelledby="passwort-aendern">
      <h2 id="passwort-aendern" className="font-display text-xl font-bold">
        Passwort ändern
      </h2>
      {hasPassword ? (
        <form onSubmit={change} className="flex flex-col gap-4">
          {/* Damit Passwort-Manager wissen, zu welchem Konto das neue Passwort gehört */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          {error && <FormError>{error}</FormError>}
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField
              id="current-password"
              label="Aktuelles Passwort"
              value={current}
              onChange={(v) => {
                setCurrent(v);
                setError(null);
              }}
            />
            <PasswordField
              id="new-password"
              label="Neues Passwort"
              isNew
              value={next}
              onChange={(v) => {
                setNext(v);
                setError(null);
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">Auf deinen anderen Geräten musst du dich danach neu anmelden.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Wird geändert …' : 'Passwort ändern'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={sendReset} disabled={resetting}>
              {resetting ? 'Wird gesendet …' : 'Aktuelles Passwort vergessen?'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Dein Konto hat noch kein Passwort. Wir schicken dir eine E-Mail an {email || 'deine Adresse'}, über den Link darin legst du eins fest.
          </p>
          <Button variant="outline" className="self-start" onClick={sendReset} disabled={resetting || !email}>
            {resetting ? 'Wird gesendet …' : 'Passwort festlegen'}
          </Button>
        </div>
      )}
    </section>
  );
};
