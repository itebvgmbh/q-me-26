// Termin ohne Konto im Testladen buchen, „Platz ändern“ auf eine andere Zeit, dann absagen (räumt so selbst auf).
// Schreibt echt über das Backend (/nummer/termin, /nummer/verschieben) – nur im Testladen aus dev/fixtures.py.
// Läuft auch gegen dranzeit.de (QME_URL), weil es nur die Oberfläche bedient.
const { BASE, launch, newPage, collectErrors, fixture, shot, report, run } = require('./lib.cjs');

/** Freie Zeiten im Kalender; ohne freie am gezeigten Tag die nächsten Tage durchgehen */
const freeSlots = async (page, scope) => {
  const slots = scope.locator('[aria-live] button[aria-label$="Uhr"]:not([disabled])');
  await page.waitForTimeout(3000);
  const jump = scope.getByRole('button', { name: 'Nächsten freien Tag suchen' });
  if (await jump.count()) { await jump.click(); await page.waitForTimeout(5000); }
  const days = scope.locator('[aria-label="Tag wählen"] button:not([disabled])');
  for (let i = 1; i < (await days.count()) && (await slots.count()) === 0; i++) { await days.nth(i).click(); await page.waitForTimeout(2500); }
  return slots;
};

/** „Wann“ und „Um“ der Nummernseite, z. B. "Heute 16:30" (Beschriftung in Großbuchstaben, so liefert sie auch innerText) */
const shownTime = async (page) => {
  const text = await page.locator('main').innerText();
  const when = text.match(/^Wann\s+(.+)$/im)?.[1]?.trim() ?? '';
  const at = text.match(/^Um\s+(\d{2}:\d{2})/im)?.[1] ?? '';
  return `${when} ${at}`.trim();
};

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });

  // 1. Termin ohne Konto
  await page.goto(`${BASE}/book-appointment?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Wann passt es dir?' }).waitFor({ timeout: 30000 });
  const slots = await freeSlots(page, page);
  check('Freie Zeiten zum Buchen', (await slots.count()) > 0, `${await slots.count()}`);
  await slots.first().click();
  await page.getByLabel('Vorname').fill('Test Platz');
  await page.getByRole('button', { name: 'Termin buchen', exact: true }).click();
  await page.waitForURL(/\/nummer\//, { timeout: 30000 });
  await page.getByText('Dein Termin ist gebucht.').waitFor({ timeout: 30000 });
  const booked = await shownTime(page);
  check('Ohne Konto gebucht, Nummernseite zeigt den Termin', /\d{2}:\d{2}/.test(booked), booked);
  await shot(page, 'platz-gebucht');

  try {
    // 2. Platz ändern: eine andere freie Zeit (die eigene ist belegt) – die letzte des Tages, damit sie sicher anders ist
    await page.getByRole('button', { name: 'Platz ändern' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('heading', { name: 'Platz ändern' }).waitFor({ timeout: 15000 });
    const other = await freeSlots(page, sheet);
    const count = await other.count();
    check('Freie Zeiten zum Verschieben', count > 0, `${count}`);
    if (count > 0) {
      await other.nth(count - 1).click();
      const go = sheet.getByRole('button', { name: /^Auf .+ verschieben$/ });
      const label = await go.innerText();
      await go.click();
      await page.getByText(/^Dein Platz ist jetzt /).waitFor({ timeout: 30000 });
      await sheet.waitFor({ state: 'hidden', timeout: 15000 });
      // Die Seite liest die neue Zeit live nach
      let moved = booked;
      for (let i = 0; i < 20 && moved === booked; i++) { await page.waitForTimeout(500); moved = await shownTime(page); }
      check('Neue Zeit steht auf der Nummernseite', moved !== booked && label.includes(moved.split(' ').pop()), `${booked} → ${moved} (${label})`);
      await shot(page, 'platz-geaendert');
    }
  } catch (e) {
    check('Platz ändern', false, String(e).split('\n')[0].slice(0, 160));
  }

  // 3. Absagen – auch das Aufräumen
  await page.getByRole('button', { name: 'Termin absagen' }).click();
  await page.getByRole('button', { name: 'Ja, absagen' }).click();
  await page.getByText('Dieser Termin ist abgesagt.').waitFor({ timeout: 30000 });
  check('Abgesagt (aufgeräumt)', true);

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
