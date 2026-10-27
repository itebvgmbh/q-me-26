// Abo, Gründerangebot und Rechnungen. Backend: backend/app/apis/billing und backend/app/apis/invoices (Inhaber),
// backend/app/apis/stripe_webhook (öffentlich).
import { auth } from 'app';
import type { PlanId } from './plans';
import { t } from '@/i18n';

const send = async (path: string, body?: unknown, authenticated = true): Promise<Response> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = await auth.getAuthHeaderValue();
  let res: Response;
  try {
    res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(t('Keine Verbindung zum Server. Bitte prüf dein Internet.'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
  }
  return res;
};

const request = async <T>(path: string, body?: unknown, authenticated = true): Promise<T> =>
  (await (await send(path, body, authenticated)).json()) as T;

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

/** Eine ausgestellte Rechnung (Beträge in Cent) */
export interface Invoice {
  id: string;
  number: string | null;
  date: string;
  periodStart: string | null;
  periodEnd: string | null;
  net: number;
  tax: number;
  total: number;
  currency: string;
  status: 'open' | 'paid' | 'uncollectible' | 'void';
  statusText: string;
  pdf: boolean;
  einvoice: boolean;
  einvoiceMissing: string | null;
}

export const listInvoices = async (shopId: string) =>
  (await request<{ invoices: Invoice[] }>(`/routes/invoices/list?shop_id=${encodeURIComponent(shopId)}`)).invoices;

/** Rechnung herunterladen: PDF (wie von Stripe verschickt) oder E-Rechnung (XRechnung) */
export const downloadInvoice = async (shopId: string, invoice: Invoice, kind: 'pdf' | 'xrechnung') => {
  const res = await send(`/routes/invoices/${kind}?shop_id=${encodeURIComponent(shopId)}&invoice_id=${encodeURIComponent(invoice.id)}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name || `Dranzeit-Rechnung-${invoice.number}.${kind === 'pdf' ? 'pdf' : 'xml'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
