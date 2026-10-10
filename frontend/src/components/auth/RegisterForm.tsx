import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { registerWithRole } from '../../utils/auth-helpers';
import { authErrorMessage, safeRedirect } from '../../utils/auth-errors';
import { linkAnonymousBookingsToUser } from '../../utils/AnonymousBookingLinker';
import { UserRole } from '../../utils/types';
import { AuthShell, EmailField, FormError, PasswordField } from './AuthShell';

interface Props {
  role: Extract<UserRole, 'customer' | 'shopOwner'>;
}

const COPY = {
  customer: {
    title: 'Konto anlegen',
    intro: 'Deine Nummern und Termine an einem Ort. Und wir bieten dir frühere Plätze an, wenn etwas frei wird.',
    submit: 'Konto anlegen',
    switchText: 'Du hast einen Betrieb?',
    switchLink: '/register-shop-owner',
    switchLabel: 'Als Betrieb registrieren',
    home: '/my-bookings',
  },
  shopOwner: {
    title: 'Betrieb anmelden',
    intro: 'Leg dein Konto an. Danach richtest du Laden, Leistungen und Team ein.',
    submit: 'Konto für Betrieb anlegen',
    switchText: 'Du willst nur buchen?',
    switchLink: '/register-customer',
    switchLabel: 'Als Kunde registrieren',
    home: '/shop-dashboard',
  },
} as const;

/** Registrierung für Kunden und Betriebe – Firebase prüft die E-Mail, Fehler stehen am Formular */
export const RegisterForm = ({ role }: Props) => {
  const copy = COPY[role];
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = (location.state || {}) as { redirectAfterLogin?: string; linkAnonymousBooking?: boolean; shopId?: string; referenceCode?: string };
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
        await linkAnonymousBookingsToUser(user.uid, state.shopId, state.referenceCode);
      }
      toast.success('Dein Konto ist angelegt.');
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
      title={copy.title}
      intro={copy.intro}
      footer={
        <>
          <p>
            Schon ein Konto?{' '}
            <Link to={`/login${loginSearch}`} state={location.state} className="font-semibold text-foreground underline-offset-4 hover:underline">
              Anmelden
            </Link>
          </p>
          <p>
            {copy.switchText}{' '}
            <Link to={copy.switchLink} state={location.state} className="font-semibold text-foreground underline-offset-4 hover:underline">
              {copy.switchLabel}
            </Link>
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <EmailField value={email} onChange={(v) => { setEmail(v); setError(null); }} invalid={!!error} />
        <PasswordField value={password} onChange={setPassword} isNew />
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Wird angelegt …' : copy.submit}
        </Button>
      </form>
    </AuthShell>
  );
};
