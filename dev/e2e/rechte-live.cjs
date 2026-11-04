// Rechte an der Schnittstelle von dranzeit.de, ohne Konto und ohne etwas zu ändern (requirements/eigene-datenbank.md,
// Stufe 5: statt der Firestore-Regeln prüft das Backend selbst, wer was darf). Geprüft:
//  - Ohne Anmeldung: geschützte Endpunkte antworten 401, schreibende auch mit erfundenem Cookie.
//  - Öffentliche Endpunkte (Laden, Personen, Leistungen, Bildschirm) antworten 200 und verraten keine Inhaber,
//    Konto-IDs, Kontaktdaten oder Stripe-Kennungen.
//  - Anmelden von einer fremden Seite (Origin) wird abgelehnt (403), falsches Passwort mit Code auth/invalid-credential.
//  - „Wer bin ich“ ohne Sitzung: {"uid": null}, Antwort nicht zwischengespeichert.
// Braucht nichts weiter, auch keinen Entwicklungsserver. QME_LIVE wählt die Adresse, QME_SHOP_ID den Laden
// (Standard: ITEBV-Testbetrieb). Die Firestore-Sperre selbst prüft regeln-live.cjs, solange es das Projekt gibt.
const { SHOP_ID, report, run } = require('./lib.cjs');

const APP = (process.env.QME_LIVE || 'https://dranzeit.de').replace(/\/$/, '');
const ORIGIN = { Origin: APP };

const http = async (method, pfad, { body, headers = {} } = {}) => {
  const res = await fetch(`${APP}${pfad}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* keine JSON-Antwort */
  }
  return { status: res.status, data, text, headers: res.headers };
};

// Felder, die öffentlich nie auftauchen dürfen. E-Mail und Telefon des Ladens sind seine öffentlichen Kontaktangaben
// (Ladenseite); die der Personen nicht.
const GEHEIM = /"(owner|userId|uid|stripeCustomerId|stripeSubscriptionId|inviteToken|inviteTokenHash|ticketKeyHash|customerId|customerPhone|customerEmail)"\s*:\s*"[^"]+"/;
const GEHEIM_PERSON = /"(email|phone|userId|inviteToken|inviteTokenHash)"\s*:\s*"[^"]+"/;

run(async () => {
  const rows = [];

  // --- geschützt ---
  const geschuetzt = [
    ['GET', '/routes/konto/profil'],
    ['GET', '/routes/konto/termine'],
    ['GET', '/routes/team/ich/laeden'],
    ['GET', `/routes/team/laeden/${SHOP_ID}`],
    ['GET', `/routes/team/laeden/${SHOP_ID}/kunden`],
    ['GET', `/routes/team/termine?shopId=${SHOP_ID}&von=2026-11-01T00:00:00Z&bis=2026-11-02T00:00:00Z`],
    ['GET', '/routes/betreiber/uebersicht'],
    ['GET', '/routes/scheduler-status'],
  ];
  for (const [method, pfad] of geschuetzt) {
    const r = await http(method, pfad);
    rows.push({ name: `Ohne Anmeldung: ${pfad.split('?')[0]}`, pass: r.status === 401, detail: `Status ${r.status}` });
  }
  const schreiben = [
    ['/routes/team/laeden', { laden: { name: 'Probe' } }],
    [`/routes/team/laeden/${SHOP_ID}`, { aenderung: { name: 'Probe' } }],
    ['/routes/team/termine', { termin: {} }],
    ['/routes/konto/profil', { aenderung: { displayName: 'Probe' } }],
    ['/routes/betreiber/loeschen', { uids: [], shopIds: [], confirm: '' }],
  ];
  for (const [pfad, body] of schreiben) {
    const r = await http('POST', pfad, { body, headers: { ...ORIGIN, Cookie: 'qme_sitzung=erfunden-1234567890' } });
    rows.push({ name: `Erfundene Sitzung: POST ${pfad}`, pass: r.status === 401, detail: `Status ${r.status}` });
  }

  // --- öffentlich ---
  const oeffentlich = [
    [`/routes/live/laden/${SHOP_ID}`, GEHEIM],
    [`/routes/live/laden/${SHOP_ID}/personen`, GEHEIM_PERSON],
    [`/routes/live/laden/${SHOP_ID}/leistungen`, GEHEIM],
    ['/routes/live/laeden', GEHEIM],
  ];
  for (const [pfad, muster] of oeffentlich) {
    const r = await http('GET', pfad);
    const treffer = r.text.match(muster) || r.text.match(GEHEIM);
    rows.push({ name: `Öffentlich: ${pfad}`, pass: r.status === 200 && !treffer, detail: treffer ? `enthält ${treffer[1]}` : `Status ${r.status}` });
  }

  // --- Anmeldung ---
  const ich = await http('GET', '/routes/anmeldung/ich');
  rows.push({
    name: 'Wer bin ich: niemand, nicht zwischengespeichert',
    pass: ich.status === 200 && ich.data?.uid === null && /no-store/.test(ich.headers.get('cache-control') || ''),
    detail: `${ich.status} ${ich.text.slice(0, 40)}`,
  });
  const fremd = await http('POST', '/routes/anmeldung/anmelden', { body: { email: 'probe@example.com', passwort: 'x' }, headers: { Origin: 'https://boese.example' } });
  rows.push({ name: 'Anmelden von fremder Seite: abgelehnt', pass: fremd.status === 403 && fremd.headers.get('x-anmeldung-fehler') === 'auth/wrong-origin', detail: `Status ${fremd.status}` });
  const falsch = await http('POST', '/routes/anmeldung/anmelden', { body: { email: 'niemand-rechte@example.com', passwort: 'nichtrichtig' }, headers: ORIGIN });
  rows.push({
    name: 'Falsches Passwort: Code, kein Cookie',
    pass: falsch.status === 400 && falsch.headers.get('x-anmeldung-fehler') === 'auth/invalid-credential' && !falsch.headers.get('set-cookie'),
    detail: `Status ${falsch.status}`,
  });

  return report(rows);
});
