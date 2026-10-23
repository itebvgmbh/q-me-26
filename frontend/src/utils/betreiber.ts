// Betreiber-Bereich (/betreiber): alle Läden und Konten, Eingriffe, Protokoll.
// Backend: backend/app/apis/betreiber (nur für Betreiber, QME_ADMIN_EMAILS auf dem Server)
import { useEffect, useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, firebaseAuth, useCurrentUser } from 'app';
import type { PlanId } from './plans';

export const send = async <T>(path: string, body?: unknown): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: await auth.getAuthHeaderValue() };
  let res: Response;
  try {
    res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

const BASE = '/routes/betreiber';
const shopPath = (id: string, action: string) => `${BASE}/laden/${encodeURIComponent(id)}/${action}`;
const accountPath = (uid: string, action: string) => `${BASE}/konto/${encodeURIComponent(uid)}/${action}`;

/** echt | test (aus Testskripten, @example.com) | intern (ITEBV GmbH, Betreiber) */
export type Kind = 'echt' | 'test' | 'intern';
export type PlanSource = 'abo' | 'freischaltung' | 'test' | 'gratis';

export interface AdminShop {
  id: string;
  nr: string;
  name: string;
  owner: string;
  ownerLabel: string;
  email: string;
  city: string;
  phone: string;
  created: string | null;
  founder: boolean;
  /** Status des Stripe-Abos (active, trialing, past_due, canceled …), leer ohne Abo */
  billing: string;
  plan: string;
  interval: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  customerId: string;
  subscriptionId: string;
  effectivePlan: PlanId;
  source: PlanSource;
  trialEnd: string;
  grant: { plan: PlanId; until: string | null; active: boolean } | null;
  suspended: string | null;
  onboarding: string[];
  services: number;
  staff: number;
  staffAccounts: string[];
  customers: number;
  appointments: number;
  upcoming: number;
  thisMonth: number;
  last30: number;
  lastAppointment: string | null;
  markers: string[];
  kind: Kind;
}

export interface AdminAccount {
  uid: string;
  nr: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean | null;
  disabled: boolean;
  blockedByAdmin: boolean;
  created: string | null;
  lastSignIn: string | null;
  providers: string[];
  auth: boolean;
  profile: boolean;
  shops: string[];
  staff: { shopId: string; role: string; active: boolean }[];
  customers: string[];
  appointments: number;
  upcoming: number;
  markers: string[];
  kind: Kind;
}

export interface Stats {
  shops: number;
  shopsTest: number;
  newShops7: number;
  newShops30: number;
  byPlan: Record<PlanId, number>;
  inTrial: number;
  paying: number;
  granted: number;
  mrr: number;
  pastDue: number;
  cancelling: number;
  trialEndingSoon: number;
  suspended: number;
  founders: { taken: number; limit: number };
  accounts: number;
  accountsTest: number;
  accountsByRole: Record<string, number>;
  accountsUnverified: number;
  appointments30: number;
}

export interface SystemStatus {
  stripe: '' | 'test' | 'live';
  stripeWebhook: boolean;
  stripePortal: boolean;
  resend: boolean;
  mailFrom: string;
  publicUrl: string;
  scheduler: { running: boolean; lastRun: string | null; intervalSeconds: number };
  admins: number;
}

export interface Overview {
  now: string;
  stats: Stats;
  shops: AdminShop[];
  accounts: AdminAccount[];
  orphans: { staff: number; customers: number; appointmentsInMissingShops: number };
  system: SystemStatus;
}

export interface LogEntry {
  at: string;
  by: string;
  action: string;
  target: { shopId?: string; uid?: string; name?: string; email?: string; shopIds?: string[]; uids?: string[] };
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export interface ShopDetail {
  id: string;
  shop: Record<string, unknown> & { name?: string; street?: string; postalCode?: string; city?: string; website?: string };
  effectivePlan: PlanId;
  trialEnd: string;
  staff: { id: string; name: string; email: string; role: string; userId: string; active: boolean }[];
  owner: { uid: string; email: string; emailVerified: boolean; disabled: boolean; lastSignIn: string | null } | null;
  /** Rufnummer des Telefon-Assistenten (höchstens eine) */
  telefon: string[];
  protokoll: LogEntry[];
}

export interface DeletionProbe {
  shops: { id: string; name: string; related: Record<string, number> }[];
  users: {
    uid: string;
    email: string;
    auth: boolean;
    profile: boolean;
    appointments: number;
    upcoming: number;
    push: number;
    offers: number;
    queue: number;
    customers: number;
    staff: number;
  }[];
  foundersFreed: number;
  problems: string[];
  confirmWord: string;
}

export const loadOverview = () => send<Overview>(`${BASE}/uebersicht`);
export const loadShop = (id: string) => send<ShopDetail>(`${BASE}/laden/${encodeURIComponent(id)}`);
export const loadLog = (limit = 300) => send<{ entries: LogEntry[] }>(`${BASE}/protokoll?limit=${limit}`);

export const setTrial = (id: string, until: string, reason = '') => send(shopPath(id, 'testphase'), { until, reason });
export const setFounder = (id: string, founder: boolean, reason = '') => send<{ count: number }>(shopPath(id, 'gruender'), { founder, reason });
export const grantPlan = (id: string, plan: PlanId, until: string, reason: string) => send(shopPath(id, 'freischaltung'), { plan, until, reason });
export const endGrant = (id: string, reason = '') => send(shopPath(id, 'freischaltung-beenden'), { reason });
export const syncStripe = (id: string) => send<{ changed: boolean; message?: string }>(shopPath(id, 'stripe-abgleich'), {});
export const unlinkStripe = (id: string, reason: string) => send(shopPath(id, 'stripe-loesen'), { reason });
export const suspendShop = (id: string, reason: string) =>
  send<{ changed: boolean; accounts?: number; skipped?: string[] }>(shopPath(id, 'sperren'), { reason });
export const unsuspendShop = (id: string, reason = '') => send<{ changed: boolean; accounts?: number; kept?: number }>(shopPath(id, 'entsperren'), { reason });
/** Rufnummer des Telefon-Assistenten zuordnen; leer = Zuordnung aufheben */
export const setPhoneLine = (id: string, nummer: string, reason = '') => send<{ telefon: string[] }>(shopPath(id, 'telefon'), { nummer, reason });

export const blockAccount = (uid: string, reason: string) => send(accountPath(uid, 'sperren'), { reason });
export const unblockAccount = (uid: string, reason = '') => send(accountPath(uid, 'entsperren'), { reason });
export const changeEmail = (uid: string, email: string, reason = '') => send<{ email: string; changed: boolean }>(accountPath(uid, 'email'), { email, reason });
export const markVerified = (uid: string, verified: boolean) => send(accountPath(uid, 'email-bestaetigt'), { verified });
export const sendVerification = (uid: string) => send<{ status: string }>(accountPath(uid, 'bestaetigungs-mail'), {});

/** Passwort-Mail wie bei "Passwort vergessen": über Resend vom Backend, ohne Resend von Firebase */
export const sendPasswordMail = async (uid: string) => {
  const { email, status } = await send<{ email: string; status: 'verschickt' | 'nicht_eingerichtet' }>(accountPath(uid, 'passwort-mail'), {});
  if (status !== 'verschickt') await sendPasswordResetEmail(firebaseAuth, email);
  return email;
};

export const probeDeletion = (shopIds: string[], uids: string[]) => send<DeletionProbe>(`${BASE}/loeschen/probe`, { shopIds, uids });
export const runDeletion = (shopIds: string[], uids: string[], confirm: string) =>
  send<{ result: Record<string, number>; left: string[]; backup: string }>(`${BASE}/loeschen`, { shopIds, uids, confirm });

let cached: { uid: string; admin: boolean } | null = null;

/** Ist das angemeldete Konto Betreiber? Für den Menüpunkt; einmal je Anmeldung gefragt. */
export const useIsBetreiber = (): boolean => {
  const { user } = useCurrentUser();
  const [admin, setAdmin] = useState(() => Boolean(user && cached?.uid === user.uid && cached.admin));
  useEffect(() => {
    if (!user) {
      setAdmin(false);
      return;
    }
    if (cached?.uid === user.uid) {
      setAdmin(cached.admin);
      return;
    }
    let alive = true;
    send<{ admin: boolean }>(`${BASE}/ich`)
      .then(({ admin: value }) => {
        cached = { uid: user.uid, admin: value };
        if (alive) setAdmin(value);
      })
      .catch(() => alive && setAdmin(false));
    return () => {
      alive = false;
    };
  }, [user]);
  return admin;
};
