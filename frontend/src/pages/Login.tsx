import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth, useCurrentUser } from 'app';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t, tTeile } from '@/i18n';
import { AuthShell, EmailField, FormError, PasswordField } from '../components/auth/AuthShell';
import { authErrorMessage, safeRedirect } from '../utils/auth-errors';
import { requestPasswordReset } from '../utils/password-reset';
import { getRedirectPath } from '../utils/user-profile-service';
import { linkAnonymousBookingsToUser, type TicketToLink } from '../utils/AnonymousBookingLinker';

type LoginState = { redirectAfterLogin?: string; linkAnonymousBooking?: boolean } & TicketToLink;

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const state = (location.state || {}) as LoginState;
  // UserGuard hängt ?next= an, ältere Links ?returnTo=
  const next = safeRedirect(state.redirectAfterLogin) || safeRedirect(searchParams.get('next')) || safeRedirect(searchParams.get('returnTo'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user: signedIn } = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const linking = linkAnonymousBookingsToUser(state);
      // Nach "Nummer behalten" erst verknüpfen, damit sie in "Meine Termine" schon auftaucht
      if (state.linkAnonymousBooking) await linking;
      navigate(next || (await getRedirectPath(signedIn.uid)), { replace: true });
    } catch (err) {
      console.error('Login error:', err);
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setError(t('Gib oben deine E-Mail ein, dann schicken wir dir einen Link zum Zurücksetzen.'));
      return;
    }
    setResetting(true);
    try {
      await requestPasswordReset(email.trim());
      setError(null);
      toast.success(t('Wenn es ein Konto gibt, ist der Link unterwegs. Schau in dein Postfach.'));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  // Schon angemeldet (z. B. Zurück-Taste): direkt weiter
  if (!userLoading && user && !submitting) {
    return <Navigate to={next || '/'} replace />;
  }

  const registerSearch = next ? `?next=${encodeURIComponent(next)}` : '';
  const cameFromBooking = !!next && /^\/(public-join-queue|book-appointment)/.test(next);

  return (
    <AuthShell
      title={t('Willkommen zurück.')}
      intro={cameFromBooking ? t('Melde dich an, dann geht’s direkt weiter mit deiner Buchung.') : t('Melde dich an, um deine Nummern und Termine zu sehen.')}
      footer={
        <>
          <p>
            {tTeile('Noch kein Konto? <link>Jetzt registrieren</link>', {
              link: (inhalt) => (
                <Link to={`/register-options${registerSearch}`} state={location.state} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {inhalt}
                </Link>
              ),
            })}
          </p>
          {cameFromBooking && (
            <p>
              {tTeile('Ohne Konto geht’s auch: <link>Einfach einreihen</link>', {
                link: (inhalt) => (
                  <Link to="/public-join-queue" className="font-semibold text-foreground underline-offset-4 hover:underline">
                    {inhalt}
                  </Link>
                ),
              })}
            </p>
          )}
        </>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <EmailField value={email} onChange={(v) => { setEmail(v); setError(null); }} invalid={!!error} />
        <PasswordField value={password} onChange={setPassword} />
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? t('Anmelden …') : t('Anmelden')}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="self-center" onClick={handleReset} disabled={resetting}>
          {resetting ? t('Wird gesendet …') : t('Passwort vergessen?')}
        </Button>
      </form>
    </AuthShell>
  );
};

export default Login;
