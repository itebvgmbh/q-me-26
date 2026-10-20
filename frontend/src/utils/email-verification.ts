import { applyActionCode } from 'firebase/auth';
import { toast } from 'sonner';
import { auth, firebaseAuth } from 'app';

// E-Mail-Adresse bestätigen: Die Mail verschickt das Backend über Resend (backend/app/apis/email_verification),
// der Link darin führt auf /email-bestaetigen?code=… (pages/EmailBestaetigen.tsx). Pflicht ist das nirgends.

export type VerificationMailStatus = 'verschickt' | 'bestaetigt' | 'testadresse' | 'nicht_eingerichtet';
export type VerificationMailResult = { status: VerificationMailStatus; email: string };

/** Bestätigungs-Mail an die Adresse des angemeldeten Kontos; wirft mit lesbarer Meldung */
export const sendVerificationMail = async (): Promise<VerificationMailResult> => {
  let res: Response;
  try {
    res = await fetch('/routes/email-verification', { method: 'POST', headers: { Authorization: await auth.getAuthHeaderValue() } });
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
  return (await res.json()) as VerificationMailResult;
};

/** Text zum Ergebnis, für Profil und Registrieren */
export const verificationMailMessage = ({ status, email }: VerificationMailResult): string =>
  ({
    verschickt: `Wir haben dir eine E-Mail an ${email} geschickt. Tipp auf den Link darin, dann ist deine Adresse bestätigt.`,
    bestaetigt: 'Deine E-Mail-Adresse ist schon bestätigt.',
    testadresse: 'An Testadressen wie example.com verschickt Dranzeit keine E-Mails.',
    nicht_eingerichtet: 'Der E-Mail-Versand ist gerade nicht eingerichtet. Versuch es später noch mal.',
  })[status];

/** Gleich nach dem Registrieren mit E-Mail und Passwort, im Hintergrund: Bestätigungs-Mail, bei Erfolg ein Hinweis. Wirft nie. */
export const sendVerificationMailAfterSignUp = (): void => {
  sendVerificationMail().then(
    (result) => {
      if (result.status === 'verschickt') toast(verificationMailMessage(result), { duration: 8000 });
    },
    (e) => console.warn('Bestätigungs-Mail nicht verschickt:', e),
  );
};

/** Bestätigt die Adresse mit dem Code aus der Mail. Ist jemand angemeldet, kennt sein Konto danach den neuen Stand. */
export const confirmEmail = async (code: string): Promise<void> => {
  await applyActionCode(firebaseAuth, code);
  await refreshVerified();
};

/** Stand der Bestätigung frisch von Firebase holen (z. B. nachdem der Link in einem anderen Tab geöffnet wurde) */
export const refreshVerified = async (): Promise<boolean> => {
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser;
  if (!user) return false;
  const before = user.emailVerified;
  await user.reload();
  // Neues ID-Token, damit auch das Backend den neuen Stand sieht
  if (user.emailVerified && !before) await user.getIdToken(true);
  return user.emailVerified;
};
