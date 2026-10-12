// Firebase-Fehlercodes in verständliche Sätze übersetzen (du-Form)
const MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto. Melde dich an oder setz dein Passwort zurück.',
  'auth/invalid-email': 'Diese E-Mail-Adresse sieht nicht richtig aus.',
  'auth/weak-password': 'Das Passwort ist zu kurz. Nimm mindestens 6 Zeichen.',
  'auth/missing-password': 'Bitte gib ein Passwort ein.',
  'auth/invalid-credential': 'E-Mail oder Passwort stimmen nicht.',
  'auth/invalid-login-credentials': 'E-Mail oder Passwort stimmen nicht.',
  'auth/wrong-password': 'E-Mail oder Passwort stimmen nicht.',
  'auth/user-not-found': 'E-Mail oder Passwort stimmen nicht.',
  'auth/user-disabled': 'Dieses Konto ist gesperrt.',
  'auth/too-many-requests': 'Zu viele Versuche. Warte kurz und versuch es dann noch einmal.',
  'auth/network-request-failed': 'Keine Verbindung. Prüf dein Internet und versuch es noch einmal.',
  'auth/operation-not-allowed': 'Anmelden mit E-Mail ist für diese App gerade nicht freigeschaltet.',
  'permission-denied': 'Dein Profil konnte nicht gespeichert werden (keine Berechtigung).',
};

export const authErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  const message = (error as { message?: string })?.message;
  return message ? `Das hat nicht geklappt: ${message}` : 'Das hat nicht geklappt. Versuch es noch einmal.';
};

/** Nur interne Pfade zulassen, damit ?next= nicht auf fremde Seiten umleitet */
export const safeRedirect = (value: string | null | undefined): string | null =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null;
