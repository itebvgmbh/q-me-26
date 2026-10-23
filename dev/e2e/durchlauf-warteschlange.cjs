// Nummer ziehen per QR-Link: Leistung → "Egal wer" → Bestätigung. Mit Argument "ziehen" wird wirklich
// eingereiht (legt einen Eintrag im Laden an!). Läuft gegen QME_SHOP_ID (Standard: ITEBV GmbH).
const { BASE, SHOP_ID, launch, newPage, collectErrors, shot, report, run } = require('./lib.cjs');

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/public-join-queue?shopId=${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
  const firstService = page.locator('section button[aria-pressed]').first();
  // Gesperrter Laden (Betreiber-Bereich): gleich mit Grund abbrechen statt nach einer Minute ohne Leistungen
  const suspended = page.getByText('Dieser Laden nimmt gerade keine Nummern an.').first();
  await firstService.or(suspended).first().waitFor({ timeout: 60000 });
  if (await suspended.isVisible()) {
    await browser.close();
    return report([{ name: 'Laden nimmt Nummern an', pass: false, detail: `${SHOP_ID} ist gesperrt – im Betreiber-Bereich entsperren oder QME_SHOP_ID setzen` }]);
  }
  await shot(page, 'warteschlange-1-leistung');
  await firstService.click();
  await page.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
  await page.waitForFunction(() => /\d{2}:\d{2}|kein Platz/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
  const confirmation = (await page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
  await page.locator('#queue-name').fill('Test Durchlauf').catch(() => {});
  await shot(page, 'warteschlange-2-bestaetigen');
  const rows = [{ name: 'Bestätigung mit Uhrzeit', pass: /\d{2}:\d{2}/.test(confirmation), detail: confirmation.slice(0, 160) }];
  if (process.argv[2] === 'ziehen') {
    await page.getByRole('button', { name: 'Nummer ziehen' }).click();
    await page.getByText('Du bist eingereiht.').waitFor({ timeout: 30000 });
    await shot(page, 'warteschlange-3-eingereiht');
    rows.push({ name: 'Eingereiht', pass: true });
  }
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
