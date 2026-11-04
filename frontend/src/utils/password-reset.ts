import { t } from '@/i18n';

// Passwort vergessen: Die Mail verschickt das Backend über Resend (backend/app/apis/password_reset), der Link darin
// führt auf /passwort-neu?code=… (pages/PasswortNeu.tsx).

/** Passwort-Mail anfordern; wirft mit lesbarer Meldung (Fehler mit code, siehe auth-errors.ts) */
export const requestPasswordReset = async (email: string): Promise<void> => {
  let res: Response;
  try {
    res = await fetch('/routes/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw Object.assign(new Error('auth/network-request-failed'), { code: 'auth/network-request-failed' });
  }
  if (res.ok) {
    const { status } = (await res.json()) as { status: 'verschickt' | 'nicht_eingerichtet' };
    if (status === 'verschickt') return;
    throw new Error(t('Der E-Mail-Versand ist gerade nicht eingerichtet. Versuch es später noch mal.'));
  }
  let detail = '';
  try {
    detail = (await res.json())?.detail;
  } catch {
    /* keine JSON-Antwort */
  }
  throw new Error(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
};
