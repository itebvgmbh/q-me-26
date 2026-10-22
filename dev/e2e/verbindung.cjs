// Verbindungsart zur Datenbank (frontend/src/utils/connection.ts), nur lesend, keine Testdaten nötig:
//  - iPhone (Safari-Technik) nimmt gleich die einfache Verbindungsart (Long-Polling, CI=1), Windows-Chrome die
//    Dauerverbindung (CI=0). Hintergrund: 21.10.2026 hing die Dauerverbindung auf einem iPhone 59 Sekunden.
//  - Nummernseite: Kommt über die Dauerverbindung nichts an, lädt sie nach 8 Sekunden mit einfacher
//    Verbindungsart neu. In Safari (schon einfach) lädt sie nicht endlos neu.
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

  // --- Nummernseite: Datenbank antwortet nicht → nach 8 s neu laden mit einfacher Verbindungsart ---
  // Chrome erkennt eine hängende Dauerverbindung selbst und schaltet um, das iPhone tat es nicht. Darum hier beim
  // ersten Laden gar keine Antwort (stuck), wie auf dem iPhone; nach dem Neuladen (Dokument 2) normal.
  const hang = async (ua, stuck) => {
    const ctx = await browser.newContext({ ...PHONE, ...(ua ? { userAgent: ua } : {}) });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    let docs = 0;
    const urls = [];
    page.on('request', (r) => r.isNavigationRequest() && r.frame() === page.mainFrame() && docs++);
    await page.route('**/Listen/channel**', (route) => {
      urls.push({ doc: docs, url: route.request().url() });
      if (stuck(docs)) return; // nie beantworten
      return route.continue();
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/nummer/gibt-es-nicht-verbindungstest`, { waitUntil: 'domcontentloaded' });
    return { ctx, page, errors, urls, t0, docs: () => docs };
  };

  const chrome = await hang(undefined, (doc) => doc < 2);
  await chrome.page.getByText('Diese Nummer gibt es nicht.').waitFor({ timeout: 30000 }).catch(() => {});
  const seconds = (Date.now() - chrome.t0) / 1000;
  const flag = await chrome.page.evaluate(() => sessionStorage.getItem('qme-verbindung-einfach'));
  const after = modes(chrome.urls.filter((u) => u.doc >= 2).map((u) => u.url));
  rows.push({ name: 'Hängt: nach 8 s neu geladen', pass: chrome.docs() === 2 && seconds >= 8 && seconds < 25, detail: `${chrome.docs()} Ladevorgänge, ${seconds.toFixed(1)} s` });
  rows.push({ name: 'Hängt: danach einfache Verbindung', pass: flag === '1' && after.join() === '1', detail: `Merker ${flag}, CI=${after.join(',')}` });
  rows.push({ name: 'Hängt: Ergebnis kommt an', pass: await chrome.page.getByText('Diese Nummer gibt es nicht.').isVisible() });
  rows.push({ name: 'Hängt: keine JavaScript-Fehler', pass: chrome.errors.length === 0, detail: chrome.errors.join(' | ') });
  await chrome.ctx.close();

  const safari = await hang(IPHONE, () => true);
  // Länger als Firestores 10 s bis „offline“: dann meldet es „nicht da“ aus dem Zwischenspeicher – kein 404 zeigen
  await safari.page.waitForTimeout(14000);
  rows.push({ name: 'Safari: kein Neuladen im Kreis', pass: safari.docs() === 1, detail: `${safari.docs()} Ladevorgänge` });
  rows.push({ name: 'Safari: wartet sichtbar', pass: await safari.page.getByText('Deine Nummer wird geladen').isVisible() });
  await shot(safari.page, 'verbindung-safari-wartet', false);
  await safari.ctx.close();

  await browser.close();
  return report(rows);
});
