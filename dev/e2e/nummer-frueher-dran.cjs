// „Früher dran“ für Kunden ohne Konto:
//  A. Nummer ziehen per QR-Link ohne Konto: Kasten „Früher dran … dafür brauchst du ein Konto“ mit Anmelden/Konto anlegen;
//     nach „Konto anlegen“ zurück auf derselben Seite, dort ist das Häkchen da.
//  B. Nummer ohne Konto ziehen, danach „Konto anlegen und Nummer behalten“ – und „Früher dran“ gleich auf der Nummernseite
//     einschalten. Vorher ging das nur unter „Meine Termine“; auf der Nummernseite fehlte der Schalter.
// Braucht: Entwicklungsserver mit Backend ab diesem Stand (QME_BACKEND) und Testdaten (python dev/fixtures.py anlegen).
// Legt ein Kundenkonto kunde-…@example.com an und löscht es am Ende wieder; die Nummer räumt fixtures.py loeschen weg.
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

const ok = (p) => p.then(() => true, () => false);

/** Angemeldetes Konto im Browser wieder löschen (Profil und Anmeldung) */
const removeAccount = (page) =>
  page.evaluate(async () => {
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    const user = firebaseAuth.currentUser;
    if (!user) return;
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    await fs.deleteDoc(fs.doc(firestore, 'users', user.uid)).catch(() => {});
    await user.delete().catch(() => {});
  }).catch(() => {});

/** Nummer ziehen per QR-Link bis zur Bestätigung: Leistung → „Egal wer“ */
const toConfirmation = async (page, shopId) => {
  await page.goto(`${BASE}/public-join-queue?shopId=${shopId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
  await page.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
  await page.waitForFunction(() => /\d{2}:\d{2}|kein Platz/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
};

/** A. Ohne Konto: Hinweis mit Anmelden/Konto anlegen, danach zurück und Häkchen da */
const teilA = async (browser, fx, rows) => {
  const page = await newPage(browser);
  const errors = collectErrors(page);
  try {
    await toConfirmation(page, fx.shopId);
    const box = page.getByText('Dafür brauchst du ein Konto');
    rows.push({ name: 'A: ohne Konto Hinweis „Früher dran“', pass: await ok(box.waitFor({ timeout: 15000 })) });
    rows.push({ name: 'A: ohne Konto kein Häkchen', pass: (await page.getByRole('checkbox').count()) === 0 });
    await page.getByRole('link', { name: 'Konto anlegen' }).click();
    await page.getByLabel('E-Mail').fill(`kunde-${Date.now()}a@example.com`);
    await page.getByLabel('Passwort', { exact: true }).fill(`Test-${Math.random().toString(36).slice(2)}`);
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const back = await ok(page.waitForURL((url) => url.pathname === '/public-join-queue' && url.searchParams.get('shopId') === fx.shopId, { timeout: 30000 }));
    rows.push({ name: 'A: nach „Konto anlegen“ zurück beim Nummer ziehen', pass: back, detail: page.url().replace(BASE, '') });
    await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
    await page.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
    rows.push({ name: 'A: mit Konto Häkchen „Früher dran“', pass: await ok(page.getByText('Früher dran, wenn etwas frei wird').waitFor({ timeout: 30000 })) && (await page.getByRole('checkbox').count()) === 1 });
    rows.push({ name: 'A: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  } finally {
    await removeAccount(page);
    await page.close();
  }
};

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const mail = `kunde-${Date.now()}@example.com`;
  await teilA(browser, fx, rows);
  try {
    // Nummer ohne Konto für Montag 11:00 (Testladen in der Testphase, also mit „Früher dran“)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const ticket = await page.evaluate(async (fx) => {
      const { QueueBookingService } = await import('/src/utils/QueueBookingService.ts');
      const [y, m, d] = fx.monday.split('-').map(Number);
      const start = new Date(y, m - 1, d, 11, 0);
      const r = await QueueBookingService.processBooking({
        selectedShop: fx.shopId, selectedService: fx.serviceId, selectedStaffForSlot: fx.staffId,
        nextAvailableSlot: { start, end: new Date(start.getTime() + 30 * 60000), isAvailable: true },
        checkEarlierOptions: false, user: null, contact: { name: 'Früh ohne Konto', phone: '' },
      });
      return { ok: r.success, id: r.appointmentId, key: r.ticketKey, message: r.message };
    }, fx);
    rows.push({ name: 'B: Nummer ohne Konto gezogen', pass: ticket.ok && !!ticket.key, detail: ticket.message || ticket.id });
    if (!ticket.ok) return report(rows);

    await page.goto(`${BASE}/nummer/${ticket.id}#k=${ticket.key}`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'B: ohne Konto Hinweis „geht mit Konto“', pass: await ok(page.getByText(/Das geht mit Konto/).waitFor({ timeout: 20000 })) });
    rows.push({ name: 'Ohne Konto: kein Schalter', pass: (await page.getByRole('switch').count()) === 0 });

    await page.getByRole('button', { name: 'Konto anlegen und Nummer behalten' }).click();
    await page.getByLabel('E-Mail').fill(mail);
    await page.getByLabel('Passwort', { exact: true }).fill(`Test-${Math.random().toString(36).slice(2)}`);
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const back = await ok(page.waitForURL(new RegExp(`/nummer/${ticket.id}`), { timeout: 30000 }));
    rows.push({ name: 'Nach dem Anlegen zurück auf der Nummer', pass: back, detail: page.url().replace(BASE, '') });

    const toggle = page.getByRole('switch', { name: /Früher dran/ });
    const shown = await ok(toggle.waitFor({ timeout: 30000 }));
    rows.push({ name: 'Mit Konto: Schalter auf der Nummernseite', pass: shown });
    if (shown) {
      await toggle.click();
      const on = await ok(page.getByText('Früher dran ist an').waitFor({ timeout: 15000 }));
      rows.push({ name: 'Einschalten klappt', pass: on && (await toggle.getAttribute('aria-checked')) === 'true' });
    }
    rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  } finally {
    // Kundenkonto wieder weg (Profil und Anmeldung); die Nummer bleibt im Testladen bis fixtures.py loeschen
    await removeAccount(page);
    await browser.close();
  }
  return report(rows);
});
