import { auth } from 'app';

// „Früher dran“ für einen eigenen, kommenden Termin ein- oder ausschalten (Meine Termine).
// Prüfen und Speichern macht das Backend (backend/app/apis/frueher_dran): nur der eigene Termin,
// nur gebucht und noch nicht angefangen, Einschalten nur im passenden Tarif. Danach sucht es gleich einen Platz.

/** Ab so vielen Minuten vor Beginn kann noch ein Platz angeboten werden (check_slots: OFFER_LEAD_MINUTES) */
export const FRUEHER_DRAN_VORLAUF_MINUTEN = 15;

export const setFrueherDran = async (appointmentId: string, an: boolean): Promise<boolean> => {
  let res: Response;
  try {
    res = await fetch(`/routes/frueher-dran/${encodeURIComponent(appointmentId)}`, {
      method: 'POST',
      headers: { Authorization: await auth.getAuthHeaderValue(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ an }),
    });
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
  return ((await res.json()) as { checkEarlierOptions: boolean }).checkEarlierOptions;
};
