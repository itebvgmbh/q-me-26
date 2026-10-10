import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getStaffInvitation, useStaffInvitation as markInvitationUsed, updateStaffWithUserId, StaffInvitation } from '../utils/firestore';
import { createUserProfile } from '../utils/user-profile-service';
import { createFirebaseUser } from '../utils/auth-helpers';
import { authErrorMessage } from '../utils/auth-errors';
import { AuthShell, FormError, PasswordField } from '../components/auth/AuthShell';

/** Einladungslink für Mitarbeiter: Passwort festlegen, fertig */
const StaffRegistration = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [invitation, setInvitation] = useState<StaffInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInviteError('In diesem Link fehlt die Einladung. Öffne den Link aus deiner E-Mail noch einmal.');
      setLoading(false);
      return;
    }
    getStaffInvitation(token)
      .then((inv) => {
        if (inv) setInvitation(inv);
        else setInviteError('Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitte deinen Betrieb um einen neuen Link.');
      })
      .catch((err) => {
        console.error('Error checking invitation:', err);
        setInviteError('Die Einladung konnte nicht geprüft werden. Versuch es gleich noch einmal.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await createFirebaseUser(invitation.email, password);
      try {
        await updateStaffWithUserId(invitation.email, user.uid);
        await createUserProfile(user.uid, invitation.email, 'employee');
        await markInvitationUsed(invitation.id);
      } catch (err) {
        // Konto wieder entfernen, sonst ist die E-Mail verbraucht und der Link nutzlos
        await user.delete().catch((deleteError) => console.error('Rollback of auth user failed:', deleteError));
        throw err;
      }
      toast.success('Willkommen im Team!');
      navigate('/employee-dashboard', { replace: true });
    } catch (err) {
      console.error('Error during registration:', err);
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthShell title="Einladung wird geprüft …">
        <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
      </AuthShell>
    );
  }

  if (inviteError || !invitation) {
    return (
      <AuthShell
        title="Das hat nicht geklappt."
        footer={
          <p>
            Schon ein Konto?{' '}
            <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
              Anmelden
            </Link>
          </p>
        }
      >
        <FormError>{inviteError}</FormError>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Willkommen im Team." intro={<>Leg ein Passwort für <strong className="text-foreground">{invitation.email}</strong> fest. Danach siehst du deinen Tag.</>}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <PasswordField value={password} onChange={setPassword} isNew />
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Wird angelegt …' : 'Konto anlegen'}
        </Button>
      </form>
    </AuthShell>
  );
};

export default StaffRegistration;
