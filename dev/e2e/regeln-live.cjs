// Wirken die Firestore-Regeln (firestore.rules) in der echten Datenbank? Prüft nach dem Einspielen in der Konsole,
// nur am Testladen aus fixtures.py und ohne Browser:
//  - Der Inhaber ändert seinen Laden, aber keine Tarif-Felder (trialEndsAt, grant, billing, suspended, founder, plan)
//  - Löschen geht nur mit Vermerk in deleted_shops (geprüft wird nur, dass es ohne nicht geht)
//  - Ohne Anmeldung: Läden lesen ja, Gründer-Zähler (meta) und Push-Adressen nein
// Vor dem Einspielen schlagen die Tarif-Prüfungen fehl (dann ist die Lücke noch offen); was dabei doch geschrieben
// wurde, nimmt das Skript sofort wieder weg.
// Braucht: Testdaten (python dev/fixtures.py anlegen), keinen Entwicklungsserver.
const { fixture, report, run } = require('./lib.cjs');

const KEY = 'AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE'; // öffentlicher Web-Schlüssel, steht auch in der App
const DOCS = 'projects/qmedata-7c79e/databases/(default)/documents';
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';

const http = async (method, url, body, token) => {
  const headers = { Referer: 'https://dranzeit.de/', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

/** Felder am Laden setzen (value = REST-Wert) oder mit value null entfernen */
const patchShop = (shopId, field, value, token) =>
  http('PATCH', `${FS}/shops/${shopId}?updateMask.fieldPaths=${field}`, { fields: value === null ? {} : { [field]: value } }, token);

const inDays = (days) => ({ timestampValue: new Date(Date.now() + days * 86400000).toISOString() });

run(async () => {
  const fx = fixture();
  const rows = [];
  const login = await http('POST', `${AUTH}:signInWithPassword?key=${KEY}`, { email: fx.email, password: fx.pw, returnSecureToken: true });
  if (login.status !== 200) throw new Error(`Anmeldung des Testkontos: ${login.status}`);
  const token = login.data.idToken;
  const shop = await http('GET', `${FS}/shops/${fx.shopId}`, null, token);
  if (shop.status !== 200) throw new Error(`Testladen ${fx.shopId}: ${shop.status}`);
  const before = shop.data.fields || {};

  const name = await patchShop(fx.shopId, 'name', before.name, token);
  rows.push({ name: 'Inhaber ändert den Namen', pass: name.status === 200, detail: `Status ${name.status}` });

  for (const [field, value] of [
    ['trialEndsAt', inDays(365)],
    ['grant', { mapValue: { fields: { plan: { stringValue: 'team' }, until: inDays(365) } } }],
    ['billing', { mapValue: { fields: { plan: { stringValue: 'team' }, status: { stringValue: 'active' } } } }],
    ['suspended', { mapValue: { fields: { at: inDays(0) } } }],
    ['founder', { booleanValue: true }],
    ['plan', { stringValue: 'team' }],
  ]) {
    const r = await patchShop(fx.shopId, field, value, token);
    if (r.status === 200) {
      // Regeln noch nicht eingespielt: alten Stand sofort wiederherstellen
      await patchShop(fx.shopId, field, before[field] ?? null, token);
    }
    rows.push({ name: `Inhaber setzt ${field}: abgelehnt`, pass: r.status === 403, detail: `Status ${r.status}${r.status === 200 ? ' – geschrieben und zurückgenommen' : ''}` });
  }

  // Löschen an einem eigenen Probe-Laden (der Testladen bliebe sonst weg, solange die Regeln fehlen)
  const now = inDays(0);
  const probe = await http('POST', `${FS}/shops`, { fields: { name: { stringValue: 'Regelprobe (wird gleich gelöscht)' }, owner: { stringValue: fx.uid }, createdAt: now, updatedAt: now } }, token);
  rows.push({ name: 'Inhaber legt einen Laden an', pass: probe.status === 200, detail: `Status ${probe.status}` });
  if (probe.status === 200) {
    const probeId = probe.data.name.split('/').pop();
    const del = await http('DELETE', `${FS}/shops/${probeId}`, null, token);
    rows.push({ name: 'Löschen ohne Vermerk: abgelehnt', pass: del.status === 403, detail: `Status ${del.status}` });
    const commit = await http('POST', `${FS}:commit`, { writes: [
      { update: { name: `${DOCS}/deleted_shops/${probeId}`, fields: { owner: { stringValue: fx.uid }, deletedAt: inDays(0) } } },
      { delete: `${DOCS}/shops/${probeId}` },
    ] }, token);
    if (del.status === 403) rows.push({ name: 'Löschen mit Vermerk: erlaubt', pass: commit.status === 200, detail: `Status ${commit.status}` });
  }

  const shops = await http('POST', `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: 'shops' }], limit: 1 } });
  rows.push({ name: 'Ohne Anmeldung: Läden lesen', pass: shops.status === 200, detail: `Status ${shops.status}` });
  for (const path of ['meta/gruender', 'push_subscriptions/regeln-live']) {
    const r = await http('GET', `${FS}/${path}`);
    rows.push({ name: `Ohne Anmeldung: ${path.split('/')[0]} gesperrt`, pass: r.status === 403, detail: `Status ${r.status}` });
  }

  // Fassung vom 23.10.2026: Profile, Kundenliste, Team, Termine. Nur Statuscodes – gefragt wird nach IDs, die es nicht
  // gibt, oder im Testladen; was vor dem Einspielen doch geschrieben wird, nimmt das Skript sofort zurück.
  const NONE = 'regelprobe-gibt-es-nicht';
  const status = (r) => `Status ${r.status}`;
  const byShop = (collectionId, shopId) => ({
    structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: 'shopId' }, op: 'EQUAL', value: { stringValue: shopId } } } },
  });

  const anonProfile = await http('GET', `${FS}/users/${NONE}`);
  rows.push({ name: 'Ohne Anmeldung: Profile gesperrt', pass: anonProfile.status === 403, detail: status(anonProfile) });
  const otherProfile = await http('GET', `${FS}/users/${NONE}`, null, token);
  rows.push({ name: 'Fremdes Profil: gesperrt', pass: otherProfile.status === 403, detail: status(otherProfile) });
  const ownProfile = await http('GET', `${FS}/users/${fx.uid}`, null, token);
  rows.push({ name: 'Eigenes Profil: lesbar', pass: ownProfile.status === 200, detail: status(ownProfile) });

  const anonCustomers = await http('POST', `${FS}:runQuery`, byShop('customers', NONE));
  rows.push({ name: 'Ohne Anmeldung: Kundenliste gesperrt', pass: anonCustomers.status === 403, detail: status(anonCustomers) });
  const ownCustomers = await http('POST', `${FS}:runQuery`, byShop('customers', fx.shopId), token);
  rows.push({ name: 'Inhaber: eigene Kundenliste lesbar', pass: ownCustomers.status === 200, detail: status(ownCustomers) });

  // Ohne Anmeldung ein Konto mit einer Person im Testladen verbinden (ins Team schreiben)
  const person = await http('GET', `${FS}/staff/${fx.staffId}`, null, token);
  const join = await http('PATCH', `${FS}/staff/${fx.staffId}?updateMask.fieldPaths=userId`, { fields: { userId: { stringValue: NONE } } });
  if (join.status === 200) {
    await http('PATCH', `${FS}/staff/${fx.staffId}?updateMask.fieldPaths=userId`, { fields: person.data?.fields?.userId ? { userId: person.data.fields.userId } : {} }, token);
  }
  rows.push({ name: 'Ohne Anmeldung: nicht ins Team', pass: join.status === 403, detail: `${status(join)}${join.status === 200 ? ' – geschrieben und zurückgenommen' : ''}` });

  // Ohne Anmeldung einen Termin auf ein fremdes Konto anlegen
  const start = new Date(Date.now() + 40 * 86400000);
  const foreign = await http('POST', `${FS}/appointments`, { fields: {
    shopId: { stringValue: fx.shopId }, staffId: { stringValue: fx.staffId }, customerId: { stringValue: NONE },
    customerName: { stringValue: 'Regelprobe' }, status: { stringValue: 'scheduled' }, type: { stringValue: 'queue' },
    startTime: { timestampValue: start.toISOString() }, endTime: { timestampValue: new Date(start.getTime() + 1800000).toISOString() },
  } });
  if (foreign.status === 200) await http('DELETE', `${FS}/appointments/${foreign.data.name.split('/').pop()}`, null, token);
  rows.push({ name: 'Ohne Anmeldung: Termin für fremdes Konto', pass: foreign.status === 403, detail: `${status(foreign)}${foreign.status === 200 ? ' – angelegt und gelöscht' : ''}` });
  return report(rows);
});
