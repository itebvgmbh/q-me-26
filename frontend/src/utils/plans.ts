// Tarife von Dranzeit. Gleiche Regeln im Backend: backend/app/libs/plans.py – Änderungen immer an beiden Stellen.
// Preise netto in Euro. Grundlage: Preisstrategie (Gratis, Solo 19 €, Laden 39 €, Team 59 €; Jahr = 10 Monate).
import { Timestamp } from 'firebase/firestore';
import { safelyConvertToDate } from './datetime';
import { intlSprache, merke } from '@/i18n';

export type PlanId = 'gratis' | 'solo' | 'laden' | 'team';
export type Feature = 'termine' | 'frueherDran' | 'benachrichtigung' | 'erinnerung' | 'team' | 'bildschirm' | 'auswertung';

export interface PlanInfo {
  id: PlanId;
  /** deutscher Anzeigename; anzeigen mit t(plan.name), vergleichen immer über id */
  name: string;
  /** netto je Monat bei monatlicher Zahlung */
  monthly: number;
  /** netto je Jahr bei jährlicher Zahlung */
  yearly: number;
  maxStaff: number;
  /** null = unbegrenzt */
  maxCustomersPerMonth: number | null;
  features: Feature[];
}

const SOLO_FEATURES: Feature[] = ['termine', 'frueherDran', 'benachrichtigung', 'erinnerung'];
const LADEN_FEATURES: Feature[] = [...SOLO_FEATURES, 'team', 'bildschirm', 'auswertung'];

export const PLANS: Record<PlanId, PlanInfo> = {
  gratis: { id: 'gratis', name: merke('Gratis'), monthly: 0, yearly: 0, maxStaff: 1, maxCustomersPerMonth: 100, features: [] },
  solo: { id: 'solo', name: merke('Solo'), monthly: 19, yearly: 190, maxStaff: 1, maxCustomersPerMonth: null, features: SOLO_FEATURES },
  laden: { id: 'laden', name: merke('Laden'), monthly: 39, yearly: 390, maxStaff: 4, maxCustomersPerMonth: null, features: LADEN_FEATURES },
  team: { id: 'team', name: merke('Team'), monthly: 59, yearly: 590, maxStaff: 10, maxCustomersPerMonth: null, features: LADEN_FEATURES },
};

export const PAID_PLANS: PlanId[] = ['solo', 'laden', 'team'];
export const VAT_RATE = 0.19;
export const TRIAL_DAYS = 30;
/** Gründerangebot: die ersten 100 Läden – 3 Monate gratis, danach Laden für 19 € (Jahr 190 €) */
export const FOUNDER_LIMIT = 100;
export const FOUNDER_TRIAL_DAYS = 90;
export const FOUNDER_LADEN_MONTHLY = 19;
export const FOUNDER_LADEN_YEARLY = 190;
/** Läden von vor der Einführung der Tarife testen ab diesem Tag 30 Tage alles */
export const TARIFF_LAUNCH = new Date('2026-10-20T00:00:00+02:00');

const ACTIVE_BILLING = ['active', 'trialing', 'past_due'];
const PLAN_ORDER: PlanId[] = ['gratis', 'solo', 'laden', 'team'];

export interface ShopBilling {
  plan?: PlanId;
  status?: string;
  interval?: 'monat' | 'jahr';
  currentPeriodEnd?: Timestamp;
  cancelAtPeriodEnd?: boolean;
}

/** Freischaltung durch den Betreiber ohne Stripe (Betreiber-Bereich), gilt bis until */
export interface ShopGrant {
  plan?: PlanId;
  until?: Timestamp;
}

export interface ShopPlanFields {
  plan?: PlanId;
  trialEndsAt?: Timestamp;
  founder?: boolean;
  billing?: ShopBilling;
  grant?: ShopGrant | null;
  /** Vom Betreiber gesperrt (Betreiber-Bereich) */
  suspended?: { at?: Timestamp } | null;
  createdAt?: Timestamp;
}

export interface EffectivePlan {
  plan: PlanInfo;
  source: 'abo' | 'test' | 'freischaltung' | 'gratis';
  trialEndsAt: Date | null;
  /** Tage Test übrig (aufgerundet), 0 außerhalb der Testphase */
  trialDaysLeft: number;
  founder: boolean;
  /** Ende der Freischaltung, nur bei source 'freischaltung' */
  grantUntil?: Date;
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export const trialEnd = (shop: ShopPlanFields): Date => {
  if (shop.trialEndsAt) return safelyConvertToDate(shop.trialEndsAt);
  const created = shop.createdAt ? safelyConvertToDate(shop.createdAt) : TARIFF_LAUNCH;
  const from = created < TARIFF_LAUNCH ? TARIFF_LAUNCH : created;
  return addDays(from, TRIAL_DAYS);
};

/** Freigeschalteter Tarif, solange die Freischaltung läuft */
export const activeGrant = (shop: ShopPlanFields, now: Date = new Date()): { plan: PlanId; until: Date } | null => {
  const grant = shop.grant;
  if (!grant?.plan || !PAID_PLANS.includes(grant.plan) || !grant.until) return null;
  const until = safelyConvertToDate(grant.until);
  return until > now ? { plan: grant.plan, until } : null;
};

export const effectivePlan = (shop: ShopPlanFields | null | undefined, now: Date = new Date()): EffectivePlan => {
  const founder = Boolean(shop?.founder);
  if (!shop) return { plan: PLANS.gratis, source: 'gratis', trialEndsAt: null, trialDaysLeft: 0, founder };
  const billing = shop.billing;
  const grant = activeGrant(shop, now);
  if (billing?.plan && PAID_PLANS.includes(billing.plan) && ACTIVE_BILLING.includes(billing.status || '')) {
    // Eine höhere Freischaltung geht dem Abo vor
    if (grant && PLAN_ORDER.indexOf(grant.plan) > PLAN_ORDER.indexOf(billing.plan)) {
      return { plan: PLANS[grant.plan], source: 'freischaltung', trialEndsAt: null, trialDaysLeft: 0, founder, grantUntil: grant.until };
    }
    return { plan: PLANS[billing.plan], source: 'abo', trialEndsAt: null, trialDaysLeft: 0, founder };
  }
  const end = trialEnd(shop);
  if (end > now) {
    const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
    return { plan: PLANS.team, source: 'test', trialEndsAt: end, trialDaysLeft: days, founder };
  }
  if (grant) {
    return { plan: PLANS[grant.plan], source: 'freischaltung', trialEndsAt: end, trialDaysLeft: 0, founder, grantUntil: grant.until };
  }
  return { plan: PLANS.gratis, source: 'gratis', trialEndsAt: end, trialDaysLeft: 0, founder };
};

/** Vom Betreiber gesperrt: nicht buchbar, nicht auffindbar, keine Benachrichtigungen (wie backend/app/libs/plans.py) */
export const isSuspended = (shop: ShopPlanFields | null | undefined) => Boolean(shop?.suspended);

export const hasFeature = (shop: ShopPlanFields | null | undefined, feature: Feature, now: Date = new Date()) =>
  !isSuspended(shop) && effectivePlan(shop, now).plan.features.includes(feature);

/** Bruttopreis für die Anzeige (Kleinunternehmer können die Mehrwertsteuer nicht abziehen) */
export const gross = (net: number) => Math.round(net * (1 + VAT_RATE) * 100) / 100;

export const euro = (amount: number) =>
  new Intl.NumberFormat(intlSprache(), { style: 'currency', currency: 'EUR', minimumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);

/** Felder für einen neu angelegten Laden: 30 Tage alles testen */
export const newShopPlanFields = (now: Date = new Date()) => ({
  plan: 'gratis' as PlanId,
  trialEndsAt: Timestamp.fromDate(addDays(now, TRIAL_DAYS)),
});
