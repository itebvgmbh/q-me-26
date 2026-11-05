/**
 * Eigenes Konto statt Firebase Auth (Stufe 4, requirements/eigene-datenbank.md; Backend: app/apis/anmeldung).
 *
 * Die Sitzung steckt in einem HttpOnly-Cookie, das der Browser bei jeder Anfrage an dranzeit.de selbst mitschickt.
 * Ein Token im Browser gibt es nicht mehr, getIdToken() liefert deshalb nur "".
 *
 * Damit Seiten und Komponenten kaum anders werden, heißen die Funktionen wie in firebase/auth
 * (signInWithEmailAndPassword, onAuthStateChanged, updatePassword …), und Fehler tragen dieselben Codes (auth/…),
 * die utils/auth-errors.ts übersetzt.
 *
 * Der letzte bekannte Stand liegt in localStorage. So weiß die Seite beim Öffnen sofort, wer angemeldet ist (auch ohne
 * Netz), und prüft es dann beim Backend nach. Meldet ein anderer Tab ab oder an, ziehen die übrigen mit.
 *
 * Endet die Sitzung, während ein Tab offen ist (abgelaufen, Passwort anderswo geändert, Konto gesperrt, Cookie gelöscht),
 * fragt der Tab bei /ich nach, sobald ein Aufruf ans Backend mit 401 abgelehnt wird oder der Tab wieder nach vorn kommt.
 * Sonst zeigte er weiter „angemeldet“, und jede Seite scheiterte mit „Not authenticated“. Dafür ist fetch unten
 * umwickelt; es ändert an keiner Anfrage etwas, es schaut nur auf die Antwort.
 */

export interface User {
  readonly uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  readonly providerData: { providerId: string }[];
  getIdToken(forceRefresh?: boolean): Promise<string>;
  reload(): Promise<void>;
  delete(): Promise<void>;
}

type Daten = { uid: string; email: string | null; emailVerified: boolean; displayName?: string | null };
// GET /routes/anmeldung/ich ohne Sitzung: {"uid": null}
type Ich = Daten | { uid: null };
const angemeldet = (d: Ich): d is Daten => typeof d.uid === 'string' && d.uid !== '';
type Fehler = Error & { code?: string; status?: number };

const SPEICHER = 'dranzeit.konto';
const PFAD = '/routes/anmeldung';

const fehler = (code: string, text?: string, status?: number): Fehler =>
  Object.assign(new Error(text || code), { code, status });

const sprache = (): string => {
  try {
    return document.documentElement.lang || navigator.language || 'de';
  } catch {
    return 'de';
  }
};

const fehlerAus = async (res: Response): Promise<Fehler> => {
  let detail = '';
  try {
    detail = (await res.json())?.detail;
  } catch {
    /* keine JSON-Antwort */
  }
  const code = res.headers.get('X-Anmeldung-Fehler') || (res.status >= 502 ? 'auth/network-request-failed' : 'auth/internal-error');
  return fehler(code, typeof detail === 'string' ? detail : undefined, res.status);
};

const anfrage = async <T,>(pfad: string, init: RequestInit = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(pfad, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': sprache(), ...(init.headers || {}) },
    });
  } catch {
    throw fehler('auth/network-request-failed');
  }
  if (!res.ok) throw await fehlerAus(res);
  return (await res.json()) as T;
};

const senden = <T,>(pfad: string, body: unknown = {}) => anfrage<T>(`${PFAD}/${pfad}`, { method: 'POST', body: JSON.stringify(body) });

class Konto implements User {
  readonly uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  readonly providerData = [{ providerId: 'password' }];

  constructor(d: Daten) {
    this.uid = d.uid;
    this.email = d.email ?? null;
    this.emailVerified = Boolean(d.emailVerified);
    this.displayName = d.displayName ?? null;
  }

  async getIdToken(): Promise<string> {
    return '';
  }

  async reload(): Promise<void> {
    const d = await anfrage<Ich>(`${PFAD}/ich`).catch((e: Fehler) => {
      if (e.status === 401) setzen(null);
      throw e;
    });
    if (!angemeldet(d)) {
      setzen(null);
      throw fehler('auth/user-token-expired');
    }
    this.email = d.email ?? null;
    this.emailVerified = Boolean(d.emailVerified);
    this.displayName = d.displayName ?? null;
    merken(this);
  }

  async delete(): Promise<void> {
    await anfrage('/routes/datenschutz/konto', { method: 'DELETE' });
    setzen(null);
  }

  toJSON(): Daten {
    return { uid: this.uid, email: this.email, emailVerified: this.emailVerified, displayName: this.displayName };
  }
}

// --- Zustand ---------------------------------------------------------------------------------------------------------

type Zuhoerer = (user: User | null) => void;
const zuhoerer = new Set<Zuhoerer>();

const gemerkt = (): Konto | null => {
  try {
    const roh = localStorage.getItem(SPEICHER);
    const d = roh ? (JSON.parse(roh) as Daten) : null;
    return d?.uid ? new Konto(d) : null;
  } catch {
    return null;
  }
};

const merken = (user: Konto | null) => {
  try {
    if (user) localStorage.setItem(SPEICHER, JSON.stringify(user.toJSON()));
    else localStorage.removeItem(SPEICHER);
  } catch {
    /* privates Fenster o. Ä.: dann eben ohne */
  }
};

let aktuell: Konto | null = gemerkt();
let bereit = aktuell !== null;

const melden = () => zuhoerer.forEach((z) => z(aktuell));

function setzen(d: Daten | null) {
  const vorher = aktuell?.uid ?? null;
  if (d && aktuell && aktuell.uid === d.uid) {
    aktuell.email = d.email ?? null;
    aktuell.emailVerified = Boolean(d.emailVerified);
    aktuell.displayName = d.displayName ?? null;
  } else {
    aktuell = d ? new Konto(d) : null;
  }
  merken(aktuell);
  const warBereit = bereit;
  bereit = true;
  if (!warBereit || vorher !== (aktuell?.uid ?? null)) melden();
}

const pruefen: Promise<void> = (async () => {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch(`${PFAD}/ich`, { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      const d = (await res.json()) as Ich;
      setzen(angemeldet(d) ? d : null);
    } else if (res.status === 401) setzen(null);
    else if (!bereit) setzen(null);
  } catch {
    // Kein Netz: den gemerkten Stand behalten (Anfragen ans Backend scheitern dann ohnehin)
    if (!bereit) setzen(null);
  }
})();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SPEICHER) return;
    const neu = gemerkt();
    if ((neu?.uid ?? null) !== (aktuell?.uid ?? null)) {
      aktuell = neu;
      melden();
    }
  });
}

// --- Sitzung nachprüfen, solange der Tab offen ist -------------------------------------------------------------------

const ABSTAND_MS = 5_000;
let zuletztGeprueft = 0;
let geplant = false;

/** Fragt bei /ich nach, ob die Sitzung noch gilt: höchstens alle 5 s, mehrere Anlässe kurz hintereinander zählen einmal. */
const nachpruefen = (netz: typeof fetch) => {
  if (geplant || !aktuell) return;
  geplant = true;
  setTimeout(async () => {
    geplant = false;
    zuletztGeprueft = Date.now();
    try {
      const res = await netz(`${PFAD}/ich`, { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) setzen(null);
      else if (res.ok) {
        const d = (await res.json()) as Ich;
        setzen(angemeldet(d) ? d : null);
      }
    } catch {
      // Kein Netz: den Stand behalten
    }
  }, Math.max(0, zuletztGeprueft + ABSTAND_MS - Date.now()));
};

/** Ein Aufruf an das eigene Backend, aber nicht an die Anmeldung selbst (deren 401 heißt „falsches Passwort“) */
const backendAufruf = (eingabe: RequestInfo | URL): boolean => {
  try {
    const roh = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
    const url = new URL(roh, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith('/routes/') && !url.pathname.startsWith(`${PFAD}/`);
  } catch {
    return false;
  }
};

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const netz = window.fetch.bind(window);
  window.fetch = async (eingabe: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await netz(eingabe, init);
    if (res.status === 401 && aktuell && backendAufruf(eingabe)) nachpruefen(netz);
    return res;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') nachpruefen(netz);
  });
}

/** Statt firebaseAuth: currentUser, onAuthStateChanged, authStateReady, signOut */
export const anmeldung = {
  get currentUser(): User | null {
    return aktuell;
  },
  onAuthStateChanged(z: Zuhoerer): () => void {
    zuhoerer.add(z);
    if (bereit) queueMicrotask(() => zuhoerer.has(z) && z(aktuell));
    return () => {
      zuhoerer.delete(z);
    };
  },
  authStateReady(): Promise<void> {
    return bereit ? Promise.resolve() : pruefen;
  },
  signOut(): Promise<void> {
    return signOut();
  },
};

export type Anmeldung = typeof anmeldung;

// --- Wie firebase/auth -----------------------------------------------------------------------------------------------

export const signInWithEmailAndPassword = async (_a: Anmeldung, email: string, password: string): Promise<{ user: User }> => {
  setzen(await senden<Daten>('anmelden', { email, passwort: password }));
  return { user: aktuell as User };
};

export const createUserWithEmailAndPassword = async (_a: Anmeldung, email: string, password: string): Promise<{ user: User }> => {
  setzen(await senden<Daten>('registrieren', { email, passwort: password }));
  return { user: aktuell as User };
};

export const signOut = async (_a?: Anmeldung): Promise<void> => {
  await senden('abmelden').catch(() => undefined);
  setzen(null);
};

/** Passwort-Mail (backend/app/apis/password_reset, über Resend) */
export const sendPasswordResetEmail = async (_a: Anmeldung, email: string): Promise<void> => {
  await anfrage('/routes/password-reset', { method: 'POST', body: JSON.stringify({ email }) });
};

export const verifyPasswordResetCode = async (_a: Anmeldung, code: string): Promise<string> =>
  (await anfrage<{ email: string }>(`${PFAD}/passwort-neu?code=${encodeURIComponent(code)}`)).email;

export const confirmPasswordReset = async (_a: Anmeldung, code: string, password: string): Promise<void> => {
  await senden('passwort-neu', { code, passwort: password });
  setzen(null); // alle Sitzungen sind beendet
};

/** Link aus der Bestätigungs-Mail einlösen */
export const applyActionCode = async (_a: Anmeldung, code: string): Promise<void> => {
  const d = await senden<{ email: string; emailVerified: boolean }>('email-bestaetigen', { code });
  if (aktuell && aktuell.email?.toLowerCase() === d.email.toLowerCase()) {
    aktuell.emailVerified = true;
    merken(aktuell);
  }
};

export const EmailAuthProvider = {
  credential: (email: string, password: string) => ({ email, password }),
};

/** Bisheriges Passwort bestätigen; danach geht updatePassword (5 Minuten lang) */
export const reauthenticateWithCredential = async (_u: User, cred: { email: string; password: string }): Promise<void> => {
  await senden('passwort-pruefen', { passwort: cred.password });
};

export const updatePassword = async (_u: User, password: string): Promise<void> => {
  await senden('passwort-aendern', { passwort: password });
};
