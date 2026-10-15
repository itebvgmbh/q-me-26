// Termin buchen als Gast bis zur Zusammenfassung (bucht nicht). Läuft gegen QME_SHOP_ID (Standard: ITEBV GmbH).
const { BASE, SHOP_ID, launch, newPage, collectErrors, shot, report, run } = require('./lib.cjs');

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/book-appointment?shopId=${SHOP_ID}&fromMarketplace=true`, { waitUntil: 'domcontentloaded' });
  const services = page.locator('section[aria-labelledby="schritt-2"] button');
  await services.first().waitFor({ timeout: 60000 });
  await services.first().click();
  await page.waitForTimeout(1500);
  const people = page.locator('section[aria-labelledby="schritt-3"] button');
  if ((await people.count()) > 0 && !(await page.locator('section[aria-labelledby="schritt-4"]').count())) await people.first().click();
  await page.waitForTimeout(3000);
  const slots = page.locator('section[aria-labelledby="schritt-4"] [aria-live] button[aria-label$="Uhr"]:not([disabled])');
  const jump = page.getByRole('button', { name: 'Nächsten freien Tag suchen' });
  if (await jump.count()) { await jump.click(); await page.waitForTimeout(5000); }
  if ((await slots.count()) === 0) {
    const days = page.locator('[aria-label="Tag wählen"] button:not([disabled])');
    for (let i = 1; i < (await days.count()) && (await slots.count()) === 0; i++) { await days.nth(i).click(); await page.waitForTimeout(2500); }
  }
  const freeSlots = await slots.count();
  if (freeSlots > 0) { await slots.first().click(); await page.waitForTimeout(800); }
  await shot(page, 'buchung-zusammenfassung');
  const summary = (await page.locator('[aria-label="Zusammenfassung"]').innerText().catch(() => '')).replace(/\n+/g, ' | ');
  await browser.close();
  return report([
    { name: 'Freie Zeiten gefunden', pass: freeSlots > 0, detail: `${freeSlots}` },
    { name: 'Zusammenfassung mit Uhrzeit', pass: /um \d{2}:\d{2}/.test(summary), detail: summary.slice(0, 160) },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
