// Tarife im Testladen: Preisseite, AGB, "Mein Tarif" und die Sperren im Gratis-Tarif (utils/plans.ts).
//  - Preisseite: 4 Tarife, Brutto-Hinweis, keine Provision; AGB mit Auftragsverarbeitung
//  - Testphase: "Mein Tarif" zeigt Testphase und Verbrauch
//  - Gratis (Testphase künstlich beendet): kein "Früher dran", keine Online-Termine, Team auf 1 Person begrenzt
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Stellt die Testphase am Ende wieder her.
const { BASE, launch, newPage, shot, collectErrors, fixture, report, run } = require('./lib.cjs');

const signIn = async (page, fx) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, fx.email, fx.pw);
  }, fx);
};

/** Testphase des Testladens setzen (Datum) oder zurück auf Standard (null) */
const setTrialEnd = (page, shopId, iso) =>
  page.evaluate(
    async ({ shopId, iso }) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      await fs.updateDoc(fs.doc(firestore, 'shops', shopId), { trialEndsAt: iso ? fs.Timestamp.fromDate(new Date(iso)) : fs.deleteField() });
    },
    { shopId, iso },
  );

const text = (page) => page.evaluate(() => document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];

  for (const [label, viewport] of [['handy', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await newPage(browser, { viewport });
    const errors = collectErrors(page);
    await page.goto(`${BASE}/preise`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Keine Provision/ }).waitFor({ timeout: 30000 });
    const t = await text(page);
    rows.push({ name: `${label}: Preisseite zeigt 4 Tarife`, pass: ['Gratis', 'Solo', 'Laden', 'Team'].every((p) => t.includes(p)) && /19\s*€/.test(t) && /39\s*€/.test(t) && /59\s*€/.test(t) });
    rows.push({ name: `${label}: Bruttopreis steht dabei`, pass: /inkl\. MwSt\./.test(t) });
    await page.getByRole('radio', { name: /Jährlich/ }).click();
    rows.push({ name: `${label}: Jahrespreis 390 €`, pass: /390\s*€/.test(await text(page)) });
    rows.push({ name: `${label}: Preisseite ohne Überlauf`, pass: (await overflow(page)) <= 0, detail: String(await overflow(page)) });
    await shot(page, `tarife-preise-${label}`);
    await page.goto(`${BASE}/agb`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Auftragsverarbeitung/ }).waitFor({ timeout: 30000 });
    rows.push({ name: `${label}: AGB mit Auftragsverarbeitung`, pass: true });
    rows.push({ name: `${label}: keine JavaScript-Fehler`, pass: errors.length === 0, detail: errors.join(' | ') });
    await page.close();
  }

  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  await signIn(page, fx);
  try {
    await setTrialEnd(page, fx.shopId, null);
    await page.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Kunden diesen Monat').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    let t = await text(page);
    rows.push({ name: 'Mein Tarif: Testphase sichtbar', pass: /Testphase mit allen Funktionen/.test(t), detail: t.slice(0, 200) });
    await shot(page, 'tarife-mein-tarif-test');

    // Testphase beenden -> Gratis
    await setTrialEnd(page, fx.shopId, new Date(Date.now() - 86400000).toISOString());
    await page.waitForTimeout(1500);
    t = await text(page);
    rows.push({ name: 'Mein Tarif: nach der Testphase Gratis', pass: /Gratis-Tarif\./.test(t) && /\/ 100/.test(t), detail: t.slice(0, 200) });
    await shot(page, 'tarife-mein-tarif-gratis');

    await page.goto(`${BASE}/book-appointment?shopId=${fx.shopId}&fromMarketplace=true`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/nimmt online keine festen Termine an/).waitFor({ timeout: 30000 });
    rows.push({ name: 'Gratis: keine Online-Termine, Hinweis auf Nummer ziehen', pass: true });

    await page.goto(`${BASE}/public-join-queue?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    await page.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
    await page.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
    await page.waitForFunction(() => /\d{2}:\d{2}|kein Platz/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
    rows.push({ name: 'Gratis: kein "Früher dran" beim Nummer ziehen', pass: !(await text(page)).includes('Früher dran, wenn etwas frei wird') });

    await page.goto(`${BASE}/staff-management`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Tarif wechseln/).waitFor({ timeout: 30000 });
    rows.push({ name: 'Gratis: Team auf 1 Person begrenzt', pass: true });
  } finally {
    await setTrialEnd(page, fx.shopId, null).catch(() => {});
  }
  rows.push({ name: 'Betrieb: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
