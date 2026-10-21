// Tarife im Testladen: Preisseite, AGB, "Mein Tarif" und die Sperren im Gratis-Tarif (utils/plans.ts).
//  - Preisseite: 4 Tarife, Brutto-Hinweis, keine Provision; AGB mit Auftragsverarbeitung
//  - Testphase: "Mein Tarif" zeigt Testphase und Verbrauch (Testladen aus fixtures.py)
//  - Gratis: kein "Früher dran", keine Online-Termine, Team auf 1 Person begrenzt – in einem Wegwerf-Laden, dessen
//    Testphase schon beim Anlegen vorbei ist (lib.cjs tempShop). Die Testphase ändern darf nur das Backend
//    (firestore.rules), also auch kein Test mehr am Testladen.
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Löscht den Wegwerf-Laden samt Konto.
const { BASE, launch, newPage, shot, collectErrors, fixture, tempShop, removeTempShop, report, run } = require('./lib.cjs');

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
  await page.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Kunden diesen Monat').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  let t = await text(page);
  rows.push({ name: 'Mein Tarif: Testphase sichtbar', pass: /Testphase mit allen Funktionen/.test(t), detail: t.slice(0, 200) });
  await shot(page, 'tarife-mein-tarif-test');

  // Gratis: eigener Laden, Testphase seit gestern vorbei
  const gratis = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  errors.push(...collectErrors(gratis));
  const g = await tempShop(gratis, 'Testladen Gratis (wird gleich gelöscht)', { trialEndsAt: new Date(Date.now() - 86400000) });
  try {
    await gratis.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
    await gratis.getByText('Kunden diesen Monat').waitFor({ timeout: 30000 });
    await gratis.waitForTimeout(1500);
    t = await text(gratis);
    rows.push({ name: 'Mein Tarif: nach der Testphase Gratis', pass: /Gratis-Tarif\./.test(t) && /\/ 100/.test(t), detail: t.slice(0, 200) });
    await shot(gratis, 'tarife-mein-tarif-gratis');

    await gratis.goto(`${BASE}/book-appointment?shopId=${g.shopId}&fromMarketplace=true`, { waitUntil: 'domcontentloaded' });
    await gratis.getByText(/nimmt online keine festen Termine an/).waitFor({ timeout: 30000 });
    rows.push({ name: 'Gratis: keine Online-Termine, Hinweis auf Nummer ziehen', pass: true });

    await gratis.goto(`${BASE}/public-join-queue?shopId=${g.shopId}`, { waitUntil: 'domcontentloaded' });
    await gratis.locator('section button[aria-pressed]').first().click({ timeout: 60000 });
    await gratis.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
    await gratis.waitForFunction(() => /\d{2}:\d{2}|kein Platz/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
    rows.push({ name: 'Gratis: kein "Früher dran" beim Nummer ziehen', pass: !(await text(gratis)).includes('Früher dran, wenn etwas frei wird') });

    await gratis.goto(`${BASE}/staff-management`, { waitUntil: 'domcontentloaded' });
    await gratis.getByText(/Tarif wechseln/).waitFor({ timeout: 30000 });
    rows.push({ name: 'Gratis: Team auf 1 Person begrenzt', pass: true });
  } finally {
    await removeTempShop(gratis, g).catch((e) => console.log('Wegwerf-Laden nicht gelöscht:', g.shopId, String(e).slice(0, 120)));
  }
  rows.push({ name: 'Betrieb: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
