import { sendPasswordResetEmail } from 'firebase/auth';
import { firebaseAuth } from 'app';

// Passwort vergessen: Die Mail verschickt das Backend über Resend (backend/app/apis/password_reset), der Link darin
// führt auf /passwort-neu?code=… (pages/PasswortNeu.tsx). Ist dort kein Resend eingerichtet oder der Server nicht
// erreichbar, verschickt Firebase seine eigene Mail – Hauptsache, niemand bleibt ausgesperrt.

/** Passwort-Mail anfordern; wirft mit lesbarer Meldung (Firebase-Fehler mit code, siehe auth-errors.ts) */
export const requestPasswordReset = async (email: string): Promise<void> => {
  let res: Response | null = null;
  try {
    res = await fetch('/routes/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    res = null;
  }
  if (res?.ok) {
    const { status } = (await res.json()) as { status: 'verschickt' | 'nicht_eingerichtet' };
    if (status === 'verschickt') return;
  } else if (res && res.status < 500) {
    // 400 (Adresse falsch), 429 (zu oft): Meldung des Servers zeigen
    let detail = '';
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(typeof detail === 'string' && detail ? detail : `Das hat nicht geklappt (Fehler ${res.status}).`);
  }
  await sendPasswordResetEmail(firebaseAuth, email);
};
