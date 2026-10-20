import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth, useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { AuthShell, FormError } from '../components/auth/AuthShell';

// Kunden-Link: Ein Laden hat die Person unter "Mein Tag" angelegt und ihr diesen Link geschickt.
// Prüfen und Verbinden macht das Backend (backend/app/apis/customer_activation), Link erzeugt CreateCustomerForm.

type Info = { status: 'offen' | 'verbunden' | 'abgelaufen'; shopName: string };

const call = async <T,>(token: string, method: 'GET' | 'POST'): Promise<T> => {
  const headers: Record<string, string> = {};
  if (method === 'POST') headers.Authorization = await auth.getAuthHeaderValue();
  let res: Response;
  try {
    res = await fetch(`/routes/customer-activation/${encodeURIComponent(token)}`, { method, headers });
  } catch {
    throw new Error('Keine Verbindung zum Server. Bitte prüf dein Internet.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(typeof detail === 'string' && detail ? detail : `Das hat nicht geklappt (Fehler ${res.status}).`);
  }
  return (await res.json()) as T;
};

const Activate = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, loading: userLoading } = useCurrentUser();
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ shopName: string; moved: number } | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    if (!token) {
      setInfoError('In diesem Link fehlt etwas. Bitte den Laden, ihn noch einmal zu schicken.');
      return;
    }
    call<Info>(token, 'GET')
      .then(setInfo)
      .catch((e: Error) => setInfoError(e.message));
  }, [token]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setDone(await call<{ shopName: string; moved: number }>(token, 'POST'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }, [token]);

  // Zurück vom Anmelden oder Registrieren: gleich verbinden, die Person hat sich ja gerade dafür angemeldet
  useEffect(() => {
    if (params.get('verbinden') === '1' && user && info?.status === 'offen' && !autoTried.current) {
      autoTried.current = true;
      connect();
    }
  }, [params, user, info, connect]);

  const back = `/activate?token=${encodeURIComponent(token)}&verbinden=1`;
  const next = `?next=${encodeURIComponent(back)}`;

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
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">Link wird geprüft …</span>
      </div>
    );
  }

  if (done) {
    return (
      <AuthShell
        title="Verbunden."
        intro={`Deine Termine bei ${done.shopName} stehen jetzt unter „Meine Termine“.`}
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/my-bookings">Zu meinen Terminen</Link>
        </Button>
      </AuthShell>
    );
  }

  if (info.status === 'abgelaufen') {
    return (
      <AuthShell title="Der Link ist abgelaufen." intro={`Bitte ${info.shopName} um einen neuen. Beim nächsten Besuch geht das in einer Minute.`}>
        <Button asChild variant="outline">
          <Link to="/">Zur Startseite</Link>
        </Button>
      </AuthShell>
    );
  }

  if (info.status === 'verbunden') {
    return (
      <AuthShell title="Schon verbunden." intro={`Dieser Link wurde schon mit einem Konto verbunden. Die Termine bei ${info.shopName} stehen dort unter „Meine Termine“.`}>
        <Button asChild size="lg" className="w-full">
          <Link to={user ? '/my-bookings' : `/login?next=${encodeURIComponent('/my-bookings')}`}>{user ? 'Zu meinen Terminen' : 'Anmelden'}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`${info.shopName} hat dich angelegt.`}
      intro={`Verbinde dein Dranzeit-Konto, dann siehst du deine Termine bei ${info.shopName} jederzeit unter „Meine Termine“. Wird ein früherer Platz frei, können wir ihn dir anbieten.`}
      footer={
        user ? (
          <p>
            Nicht dein Konto?{' '}
            <button type="button" onClick={() => auth.signOut()} className="font-semibold text-foreground underline-offset-4 hover:underline">
              Abmelden
            </button>
          </p>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        {user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Angemeldet als <strong className="text-foreground">{user.email}</strong>
            </p>
            <Button size="lg" onClick={connect} disabled={busy}>
              {busy ? 'Wird verbunden …' : 'Mit diesem Konto verbinden'}
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="lg">
              <Link to={`/register-customer${next}`}>Konto anlegen</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to={`/login${next}`}>Ich habe schon ein Konto</Link>
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
};

export default Activate;
