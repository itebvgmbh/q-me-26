import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { auth, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { HilfeLink } from '../components/HilfeLink';
import { createFirebaseUser } from '../utils/auth-helpers';
import { authErrorMessage } from '../utils/auth-errors';
import { emitProfileSaved, getUserProfile } from '../utils/user-profile-service';
import { acceptStaffInvite, getStaffInviteInfo, StaffInviteInfo } from '../utils/staff-invitation';
import { AuthShell, EmailField, FormError, PasswordField } from '../components/auth/AuthShell';

// Einladungslink fürs Team: Der Inhaber hat die Person unter "Team" angelegt und ihr diesen Link geschickt.
// Neues Konto anlegen oder mit dem bestehenden anmelden (auch ein Kundenkonto oder das Konto eines anderen Ladens) –
// das Backend verbindet dann genau diesen Eintrag (backend/app/apis/staff_invitation).

const StaffRegistration = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, loading: userLoading } = useCurrentUser();

  const [info, setInfo] = useState<StaffInviteInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [accountExists, setAccountExists] = useState(false);
  // Während der Registrierung ist man schon angemeldet – trotzdem das Formular stehen lassen
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    if (!token) {
      setInfoError('In diesem Link fehlt etwas. Bitte deinen Laden, ihn noch einmal zu schicken.');
      return;
    }
    getStaffInviteInfo(token)
      .then((i) => {
        setInfo(i);
        setEmail(i.email);
      })
      .catch((e: Error) => setInfoError(e.message));
  }, [token]);

  /** Eintrag mit dem angemeldeten Konto verbinden, Navigation auf die neue Rolle umstellen, weiter zu "Mein Tag" */
  const finish = useCallback(
    async (uid: string) => {
      const res = await acceptStaffInvite(token);
      const profile = await getUserProfile(uid);
      if (profile) emitProfileSaved(uid, profile);
      toast.success(`Willkommen im Team von ${res.shopName}!`);
      navigate(`/employee-dashboard?staffId=${encodeURIComponent(res.staffId)}`, { replace: true });
    },
    [token, navigate],
  );

  const accept = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await finish(user.uid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }, [user, finish]);

  // Zurück vom Anmelden: gleich annehmen, dafür hat sich die Person ja gerade angemeldet
  useEffect(() => {
    if (params.get('annehmen') === '1' && user && !registering && info?.status === 'offen' && !autoTried.current) {
      autoTried.current = true;
      accept();
    }
  }, [params, user, registering, info, accept]);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAccountExists(false);
    setBusy(true);
    setRegistering(true);
    try {
      let created;
      try {
        created = await createFirebaseUser(email.trim(), password);
      } catch (err) {
        if ((err as { code?: string })?.code === 'auth/email-already-in-use') {
          setAccountExists(true);
          setError('Mit dieser E-Mail gibt es schon ein Konto. Melde dich damit an, dann nimmst du die Einladung an.');
        } else {
          setError(authErrorMessage(err));
        }
        setRegistering(false);
        return;
      }
      try {
        await finish(created.uid);
      } catch (err) {
        // Konto wieder entfernen, sonst ist die E-Mail verbraucht und der Link nutzlos
        await created.delete().catch((deleteError) => console.error('Rollback of auth user failed:', deleteError));
        setRegistering(false);
        setError(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
      }
    } finally {
      setBusy(false);
    }
  };

  const back = `/staff-registration?token=${encodeURIComponent(token)}&annehmen=1`;
  const loginLink = `/login?next=${encodeURIComponent(back)}`;

  if (infoError) {
    return (
      <AuthShell title="Dieser Link klappt nicht." intro={infoError}>
        <Button asChild variant="outline">
          <Link to="/">Zur Startseite</Link>
        </Button>
      </AuthShell>
    );
  }

  if (!info || userLoading) {
    return (
      <AuthShell title="Einladung wird geprüft …">
        <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
      </AuthShell>
    );
  }

  if (info.status === 'abgelaufen') {
    return (
      <AuthShell title="Die Einladung gilt nicht mehr." intro={`Bitte ${info.shopName} um einen neuen Link. Im Team unter „Bearbeiten“ geht das in einer Minute.`}>
        <Button asChild variant="outline">
          <Link to="/">Zur Startseite</Link>
        </Button>
      </AuthShell>
    );
  }

  if (info.status === 'verbunden') {
    return (
      <AuthShell title="Schon angenommen." intro={`Diese Einladung ist schon mit einem Konto verbunden. Melde dich damit an, dann siehst du deinen Tag bei ${info.shopName}.`}>
        <Button asChild size="lg" className="w-full">
          <Link to={user ? '/employee-dashboard' : `/login?next=${encodeURIComponent('/employee-dashboard')}`}>{user ? 'Zu Mein Tag' : 'Anmelden'}</Link>
        </Button>
      </AuthShell>
    );
  }

  const title = `Willkommen im Team von ${info.shopName}.`;
  const help = (
    <HilfeLink hilfe="fuers-team" className="self-start text-sm">
      So arbeitest du mit Dranzeit
    </HilfeLink>
  );

  if (user && !registering) {
    return (
      <AuthShell
        title={title}
        intro={`${info.shopName} hat dich${info.name ? ` als ${info.name}` : ''} ins Team eingeladen. Nimm die Einladung mit deinem Konto an, dann siehst du unter „Mein Tag“ deine Kunden.`}
        footer={
          <p>
            Nicht dein Konto?{' '}
            <button type="button" onClick={() => auth.signOut()} className="font-semibold text-foreground underline-offset-4 hover:underline">
              Abmelden
            </button>
          </p>
        }
      >
        <div className="flex flex-col gap-4">
          {error && <FormError>{error}</FormError>}
          <p className="text-sm text-muted-foreground">
            Angemeldet als <strong className="text-foreground">{user.email}</strong>
          </p>
          <Button size="lg" onClick={accept} disabled={busy}>
            {busy ? 'Wird angenommen …' : 'Einladung annehmen'}
          </Button>
          {help}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={title}
      intro={`${info.shopName} hat dich${info.name ? ` als ${info.name}` : ''} ins Team eingeladen. Leg dein Konto an, danach siehst du unter „Mein Tag“ deine Kunden.`}
      footer={
        <p>
          Schon ein Konto bei Dranzeit?{' '}
          <Link to={loginLink} className="font-semibold text-foreground underline-offset-4 hover:underline">
            Anmelden und annehmen
          </Link>
        </p>
      }
    >
      <form onSubmit={register} className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        {accountExists && (
          <Button asChild size="lg" variant="signal">
            <Link to={loginLink}>Anmelden und annehmen</Link>
          </Button>
        )}
        <EmailField
          value={email}
          onChange={(v) => {
            setEmail(v);
            setError('');
            setAccountExists(false);
          }}
          invalid={!!error}
        />
        <PasswordField value={password} onChange={setPassword} isNew />
        <Button type="submit" size="lg" variant={accountExists ? 'outline' : 'default'} disabled={busy}>
          {busy ? 'Wird angelegt …' : 'Konto anlegen'}
        </Button>
        {help}
      </form>
    </AuthShell>
  );
};

export default StaffRegistration;
