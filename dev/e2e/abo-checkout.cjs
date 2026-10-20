// Abo-Abschluss im Stripe-Testmodus bis zur Bezahlseite: "Mein Tarif" -> Stripe Checkout.
//  - Produkt, Preis, übernommene Testphase, Knopf "Kostenpflichtig abonnieren"
//  - Steuer und SEPA zeigen, ob die Einstellungen im Stripe-Dashboard stimmen
// Bezahlt wird hier nicht: Stripe Checkout hat einen Bot-Schutz; den Testkauf mit 4242 4242 4242 4242 von Hand machen.
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://q-me.spielmacherei.de, auf dem Server
// ein Stripe-TESTschlüssel) und Testdaten (python dev/fixtures.py anlegen). Im Stripe-Testkonto bleibt ein
// Testkunde zurück; python dev/fixtures.py loeschen entfernt den Testladen.
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



run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser, { viewport: { width: 1280, height: 1000 } });
  const errors = collectErrors(page);
  await signIn(page, fx);
  await page.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Kunden diesen Monat').waitFor({ timeout: 30000 });

  // Laden ist die dritte Karte; ihr Knopf heißt "Weiter zur Bezahlung"
  const ladenCard = page.locator('article', { has: page.getByRole('heading', { name: 'Laden', exact: true }) });
  await ladenCard.getByRole('button', { name: /Weiter zur Bezahlung/ }).click();
  const outcome = await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }).then(() => 'stripe'),
    page.locator('[data-sonner-toast]').first().waitFor({ timeout: 30000 }).then(() => 'toast'),
  ]).catch(() => 'nichts');
  if (outcome !== 'stripe') {
    const toast = await page.locator('[data-sonner-toast]').first().innerText().catch(() => '');
    rows.push({ name: 'Weiter zu Stripe Checkout', pass: false, detail: toast || outcome });
    await shot(page, 'abo-fehler');
    await browser.close();
    return report(rows);
  }
  rows.push({ name: 'Weiter zu Stripe Checkout', pass: true });

  // Nur ansehen, nicht bezahlen: Stripe Checkout hat einen Bot-Schutz (hCaptcha), der Testkauf bleibt Handarbeit
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByText(/Dranzeit Laden/).first().waitFor({ timeout: 30000 });
  const t = await page.evaluate(() => document.body.innerText);
  rows.push({ name: 'Produkt und Preis: Dranzeit Laden, 39,00 €', pass: /Dranzeit Laden/.test(t) && /39,00\s*€/.test(t) });
  const line = (re) => ((t.match(re) || [''])[0]).replace(/\s+/g, ' ').trim();
  rows.push({ name: 'Restliche Testphase übernommen', pass: /Tage kostenlos/.test(t), detail: line(/\d+ Tage kostenlos[^\n]*\n[^\n]*/) });
  rows.push({ name: 'Rechtlich richtiger Knopf "Kostenpflichtig abonnieren"', pass: /Kostenpflichtig abonnieren/.test(t) });
  const steuer = line(/Steuer[^\n]*\n?[^\n]*/);
  rows.push({ name: 'Steuer wird berechnet (Registrierung Deutschland in Stripe)', pass: !/0,00\s*€/.test(steuer), detail: steuer });
  rows.push({ name: 'SEPA-Lastschrift angeboten', pass: /SEPA|Lastschrift/i.test(t) });
  await shot(page, 'abo-checkout');
  rows.push({ name: 'keine JavaScript-Fehler in der App', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
