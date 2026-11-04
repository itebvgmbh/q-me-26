// Verbindungsart zur Datenbank (frontend/src/utils/connection.ts), nur lesend, keine Testdaten nötig:
//  - iPhone (Safari-Technik) nimmt gleich die einfache Verbindungsart (Long-Polling, CI=1), Windows-Chrome die
//    Dauerverbindung (CI=0). Hintergrund: 21.10.2026 hing die Dauerverbindung auf einem iPhone 59 Sekunden.
//  - Nummernseite: Sie holt ihre Daten seit Stufe 2 vom Backend (frontend/src/utils/live.ts), nicht mehr über
//    Firestore. Auch wenn Firestore gar nicht antwortet, kommt die Antwort sofort und ohne Neuladen – in Chrome
//    und auf dem iPhone. (Bis 04.11.2026 lud sie nach 8 Sekunden mit einfacher Verbindungsart neu.)
// Braucht: Entwicklungsserver (npm run dev). Liest den Laden aus QME_SHOP_ID (Standard: ITEBV-Testbetrieb).
const { BASE, SHOP_ID, launch, shot, collectErrors, report, run } = require('./lib.cjs');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Berlin', locale: 'de-DE' };

/** Verbindungsart der Listen-Anfragen: CI=0 Dauerverbindung, CI=1 einfach (Long-Polling) */
const modes = (urls) => [...new Set(urls.map((u) => new URL(u).searchParams.get('CI')).filter((v) => v !== null))];

run(async () => {
  const browser = await launch();
  const rows = [];

  // --- Welche Verbindungsart je Gerät ---
  for (const [name, ua, want] of [['Windows-Chrome', undefined, '0'], ['iPhone', IPHONE, '1']]) {
    const ctx = await browser.newContext({ ...PHONE, ...(ua ? { userAgent: ua } : {}) });
    const page = await ctx.newPage();
    const urls = [];
    page.on('request', (r) => r.url().includes('/Listen/channel') && urls.push(r.url()));
    await page.goto(`${BASE}/public-join-queue?shopId=${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
    await page.locator('section button[aria-pressed]').first().waitFor({ timeout: 30000 });
    rows.push({ name: `${name}: CI=${want}`, pass: modes(urls).join() === want, detail: `CI=${modes(urls).join(',')}` });
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
    await page.route('**/Listen/channel**', (route) => {
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
