// Abo und Gründerangebot. Backend: backend/app/apis/billing (Inhaber), backend/app/apis/stripe_webhook (öffentlich).
import { auth } from 'app';
import type { PlanId } from './plans';

const request = async <T>(path: string, body?: unknown, authenticated = true): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = await auth.getAuthHeaderValue();
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

export type Interval = 'monat' | 'jahr';

/** Weiter zu Stripe: Abo abschließen (oder ins Kundenportal, wenn schon eins läuft) */
export const startCheckout = async (shopId: string, plan: PlanId, interval: Interval) => {
  const { url } = await request<{ url: string }>('/routes/billing/checkout', { shop_id: shopId, plan, interval });
  window.location.assign(url);
};

export const openPortal = async (shopId: string) => {
  const { url } = await request<{ url: string }>('/routes/billing/portal', { shop_id: shopId });
  window.location.assign(url);
};

export const claimFounder = (shopId: string) =>
  request<{ founder: boolean; left: number }>('/routes/billing/claim-founder', { shop_id: shopId });

export const getFoundersLeft = async (): Promise<number | null> => {
  try {
    return (await request<{ left: number }>('/routes/billing-public/founders-left', undefined, false)).left;
  } catch {
    return null;
  }
};
