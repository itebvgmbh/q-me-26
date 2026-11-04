// Wirken die Firestore-Regeln (firestore.rules, Fassung 2026-11-04) in der echten Datenbank? Seit Stufe 2
// (requirements/eigene-datenbank.md) ist für den Browser alles zu. Geprüft wird nach dem Einspielen in der Konsole,
// ohne Anmeldung und nur lesend (dazu ein Schreibversuch in eine Sammlung, die es nicht gibt):
//  - Läden, Personen, Leistungen, Kurzfassungen der Termine, Belegung: lesen abgelehnt (403)
//  - Schreiben abgelehnt
//  - Die App selbst geht weiter: dieselben Daten kommen über das Backend (/routes/live/…)
// Vor dem Einspielen schlagen die Lese-Prüfungen fehl (dann ist Firestore noch offen). Braucht nichts weiter, auch
// keinen Entwicklungsserver; QME_SHOP_ID wählt den Laden (Standard: ITEBV-Testbetrieb), QME_LIVE die Adresse der App.
const { SHOP_ID, report, run } = require('./lib.cjs');

const KEY = 'AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE'; // öffentlicher Web-Schlüssel, steht auch in der App
const DOCS = 'projects/qmedata-7c79e/databases/(default)/documents';
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const APP = (process.env.QME_LIVE || 'https://dranzeit.de').replace(/\/$/, '');

const http = async (method, url, body) => {
  const res = await fetch(url, {
    method,
    headers: { Referer: 'https://dranzeit.de/', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

run(async () => {
  const rows = [];
  const lesen = [
    ['Laden', `${FS}/shops/${SHOP_ID}?key=${KEY}`],
    ['Alle Läden', `${FS}/shops?pageSize=1&key=${KEY}`],
    ['Personen', `${FS}/staff?pageSize=1&key=${KEY}`],
    ['Leistungen', `${FS}/services?pageSize=1&key=${KEY}`],
    ['Kurzfassungen der Termine', `${FS}/public_appointments?pageSize=1&key=${KEY}`],
    ['Belegung', `${FS}/schedules?pageSize=1&key=${KEY}`],
    ['Pausen', `${FS}/breaks?pageSize=1&key=${KEY}`],
  ];
  for (const [name, url] of lesen) {
    const r = await http('GET', url);
    rows.push({ name: `${name} lesen: abgelehnt`, pass: r.status === 403, detail: `Status ${r.status}` });
  }
  const schreiben = await http('PATCH', `${FS}/regeln_probe/live?key=${KEY}`, { fields: { probe: { booleanValue: true } } });
  rows.push({ name: 'Schreiben: abgelehnt', pass: schreiben.status === 403, detail: `Status ${schreiben.status}` });

  // Die App holt dasselbe über das Backend
  const laden = await fetch(`${APP}/routes/live/laden/${SHOP_ID}`);
  rows.push({ name: 'Laden über das Backend', pass: laden.status === 200, detail: `${APP} → Status ${laden.status}` });
  return report(rows);
});
