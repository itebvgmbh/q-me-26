// Termin-API (/api/v1) einmal ganz gegen das echte Backend: Wegwerf-Laden, Schlüssel wie der Inhaber unter
// „Schnittstelle (API)“, dann Laden, Personen, Leistungen, Kunden (ohne Doppel), freie Zeiten, Termin online und am
// Tresen, Platz weg (409), Verschieben, Absagen, Webhook mit ping und Zustellungen, zum Schluss Schlüssel widerrufen.
// Der Schlüssel und das Webhook-Geheimnis werden nie ausgegeben. Kunden haben @example.com-Adressen (keine Mails).
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://dranzeit.de). API-Adresse: QME_API.
// Seiten: backend/app/schnittstelle, backend/app/apis/api_zugang, backend/app/libs/webhooks.py.
const { launch, newPage, tempShop, removeTempShop, report, run } = require('./lib.cjs');

const API = (process.env.QME_API || 'https://dranzeit.de/api/v1').replace(/\/$/, '');
const WEBHOOK_ZIEL = process.env.QME_WEBHOOK_ZIEL || 'https://dranzeit.de/webhook-probe'; // antwortet nicht mit 2xx: zeigt Versuch + Status

run(async () => {
  const browser = await launch();
  const rows = [];
  const pruefe = (name, pass, detail = '') => rows.push({ name, pass: Boolean(pass), detail: String(detail ?? '') });
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const laden = await tempShop(page, 'API-Test');
  let schluessel = '';
  let schluesselId = '';
  try {
    const angelegt = await page.evaluate(async (shopId) => {
      const { schluesselAnlegen } = await import('/src/utils/api-schluessel.ts');
      return schluesselAnlegen(shopId, 'Livetest');
    }, laden.shopId);
    schluessel = angelegt.schluessel;
    schluesselId = angelegt.eintrag.id;
    pruefe('Schlüssel angelegt (einmal angezeigt)', /^dz_[0-9a-f]{16}_/.test(schluessel), angelegt.eintrag.anfang);

    const api = async (methode, pfad, body, key = schluessel) => {
      const res = await fetch(`${API}${pfad}`, {
        method: methode,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      return { status: res.status, json };
    };

    // Zugang
    pruefe('Ohne Schlüssel: 401', (await api('GET', '/laden', null, '')).status === 401);
    pruefe('Falscher Schlüssel: 401', (await api('GET', '/laden', null, `dz_0000000000000000_${'x'.repeat(40)}`)).status === 401);
    const l = await api('GET', '/laden');
    pruefe('GET /laden', l.status === 200 && l.json.name === 'API-Test', `${l.status} ${l.json?.name}`);

    // Personen, Leistungen
    const personen = await api('GET', '/personen');
    pruefe('GET /personen: Robin', personen.status === 200 && personen.json.some((p) => p.id === laden.staffId && p.name === 'Robin'));
    const leistungen = await api('GET', '/leistungen');
    pruefe('GET /leistungen: Schnitt', leistungen.status === 200 && leistungen.json.some((x) => x.id === laden.serviceId));
    const neu = await api('POST', '/leistungen', { name: 'Bart', dauer_minuten: 15, preis: 12, person_ids: [laden.staffId] });
    pruefe('POST /leistungen: 201', neu.status === 201 && neu.json.dauer_minuten === 15, `${neu.status}`);
    pruefe('GET /leistungen/{id}', (await api('GET', `/leistungen/${neu.json?.id}`)).status === 200);
    pruefe('Ungültige Leistung: 422 ungueltig', (await api('POST', '/leistungen', { name: '', dauer_minuten: 1 })).json?.fehler?.code === 'ungueltig');

    // Kunden ohne Doppel
    const mail = `api-kunde-${Date.now()}@example.com`;
    const k1 = await api('POST', '/kunden', { name: 'Kim Probe', email: mail });
    const k2 = await api('POST', '/kunden', { name: 'Kim Probe', email: mail.toUpperCase() });
    pruefe('POST /kunden: 201 neu, 200 vorhanden', k1.status === 201 && k2.status === 200 && k1.json.id === k2.json.id, `${k1.status}/${k2.status}`);
    const gesucht = await api('GET', `/kunden?email=${encodeURIComponent(mail)}`);
    pruefe('GET /kunden?email=', gesucht.status === 200 && gesucht.json.length === 1);

    // Webhook vor den Terminen anlegen
    const wh = await api('POST', '/webhooks', { url: WEBHOOK_ZIEL });
    pruefe('POST /webhooks: 201 mit Geheimnis', wh.status === 201 && /^whsec_/.test(wh.json?.geheimnis || ''), `${wh.status}`);
    const ping = await api('POST', `/webhooks/${wh.json?.id}/test`);
    pruefe('ping an die Gegenstelle geht raus', ping.status === 200 && typeof ping.json?.status === 'number', `Gegenstelle ${ping.json?.status} ${ping.json?.fehler || ''}`);
    pruefe('Webhook nur https', (await api('POST', '/webhooks', { url: 'http://example.com/x' })).status >= 400);

    // Freie Zeiten (Montag, wie im Testladen)
    const ab = `${laden.monday}T08:00:00+01:00`;
    const frei = await api('GET', `/freie-zeiten?leistung_id=${laden.serviceId}&ab=${encodeURIComponent(ab)}&anzahl=10`);
    pruefe('GET /freie-zeiten', frei.status === 200 && frei.json.length >= 3, `${frei.json?.length} Zeiten, erste ${frei.json?.[0]?.start}`);
    const [z1, z2] = frei.json || [];

    // Termin online, Platz weg, Tresen außerhalb der Öffnungszeit
    const t1 = await api('POST', '/termine', { leistung_id: laden.serviceId, start: z1.start, kunde_id: k1.json.id, frueher_dran: true });
    pruefe('POST /termine online: 201', t1.status === 201 && t1.json.status === 'geplant' && t1.json.quelle === 'api', `${t1.status} ${t1.json?.start}`);
    pruefe('Früher dran ohne Konto: nicht erreichbar', t1.json?.frueher_dran === true && t1.json?.frueher_dran_erreichbar === false);
    const weg = await api('POST', '/termine', { leistung_id: laden.serviceId, start: z1.start, kunde: { name: 'Zweiter', email: `zwei-${Date.now()}@example.com` } });
    pruefe('Gleiche Zeit nochmal: 409 platz_weg mit Alternativen', weg.status === 409 && weg.json?.fehler?.code === 'platz_weg' && weg.json.fehler.alternativen?.length > 0, `${weg.status} ${weg.json?.fehler?.code}`);
    const frueh = `${laden.monday}T07:00:00+01:00`;
    const online7 = await api('POST', '/termine', { leistung_id: laden.serviceId, start: frueh, person_id: laden.staffId, kunde_id: k1.json.id });
    pruefe('Online vor Öffnung (7 Uhr): abgelehnt', online7.status >= 400 && online7.status < 500, `${online7.status} ${online7.json?.fehler?.code}`);
    const tresen = await api('POST', '/termine', { leistung_id: laden.serviceId, start: frueh, person_id: laden.staffId, kunde_id: k1.json.id, regeln: 'tresen' });
    pruefe('Tresen vor Öffnung (7 Uhr): 201', tresen.status === 201, `${tresen.status} ${tresen.json?.fehler?.code || ''}`);

    // Verschieben, Absagen
    const v = await api('POST', `/termine/${t1.json.id}/verschieben`, { start: z2.start, kunde_benachrichtigen: false });
    pruefe('Verschieben: 200, neue Zeit', v.status === 200 && Date.parse(v.json.start) === Date.parse(z2.start), `${v.status} ${v.json?.start}`);
    const liste = await api('GET', `/termine?von=${encodeURIComponent(`${laden.monday}T00:00:00+01:00`)}&kunde_id=${k1.json.id}`);
    pruefe('GET /termine nach Kunde', liste.status === 200 && liste.json.length === 2, `${liste.json?.length}`);
    for (const t of [t1.json, tresen.json].filter(Boolean)) {
      const a = await api('POST', `/termine/${t.id}/absagen`, { kunde_benachrichtigen: false });
      pruefe(`Absagen ${t.start}: abgesagt`, a.status === 200 && a.json.status === 'abgesagt', `${a.status}`);
    }
    pruefe('Zweimal absagen: kein Fehler', (await api('POST', `/termine/${t1.json.id}/absagen`, { kunde_benachrichtigen: false })).status === 200);

    // Webhook-Zustellungen: angelegt, verschoben, abgesagt (Beobachter + Zusteller laufen im Hintergrund)
    let typen = [];
    for (let i = 0; i < 20 && !['termin.angelegt', 'termin.verschoben', 'termin.abgesagt'].every((x) => typen.includes(x)); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const z = await api('GET', `/webhooks/${wh.json.id}/zustellungen`);
      typen = (z.json || []).map((x) => x.typ);
    }
    pruefe('Webhook: angelegt, verschoben, abgesagt gemeldet', ['termin.angelegt', 'termin.verschoben', 'termin.abgesagt'].every((x) => typen.includes(x)), [...new Set(typen)].join(', '));

    // Widerrufen: Schlüssel und Webhook weg
    await page.evaluate(async ({ shopId, id }) => {
      const { schluesselWiderrufen } = await import('/src/utils/api-schluessel.ts');
      return schluesselWiderrufen(shopId, id);
    }, { shopId: laden.shopId, id: schluesselId });
    schluesselId = '';
    pruefe('Nach Widerruf: 401', (await api('GET', '/laden')).status === 401);
  } finally {
    if (schluesselId) {
      await page.evaluate(async ({ shopId, id }) => {
        const { schluesselWiderrufen } = await import('/src/utils/api-schluessel.ts');
        return schluesselWiderrufen(shopId, id);
      }, { shopId: laden.shopId, id: schluesselId }).catch(() => {});
    }
    await removeTempShop(page, laden);
    await browser.close();
  }
  return report(rows);
});
