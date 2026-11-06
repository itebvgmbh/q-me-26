// Anzeige-Helfer für den Betreiber-Bereich
import { PLANS, type PlanId } from '../../utils/plans';
import type { AdminShop, PlanSource } from '../../utils/betreiber';

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
});

export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '–');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '–');

/** Datum für <input type="date"> in deutscher Zeit */
export const isoDay = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

export const planName = (id: string | null | undefined) => (id && id in PLANS ? PLANS[id as PlanId].name : id || '–');

export const SOURCE_LABEL: Record<PlanSource, string> = {
  abo: 'Abo',
  freischaltung: 'freigeschaltet',
  test: 'Testphase',
  gratis: 'Gratis',
};

export const BILLING_LABEL: Record<string, string> = {
  active: 'aktiv',
  trialing: 'Test bei Stripe',
  past_due: 'Zahlung offen',
  canceled: 'gekündigt',
  unpaid: 'unbezahlt',
  incomplete: 'unvollständig',
  incomplete_expired: 'abgebrochen',
  paused: 'pausiert',
};

export const ROLE_LABEL: Record<string, string> = {
  shopOwner: 'Inhaber',
  employee: 'Team',
  customer: 'Kunde',
  ohne: 'ohne Rolle',
  '': 'ohne Rolle',
};

/** Kurzer Stand des Tarifs für Listen: "Laden · Abo", "Team · Testphase bis 03.11." */
export const planLine = (s: AdminShop) => {
  const base = `${planName(s.effectivePlan)} · ${SOURCE_LABEL[s.source]}`;
  if (s.source === 'test') return `${base} bis ${fmtDate(s.trialEnd)}`;
  if (s.source === 'freischaltung' && s.grant?.until) return `${base} bis ${fmtDate(s.grant.until)}`;
  return base;
};

export const daysUntil = (iso: string, now = Date.now()) => Math.ceil((new Date(iso).getTime() - now) / 86_400_000);

export const stripeLink = (mode: string, customerId: string) =>
  `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}customers/${encodeURIComponent(customerId)}`;
