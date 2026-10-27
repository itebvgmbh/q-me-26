import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { merke, t, tTeile } from '@/i18n';
import { registerWithRole } from '../../utils/auth-helpers';
import { authErrorMessage, safeRedirect } from '../../utils/auth-errors';
import { linkAnonymousBookingsToUser, type TicketToLink } from '../../utils/AnonymousBookingLinker';
import { sendVerificationMailAfterSignUp } from '../../utils/email-verification';
import { UserRole } from '../../utils/types';
import { AuthShell, EmailField, FormError, PasswordField } from './AuthShell';

interface Props {
  role: Extract<UserRole, 'customer' | 'shopOwner'>;
}

// Texte mit merke(), angezeigt mit t(); im Wechsel-Satz steht der Link als <link>…</link>
const COPY = {
  customer: {
    title: merke('Konto anlegen'),
    intro: merke('Deine Nummern und Termine an einem Ort. Und wir bieten dir frühere Plätze an, wenn etwas frei wird.'),
    submit: merke('Konto anlegen'),
    switchText: merke('Du hast einen Laden? <link>Als Laden registrieren</link>'),
    switchLink: '/register-shop-owner',
    home: '/my-bookings',
  },
  shopOwner: {
    title: merke('Laden anmelden'),
    intro: merke('Leg dein Konto an. Danach führe ich dich in ein paar Fragen durch Laden, Öffnungszeiten, Leistungen und Team.'),
    submit: merke('Konto für deinen Laden anlegen'),
    switchText: merke('Du willst nur buchen? <link>Als Kunde registrieren</link>'),
    switchLink: '/register-customer',
    home: '/shop-setup',
  },
} as const;

/** Registrierung für Kunden und Betriebe – Firebase prüft die E-Mail, Fehler stehen am Formular */
export const RegisterForm = ({ role }: Props) => {
  const copy = COPY[role];
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as { redirectAfterLogin?: string; linkAnonymousBooking?: boolean } & TicketToLink;
  const next = safeRedirect(state.redirectAfterLogin) || safeRedirect(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await registerWithRole(email.trim(), password, role);
      if (role === 'customer') {
        // Nummern, die in diesem Browser ohne Konto gezogen wurden, übernehmen
        await linkAnonymousBookingsToUser(state);
      }
      toast.success(t('Dein Konto ist angelegt.'));
      sendVerificationMailAfterSignUp();
      navigate(next || copy.home, { replace: true });
    } catch (err) {
      console.error('Registration error:', err);
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const loginSearch = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <AuthShell
      title={t(copy.title)}
      intro={t(copy.intro)}
      footer={
        <>
          <p>
            {tTeile('Schon ein Konto? <link>Anmelden</link>', {
              link: (inhalt) => (
                <Link to={`/login${loginSearch}`} state={location.state} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {inhalt}
                </Link>
              ),
            })}
          </p>
          <p>
            {tTeile(copy.switchText, {
              link: (inhalt) => (
                <Link to={copy.switchLink} state={location.state} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {inhalt}
                </Link>
              ),
            })}
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <EmailField value={email} onChange={(v) => { setEmail(v); setError(null); }} invalid={!!error} />
        <PasswordField value={password} onChange={setPassword} isNew />
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? t('Wird angelegt …') : t(copy.submit)}
        </Button>
      </form>
    </AuthShell>
  );
};
