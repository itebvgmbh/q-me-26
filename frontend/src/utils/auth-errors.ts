import { merke, t } from '@/i18n';

// Firebase-Fehlercodes in verständliche Sätze übersetzen (du-Form); angezeigt wird t(text)
const MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': merke('Für diese E-Mail gibt es schon ein Konto. Melde dich an oder setz dein Passwort zurück.'),
  'auth/invalid-email': merke('Diese E-Mail-Adresse sieht nicht richtig aus.'),
  'auth/weak-password': merke('Das Passwort ist zu kurz. Nimm mindestens 6 Zeichen.'),
  'auth/missing-password': merke('Bitte gib ein Passwort ein.'),
  'auth/invalid-credential': merke('E-Mail oder Passwort stimmen nicht.'),
  'auth/invalid-login-credentials': merke('E-Mail oder Passwort stimmen nicht.'),
  'auth/wrong-password': merke('E-Mail oder Passwort stimmen nicht.'),
  'auth/user-not-found': merke('E-Mail oder Passwort stimmen nicht.'),
  'auth/user-disabled': merke('Dieses Konto ist gesperrt.'),
  'auth/too-many-requests': merke('Zu viele Versuche. Warte kurz und versuch es dann noch einmal.'),
  'auth/network-request-failed': merke('Keine Verbindung. Prüf dein Internet und versuch es noch einmal.'),
  'auth/operation-not-allowed': merke('Anmelden mit E-Mail ist für diese App gerade nicht freigeschaltet.'),
  'permission-denied': merke('Dein Profil konnte nicht gespeichert werden (keine Berechtigung).'),
};

export const authErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  if (code && MESSAGES[code]) return t(MESSAGES[code]);
  const message = (error as { message?: string })?.message;
  return message ? t('Das hat nicht geklappt: {message}', { message }) : t('Das hat nicht geklappt. Versuch es noch einmal.');
};

/** Nur interne Pfade zulassen, damit ?next= nicht auf fremde Seiten umleitet */
export const safeRedirect = (value: string | null | undefined): string | null =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null;
