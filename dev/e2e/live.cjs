// Nummernseite und Wartezimmer-Bildschirm holen ihre Daten vom Backend und aktualisieren sich über Server-Sent Events
// (frontend/src/utils/live.ts, backend/app/apis/live; requirements/eigene-datenbank.md, Stufe 2).
// Kein Testkonto, keine Testdaten nötig:
//  1. Gegen das echte Backend, nur lesend: Bildschirm des Ladens QME_SHOP_ID (Standard: ITEBV-Testbetrieb) lädt über
//     /routes/live, hört auf /routes/live/ereignisse und fragt Firestore nicht.
//  2. Mit nachgestellten Antworten: Eine Nummer wechselt von „wartet“ auf „du bist dran“, ein Bildschirm zeigt sie
//     als „Jetzt dran“ – nur weil das Backend „aenderung“ meldet, ohne Neuladen der Seite. Zeitpunkte kommen als
//     {"__zeit": …} und werden richtig angezeigt.
// Braucht: Entwicklungsserver mit QME_BACKEND=https://dranzeit.de (oder QME_URL=https://dranzeit.de nach dem Ausrollen).
const { BASE, SHOP_ID, launch, newPage, shot, collectErrors, report, run } = require('./lib.cjs');

const zeit = (d) => ({ __zeit: d.toISOString() });
const uhr = (d) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(d);
const tagBerlin = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d); // JJJJ-MM-TT

/** Ereignisstrom nachstellen: je Verbindung ein Stück Text; danach lange Ruhe (retry), damit nichts im Kreis läuft */
const strom = (stuecke) => {
  let n = 0;
  return (route) => {
    const body = stuecke[n++] ?? 'retry: 600000\n\n: ruhe\n\n';
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }, body });
  };
};

/** Zählt Anfragen an Firestores Dauerverbindung (Listen/channel) – die beiden Seiten sollen sie nicht mehr brauchen */
const firestoreZaehlen = (page) => {
  const listen = [];
  page.on('request', (r) => r.url().includes('/Listen/channel') && listen.push(r.url()));
  return listen;
};

run(async () => {
  const browser = await launch();
  const rows = [];
  const jetzt = new Date();
  const heute = tagBerlin(jetzt);

  // --- 1. Echtes Backend: Bildschirm ---
  {
    const page = await newPage(browser, { viewport: { width: 1280, height: 720 } });
    const errors = collectErrors(page);
    const listen = firestoreZaehlen(page);
    const antworten = [];
    page.on('response', (r) => r.url().includes('/routes/live/') && antworten.push(`${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`));
    await page.goto(`${BASE}/bildschirm/${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForResponse((r) => r.url().includes('/routes/live/ereignisse'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const daten = antworten.find((a) => a.includes(`/routes/live/bildschirm/${SHOP_ID}`));
    rows.push({ name: 'Echt: Bildschirm-Daten vom Backend', pass: Boolean(daten && daten.startsWith('200') && daten.includes(`tag=${heute}`)), detail: daten });
    rows.push({ name: 'Echt: hört auf Ereignisse', pass: antworten.some((a) => a.startsWith('200 /routes/live/ereignisse') && a.includes(`tag%3A${SHOP_ID}_${heute}`)), detail: antworten.filter((a) => a.includes('ereignisse')).join(', ') });
    rows.push({ name: 'Echt: Firestore nicht gefragt', pass: listen.length === 0, detail: `${listen.length} Listen-Anfragen` });
    rows.push({ name: 'Echt: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
    await shot(page, 'live-bildschirm-echt', false);
    await page.context().close();
  }

  // --- 2a. Nachgestellt: Nummer wird aufgerufen ---
  {
    const page = await newPage(browser);
    const errors = collectErrors(page);
    const listen = firestoreZaehlen(page);
    const start = new Date(jetzt.getTime() + 25 * 60000);
    let aufgerufen = false;
    let abrufe = 0;
    const termin = () => ({
      id: 'live-test-1', shopId: 'laden-live-test', staffId: 'kim', serviceId: 'schnitt', type: 'queue',
      status: aufgerufen ? 'in-progress' : 'scheduled', startTime: zeit(start), endTime: zeit(new Date(start.getTime() + 30 * 60000)),
      referenceCode: 'A7', isAnonymous: true, staffDay: `kim_${heute}`, shopDay: `laden-live-test_${heute}`,
      ...(aufgerufen ? { calledAt: zeit(new Date()) } : {}),
    });
    await page.route('**/routes/live/nummer/live-test-1', (route) => {
      abrufe++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          termin: termin(),
          spur: [termin()],
          laden: { id: 'laden-live-test', name: 'Testsalon Live', street: 'Teststraße 1', postalCode: '10115', city: 'Berlin' },
          leistung: { name: 'Schnitt' },
          person: { name: 'Kim' },
          kanaele: ['termin:live-test-1', `tag:laden-live-test_${heute}`],
        }),
      });
    });
    // 1. Verbindung: nur „bereit“ (gerade geladen: kein zweites Laden). 2. Verbindung: die Nummer wird aufgerufen.
    await page.route('**/routes/live/ereignisse**', strom([
      'retry: 400\n\nevent: bereit\ndata: {}\n\n',
      'retry: 400\n\nevent: aenderung\ndata: {"kanal": "termin:live-test-1"}\n\n',
    ]));
    let verbindungen = 0;
    let vorAenderung = -1;
    page.on('request', (r) => {
      if (!r.url().includes('/routes/live/ereignisse')) return;
      verbindungen++;
      if (verbindungen === 2) {
        aufgerufen = true; // was das Backend gleich meldet, steht ab jetzt so in den Daten
        vorAenderung = abrufe;
      }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/nummer/live-test-1`, { waitUntil: 'domcontentloaded' });
    await page.getByText('A7').first().waitFor({ timeout: 15000 }).catch(() => {});
    const zuerst = await page.getByText('Dran um ca.').isVisible();
    const uhrzeit = await page.getByText(uhr(start)).first().isVisible().catch(() => false);
    await page.getByText('Du bist dran. Komm rein.').waitFor({ timeout: 8000 }).catch(() => {});
    const dran = await page.getByText('Du bist dran. Komm rein.').isVisible();
    const sekunden = (Date.now() - t0) / 1000;
    rows.push({ name: 'Nummer: geladen mit Zeit aus {"__zeit"}', pass: zuerst && uhrzeit, detail: `ca. ${uhr(start)}` });
    rows.push({ name: 'Nummer: Aufruf kommt ohne Neuladen', pass: dran, detail: `${sekunden.toFixed(1)} s nach dem Öffnen` });
    // Erstes Laden: einmal, im Entwicklungsserver (React StrictMode) zweimal; „bereit“ direkt danach lädt nicht nach
    rows.push({ name: 'Nummer: „bereit“ lädt nicht doppelt', pass: vorAenderung >= 1 && vorAenderung <= 2, detail: `${vorAenderung} Abrufe vor „aenderung“` });
    rows.push({ name: 'Nummer: „aenderung“ lädt genau einmal', pass: abrufe - vorAenderung === 1, detail: `${abrufe - vorAenderung} Abruf danach` });
    rows.push({ name: 'Nummer: Firestore nicht gefragt', pass: listen.length === 0, detail: `${listen.length} Listen-Anfragen` });
    rows.push({ name: 'Nummer: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
    await shot(page, 'live-nummer-dran', false);
    await page.context().close();
  }

  // --- 2b. Nachgestellt: Bildschirm zeigt die aufgerufene Nummer ---
  {
    const page = await newPage(browser, { viewport: { width: 1280, height: 720 } });
    const errors = collectErrors(page);
    const listen = firestoreZaehlen(page);
    let aufgerufen = false;
    let gefragterTag = '';
    await page.route('**/routes/live/bildschirm/bildschirm-live-test**', (route) => {
      gefragterTag = new URL(route.request().url()).searchParams.get('tag') || '';
      const start = new Date(jetzt.getTime() + 10 * 60000);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          laden: { id: 'bildschirm-live-test', name: 'Testsalon Live', plan: 'laden', billing: { plan: 'laden', status: 'active', currentPeriodEnd: zeit(new Date(jetzt.getTime() + 20 * 86400000)) } },
          personen: [{ id: 'kim', name: 'Kim' }],
          termine: [
            { id: 'b3', shopId: 'bildschirm-live-test', staffId: 'kim', type: 'queue', status: aufgerufen ? 'in-progress' : 'scheduled', referenceCode: 'B3', startTime: zeit(start), endTime: zeit(new Date(start.getTime() + 30 * 60000)) },
          ],
          tag: gefragterTag,
          kanaele: [`tag:bildschirm-live-test_${gefragterTag}`],
        }),
      });
    });
    let verbindungen = 0;
    page.on('request', (r) => {
      if (!r.url().includes('/routes/live/ereignisse')) return;
      verbindungen++;
      if (verbindungen === 2) aufgerufen = true;
    });
    await page.route('**/routes/live/ereignisse**', strom([
      'retry: 400\n\nevent: bereit\ndata: {}\n\n',
      `retry: 400\n\nevent: aenderung\ndata: {"kanal": "tag:bildschirm-live-test_${heute}"}\n\n`,
    ]));
    await page.goto(`${BASE}/bildschirm/bildschirm-live-test`, { waitUntil: 'domcontentloaded' });
    const naechste = page.locator('article').filter({ hasText: 'Kim' });
    await naechste.getByText('B3').first().waitFor({ timeout: 15000 }).catch(() => {});
    const wartet = await naechste.getByText('Als Nächstes').isVisible() && !(await page.locator('.bg-signal').filter({ hasText: 'B3' }).count());
    await page.locator('.bg-signal').filter({ hasText: 'B3' }).first().waitFor({ timeout: 8000 }).catch(() => {});
    const jetztDran = (await page.locator('.bg-signal').filter({ hasText: 'B3' }).count()) > 0;
    rows.push({ name: 'Bildschirm: heutiger Tag gefragt', pass: gefragterTag === heute, detail: gefragterTag });
    rows.push({ name: 'Bildschirm: B3 wartet zuerst', pass: wartet });
    rows.push({ name: 'Bildschirm: B3 „Jetzt dran“ ohne Neuladen', pass: jetztDran });
    rows.push({ name: 'Bildschirm: Firestore nicht gefragt', pass: listen.length === 0, detail: `${listen.length} Listen-Anfragen` });
    rows.push({ name: 'Bildschirm: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
    await shot(page, 'live-bildschirm-dran', false);
    await page.context().close();
  }

  // --- 2c. Nachgestellt: Nummer gibt es nicht (404 vom Backend) ---
  {
    const page = await newPage(browser);
    await page.route('**/routes/live/nummer/live-test-weg', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Diese Nummer gibt es nicht."}' }));
    await page.goto(`${BASE}/nummer/live-test-weg`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Diese Nummer gibt es nicht.').waitFor({ timeout: 10000 }).catch(() => {});
    rows.push({ name: '404: „Diese Nummer gibt es nicht.“', pass: await page.getByText('Diese Nummer gibt es nicht.').isVisible() });
    await page.context().close();
  }

  await browser.close();
  return report(rows);
});
