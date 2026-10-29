// Was Kunden tun, geht übers Backend (backend/app/apis/nummer): im Testladen über die Oberfläche
//  1. ohne Konto: Nummer ziehen → Nummernseite → zurückgeben
//  2. mit Konto (Wegwerf-Konto, Rolle Kunde): Nummer ziehen → zurückgeben, Termin zur Wunschzeit buchen → absagen
// Danach ist alles abgesagt und das Wegwerf-Konto gelöscht. Braucht den Entwicklungsserver (Konto anlegen über /src/…)
// und das Backend ab diesem Stand (QME_BACKEND).
const { BASE, launch, newPage, collectErrors, fixture, shot, report, run } = require('./lib.cjs');

/** Nummer ziehen über /public-join-queue: Leistung, erste Person, (ohne Konto) Name, „Nummer ziehen“ */
const pullNumber = async (page, shopId, name) => {
  await page.goto(`${BASE}/public-join-queue?shopId=${shopId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 30000 });
  await page.getByText(/Nächster Platz|\d{2}:\d{2}/).first().waitFor({ timeout: 30000 });
  if (name) await page.locator('#queue-name').fill(name);
  await page.getByRole('button', { name: 'Nummer ziehen' }).click();
  await page.waitForURL(/\/nummer\//, { timeout: 30000 });
  await page.getByText('Du bist eingereiht.').waitFor({ timeout: 30000 });
  return new URL(page.url()).pathname.split('/').pop();
};

/** Auf der Nummernseite zurückgeben bzw. absagen und warten, bis sie es zeigt */
const cancelHere = async (page, queue) => {
  await page.getByRole('button', { name: queue ? 'Nummer zurückgeben' : 'Termin absagen' }).click();
  await page.getByRole('button', { name: queue ? 'Ja, zurückgeben' : 'Ja, absagen' }).click();
  await page.getByText(queue ? 'Diese Nummer ist abgesagt.' : 'Dieser Termin ist abgesagt.').waitFor({ timeout: 30000 });
};

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const step = async (name, fn) => {
    try {
      check(name, true, (await fn()) || '');
    } catch (e) {
      check(name, false, String(e).split('\n')[0].slice(0, 160));
    }
  };

  // 1. ohne Konto
  const guest = await newPage(browser);
  const guestErrors = collectErrors(guest);
  await step('Ohne Konto: Nummer ziehen', async () => `Nummer-Seite ${await pullNumber(guest, fx.shopId, 'Test Kundenweg')}`);
  await shot(guest, 'kunde-ohne-konto');
  await step('Ohne Konto: zurückgeben', () => cancelHere(guest, true));
  check('Ohne Konto: keine JavaScript-Fehler', guestErrors.length === 0, guestErrors.join(' | '));

  // 2. mit Konto
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const account = await page.evaluate(async () => {
    const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
    const email = `q-me-test-${Date.now()}-kunde@example.com`;
    const { uid } = await registerWithRole(email, `Test-${Math.random().toString(36).slice(2)}`, 'customer');
    return { uid, email };
  });
  try {
    await step('Mit Konto: Nummer ziehen', async () => `Nummer-Seite ${await pullNumber(page, fx.shopId, null)}`);
    await step('Mit Konto: zurückgeben', () => cancelHere(page, true));
    await step('Mit Konto: Termin zur Wunschzeit buchen', async () => {
      await page.goto(`${BASE}/book-appointment?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
      await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
      await page.locator('section button[aria-pressed]').first().click({ timeout: 30000 });
      await page.getByRole('heading', { name: 'Wann passt es dir?' }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      const slots = page.locator('[aria-live] button[aria-label$="Uhr"]:not([disabled])');
      const jump = page.getByRole('button', { name: 'Nächsten freien Tag suchen' });
      if (await jump.count()) { await jump.click(); await page.waitForTimeout(5000); }
      await slots.first().click({ timeout: 30000 });
      await page.getByRole('button', { name: 'Termin buchen', exact: true }).click();
      await page.waitForURL(/\/nummer\//, { timeout: 30000 });
      await page.getByText('Dein Termin ist gebucht.').waitFor({ timeout: 30000 });
      return new URL(page.url()).pathname.split('/').pop();
    });
    // Termin mit Konto hat keine Tagesnummer: groß steht die Uhrzeit, darunter Tag und Dauer (kein „—“)
    const groß = (await page.locator('main bdi').first().innerText().catch(() => '')).trim();
    const dauer = (await page.locator('main').innerText()).match(/^Dauer\s+(\d+ Min)/im)?.[1] ?? '';
    check('Mit Konto: Marke zeigt Uhrzeit und Dauer', /^\d{2}:\d{2}$/.test(groß) && !!dauer, `${groß} · ${dauer}`);
    await shot(page, 'kunde-mit-konto-termin');
    await step('Mit Konto: Termin absagen', () => cancelHere(page, false));
  } finally {
    // Wegwerf-Konto weg (Profil, dann Anmeldung); die abgesagten Termine bleiben im Testladen
    await page.evaluate(async (uid) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      await fs.deleteDoc(fs.doc(firestore, 'users', uid));
      await firebaseAuth.currentUser.delete();
    }, account.uid).catch((e) => check('Wegwerf-Konto löschen', false, String(e).slice(0, 120)));
  }
  check('Mit Konto: keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
