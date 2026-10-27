// Gestörtes WLAN nachstellen: Was zeigt die App, wenn die Datenbank-Verbindung gestört ist?
//   node dev/e2e/wlan.cjs block   alle Datenbank-Anfragen gesperrt → klare Meldung "Keine Verbindung" (nicht "nicht gefunden")
//   node dev/e2e/wlan.cjs kill    Dauerverbindung bricht ab → App muss trotzdem laden
//   node dev/e2e/wlan.cjs hang    Dauerverbindung hängt → App muss trotzdem laden
// Optional zweites Argument: Seite (Standard: QR-Link des Ladens).
const { BASE, SHOP_ID, launch, newPage, shot, report, run } = require('./lib.cjs');

run(async () => {
  const mode = process.argv[2] || 'block';
  const path = process.argv[3] || `/public-join-queue?shopId=${SHOP_ID}`;
  const browser = await launch();
  const page = await newPage(browser);
  let loads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads++; });
  await page.route(/firestore\.googleapis\.com/, async (route) => {
    const url = new URL(route.request().url());
    const stream = route.request().method() === 'GET' && url.searchParams.get('CI') === '0';
    if (mode === 'block' || (mode === 'kill' && stream)) return route.abort('connectionreset');
    if (mode === 'hang' && stream) return; // nie beantworten
    return route.continue();
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  let state = 'nichts nach 60 s';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const text = await page.locator('#root').innerText().catch(() => '');
    const toasts = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' / ');
    if (/Keine Verbindung/.test(text)) { state = 'Meldung'; break; }
    if (/nicht gefunden|Hier ist noch kein Shop/i.test(text + toasts)) { state = 'falsche Meldung'; break; }
    if (/Was soll gemacht werden|Alle Läden|Leistungen/.test(text) && !/wir holen/.test(text)) { state = 'geladen'; break; }
  }
  await shot(page, `wlan-${mode}`, false);
  const simple = await page.evaluate(() => { try { return sessionStorage.getItem('qme-verbindung-einfach'); } catch { return null; } });
  await browser.close();
  const expected = mode === 'block' ? 'Meldung' : 'geladen';
  return report([
    { name: `Modus ${mode}: ${expected}`, pass: state === expected, detail: state },
    ...(mode === 'block' ? [{ name: 'Zweiter Versuch mit einfacher Verbindung', pass: simple === '1' && loads >= 2, detail: `Seitenladungen ${loads}` }] : []),
  ]);
});
