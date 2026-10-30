import { auth } from 'app';
import { t } from '@/i18n';

// Team-Einladung: Link erzeugen (Inhaber), prüfen (öffentlich) und annehmen (angemeldet).
// Alles läuft übers Backend (backend/app/apis/staff_invitation): Der Link hängt am Eintrag im Team,
// gespeichert wird nur ein Hash des Tokens.

export type StaffInviteResult = { link: string; expires: string; email_sent: boolean; email_problem: string };
export type StaffInviteInfo = { status: 'offen' | 'verbunden' | 'abgelaufen'; shopName: string; name: string; email: string };

const call = async <T,>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> => {
  const headers: Record<string, string> = {};
  if (method === 'POST') headers.Authorization = await auth.getAuthHeaderValue();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/routes/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
    // detail ist deutscher Text vom Backend und bleibt so; nur der eigene Ersatztext wird übersetzt
    throw new Error(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
  }
  return (await res.json()) as T;
};

/** Neuer Einladungslink für eine Person im Team; der alte gilt danach nicht mehr. Mit sendEmail auch per E-Mail. */
export const createStaffInvite = (staffId: string, sendEmail = false) =>
  call<StaffInviteResult>('staff-invitation', 'POST', { staff_id: staffId, send_email: sendEmail });

export const getStaffInviteInfo = (token: string) => call<StaffInviteInfo>(`staff-invitation/${encodeURIComponent(token)}`, 'GET');

export const acceptStaffInvite = (token: string) =>
  call<{ shopName: string; staffId: string }>(`staff-invitation/${encodeURIComponent(token)}`, 'POST');
