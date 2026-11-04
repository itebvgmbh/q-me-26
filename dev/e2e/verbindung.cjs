// Verbindung zum Server (frontend/src/utils/live.ts), nur lesend, keine Testdaten nötig. Seit Stufe 2
// (requirements/eigene-datenbank.md) fragt der Browser Firestore gar nicht mehr – also auch keine Dauerverbindung, die
// in manchen WLANs und auf dem iPhone hing (21.10.2026: 59 Sekunden). Geprüft, in Chrome und auf dem iPhone:
//  - Nummer ziehen: Laden und Leistungen kommen vom Backend, keine einzige Anfrage an Firestore.
//  - Nummernseite: kommt sofort und ohne Neuladen, auch wenn Firestore gar nicht antworten würde.
// Braucht: Entwicklungsserver (npm run dev). Liest den Laden aus QME_SHOP_ID (Standard: ITEBV-Testbetrieb).
const { BASE, SHOP_ID, launch, shot, collectErrors, report, run } = require('./lib.cjs');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Berlin', locale: 'de-DE' };
const FIRESTORE = /firestore\.googleapis\.com|\/Listen\/channel|\/Write\/channel/;

run(async () => {
  const browser = await launch();
  const rows = [];

  // --- Nummer ziehen: alles vom Backend, Firestore nie gefragt ---
  for (const [name, ua] of [['Chrome', undefined], ['iPhone', IPHONE]]) {
    const ctx = await browser.newContext({ ...PHONE, ...(ua ? { userAgent: ua } : {}) });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    const firestore = [];
    const live = [];
    page.on('request', (r) => {
      if (FIRESTORE.test(r.url())) firestore.push(r.url());
      if (r.url().includes('/routes/live/')) live.push(new URL(r.url()).pathname);
    });
    await page.goto(`${BASE}/public-join-queue?shopId=${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
    await page.locator('section button[aria-pressed]').first().waitFor({ timeout: 30000 });
    rows.push({ name: `${name}: Nummer ziehen ohne Firestore`, pass: firestore.length === 0, detail: `${firestore.length} Anfragen` });
    rows.push({ name: `${name}: Laden vom Backend`, pass: live.includes(`/routes/live/laden/${SHOP_ID}`), detail: [...new Set(live)].join(', ') });
    rows.push({ name: `${name}: keine JavaScript-Fehler (ziehen)`, pass: errors.length === 0, detail: errors.join(' | ') });
    await ctx.close();
  }

  // --- Nummernseite: kommt vom Backend, Firestore darf schweigen ---
  // Wie am 21.10.2026 auf dem iPhone: Firestore beantwortet gar nichts (stuck). Die Nummernseite fragt es nicht mehr.
  for (const [name, ua] of [['Chrome', undefined], ['iPhone', IPHONE]]) {
    const ctx = await browser.newContext({ ...PHONE, ...(ua ? { userAgent: ua } : {}) });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    let docs = 0;
    const listen = [];
    const live = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) docs++;
      if (r.url().includes('/routes/live/')) live.push(new URL(r.url()).pathname);
    });
    await page.route(FIRESTORE, (route) => {
      listen.push(route.request().url()); // nie beantworten
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/nummer/gibt-es-nicht-verbindungstest`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Diese Nummer gibt es nicht.').waitFor({ timeout: 15000 }).catch(() => {});
    const seconds = (Date.now() - t0) / 1000;
    const shown = await page.getByText('Diese Nummer gibt es nicht.').isVisible();
    rows.push({ name: `${name}: Nummer ohne Firestore sofort da`, pass: shown && seconds < 8, detail: `${seconds.toFixed(1)} s` });
    rows.push({ name: `${name}: über das Backend`, pass: live.includes('/routes/live/nummer/gibt-es-nicht-verbindungstest'), detail: live.join(', ') });
    rows.push({ name: `${name}: kein Neuladen`, pass: docs === 1, detail: `${docs} Ladevorgänge` });
    rows.push({ name: `${name}: Firestore nicht gefragt`, pass: listen.length === 0, detail: `${listen.length} Listen-Anfragen` });
    rows.push({ name: `${name}: keine JavaScript-Fehler`, pass: errors.length === 0, detail: errors.join(' | ') });
    if (ua) await shot(page, 'verbindung-nummer-iphone', false);
    await ctx.close();
  }

  await browser.close();
  return report(rows);
});
