// Termin buchen als Gast bis kurz vor dem Buchen (bucht nicht). Läuft gegen QME_SHOP_ID (Standard: ITEBV GmbH).
// Termin buchen ist derselbe Ablauf wie Nummer ziehen; im Schritt „Wann?“ ist die Wunschzeit vorgewählt.
// Gäste finden „Termin buchen“ im Menü und oben auf „Nummer ziehen“; Umschalten tauscht Adresse und Überschrift.
const { BASE, SHOP_ID, launch, newPage, collectErrors, shot, report, run } = require('./lib.cjs');

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/public-join-queue?shopId=${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Menü öffnen' }).click({ timeout: 60000 });
  const inMenu = await page.getByRole('dialog').getByRole('link', { name: 'Termin buchen' }).isVisible();
  await page.keyboard.press('Escape');
  const h1 = page.getByRole('heading', { level: 1 });
  const vorher = await h1.innerText();
  await page.locator('h1 + p').getByRole('button', { name: 'Termin buchen' }).click();
  await page.waitForURL(/\/book-appointment\?shopId=/, { timeout: 10000 }).catch(() => {});
  const umgeschaltet = `${vorher} → ${await h1.innerText()} (${new URL(page.url()).pathname})`;
  // Leistung, dann „Egal wer“ (bei nur einer Person steht dort ihr Name)
  await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Wann passt es dir?' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const slots = page.locator('[aria-live] button[aria-label$="Uhr"]:not([disabled])');
  const jump = page.getByRole('button', { name: 'Nächsten freien Tag suchen' });
  if (await jump.count()) { await jump.click(); await page.waitForTimeout(5000); }
  if ((await slots.count()) === 0) {
    const days = page.locator('[aria-label="Tag wählen"] button:not([disabled])');
    for (let i = 1; i < (await days.count()) && (await slots.count()) === 0; i++) { await days.nth(i).click(); await page.waitForTimeout(2500); }
  }
  const freeSlots = await slots.count();
  if (freeSlots > 0) { await slots.first().click(); await page.waitForTimeout(800); }
  const book = page.getByRole('button', { name: 'Termin buchen', exact: true });
  const disabledWithoutName = await book.isDisabled();
  await page.getByLabel('Vorname').fill('Test');
  const enabledWithName = await book.isEnabled();
  await shot(page, 'buchung-wann');
  const chosen = (await page.getByRole('group', { name: 'Wann?' }).innerText().catch(() => '')).replace(/\n+/g, ' | ');
  // Im Schritt „Wann?“ zurück zur Nummer: Adresse und Überschrift wechseln mit, der Schritt bleibt
  await page.getByRole('group', { name: 'Wann?' }).getByRole('button', { name: /So früh wie möglich/ }).click();
  await page.waitForURL(/\/public-join-queue\?shopId=/, { timeout: 10000 }).catch(() => {});
  const zurueck = `${await h1.innerText()} (${new URL(page.url()).pathname}) | ${await page.getByRole('heading', { level: 2 }).first().innerText()}`;
  await browser.close();
  return report([
    { name: 'Gast-Menü hat „Termin buchen“', pass: inMenu },
    { name: 'Oben umschalten: Nummer → Termin', pass: umgeschaltet === 'Nummer ziehen → Termin buchen (/book-appointment)', detail: umgeschaltet },
    { name: 'Freie Zeiten gefunden', pass: freeSlots > 0, detail: `${freeSlots}` },
    { name: 'Gewählte Zeit steht bei „Wunschzeit“', pass: /Termin · .*\d{2}:\d{2}/.test(chosen), detail: chosen.slice(0, 160) },
    { name: 'Ohne Konto: Buchen erst mit Vorname', pass: disabledWithoutName && enabledWithName },
    { name: 'Im Schritt „Wann?“ zurück zur Nummer', pass: zurueck === 'Nummer ziehen (/public-join-queue) | Wann passt es dir?', detail: zurueck },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
