// Löschen auf Wunsch: Kunden aus der Kundenliste des Ladens, eigenes Kunden-Konto.
// Backend: backend/app/apis/datenschutz, Fristen und Regeln: backend/app/libs/privacy.py
import { auth } from 'app';
import { t } from '@/i18n';

const remove = async <T>(path: string): Promise<T> => {
  const headers = { Authorization: await auth.getAuthHeaderValue() };
  let res: Response;
  try {
    res = await fetch(path, { method: 'DELETE', headers });
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
  return (await res.json()) as T;
};

type Result = { anonymized: number; cancelled: number };

/** Kunden-Eintrag löschen: frühere Termine ohne Namen, kommende abgesagt (bei verbundenem Konto bleiben sie beim Konto) */
export const deleteCustomer = (customerId: string) => remove<Result>(`/routes/datenschutz/kunde/${encodeURIComponent(customerId)}`);

/** Eigenes Kunden-Konto löschen. Danach abmelden, die Anmeldung gilt nicht mehr. */
export const deleteOwnAccount = () => remove<Result & { customerEntries: number }>('/routes/datenschutz/konto');
