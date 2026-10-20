import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCurrentUser } from 'app';
import { Button } from '@/components/ui/button';
import { AuthShell } from '../components/auth/AuthShell';
import { confirmEmail, refreshVerified } from '../utils/email-verification';

// Link aus der Bestätigungs-Mail (backend/app/apis/email_verification): /email-bestaetigen?code=…
// Geht auch ohne Anmeldung, etwa wenn die Mail auf dem Handy geöffnet wird und das Konto am Rechner angemeldet ist.

type State = 'laeuft' | 'bestaetigt' | 'ungueltig' | 'offline';

const EmailBestaetigen = () => {
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const { user, loading } = useCurrentUser();
  const [state, setState] = useState<State>(code ? 'laeuft' : 'ungueltig');
  const tried = useRef(false);

  useEffect(() => {
    // Ein Code gilt nur einmal: nicht doppelt einlösen (React ruft Effekte in der Entwicklung zweimal auf)
    if (!code || tried.current) return;
    tried.current = true;
    confirmEmail(code)
      .then(() => setState('bestaetigt'))
      .catch(async (e: { code?: string }) => {
        if (e?.code === 'auth/network-request-failed') return setState('offline');
        // Schon eingelöst (zweimal getippt)? Dann ist die Adresse ja bestätigt
        const verified = await refreshVerified().catch(() => false);
        setState(verified ? 'bestaetigt' : 'ungueltig');
      });
  }, [code]);

  if (state === 'laeuft' || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">E-Mail-Adresse wird bestätigt …</span>
      </div>
    );
  }

  if (state === 'bestaetigt') {
    return (
      <AuthShell title="Bestätigt." intro="Deine E-Mail-Adresse ist bestätigt. Du musst sonst nichts weiter tun.">
        <Button asChild size="lg" className="w-full">
          {user ? <Link to="/profile">Zu meinem Profil</Link> : <Link to="/login">Anmelden</Link>}
        </Button>
      </AuthShell>
    );
  }

  if (state === 'offline') {
    return (
      <AuthShell title="Keine Verbindung." intro="Deine Adresse ist noch nicht bestätigt. Prüf dein Internet und öffne den Link aus der E-Mail noch einmal.">
        <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
          Noch mal versuchen
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Dieser Link klappt nicht."
      intro={
        user
          ? 'Der Link ist abgelaufen oder wurde schon benutzt. Im Profil siehst du, ob deine Adresse bestätigt ist, und schickst dir bei Bedarf eine neue E-Mail.'
          : 'Der Link ist abgelaufen oder wurde schon benutzt. Melde dich an: Im Profil siehst du, ob deine Adresse bestätigt ist, und schickst dir bei Bedarf eine neue E-Mail.'
      }
    >
      <Button asChild size="lg" className="w-full">
        {user ? <Link to="/profile">Zu meinem Profil</Link> : <Link to={`/login?next=${encodeURIComponent('/profile')}`}>Anmelden</Link>}
      </Button>
    </AuthShell>
  );
};

export default EmailBestaetigen;
