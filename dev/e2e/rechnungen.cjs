// Rechnungen unter "Mein Tarif" im Testladen: Liste, Status, Beträge, Download von PDF und E-Rechnung.
//  - Die Rechnungsliste ist hier nachgebildet (page.route), damit alle Fälle zu sehen sind: bezahlt, offen,
//    Testphase (0 €, ohne E-Rechnung), storniert, dazu ein Fehler von Stripe.
//    QME_RECHNUNGEN=echt fragt stattdessen das echte Backend (Liste lädt, kein Fehler).
//  - Der Abschnitt erscheint erst, wenn der Laden einen Stripe-Kunden hat. Fehlt der, legt der Test ihn an wie
//    "Weiter zur Bezahlung" (Stripe-Testmodus, ohne zu bezahlen).
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://dranzeit.de, auf dem Server ein
// Stripe-TESTschlüssel) und Testdaten (python dev/fixtures.py anlegen).
const { BASE, launch, newPage, shot, collectErrors, fixture, report, run } = require('./lib.cjs');

const ECHT = process.env.QME_RECHNUNGEN === 'echt';

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

/** Stripe-Kunde für den Testladen anlegen (wie "Weiter zur Bezahlung", ohne zu Stripe zu wechseln) */
const ensureCustomer = (page, shopId) =>
  page.evaluate(async (shopId) => {
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    const token = await firebaseAuth.currentUser.getIdToken();
    const res = await fetch('/routes/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shop_id: shopId, plan: 'laden', interval: 'monat' }),
    });
    return `${res.status} ${(await res.text()).slice(0, 120)}`;
  }, shopId);

const row = (id, number, status, statusText, net, tax, extra = {}) => ({
  id, number, date: '2026-10-20', periodStart: '2026-10-20', periodEnd: '2026-11-20', net, tax, total: net + tax,
  currency: 'eur', status, statusText, pdf: true, einvoice: status === 'paid' || status === 'open', einvoiceMissing: null, ...extra,
});
const INVOICES = [
  row('in_2', 'DZ-0002', 'open', 'offen', 59000, 11210, { periodEnd: '2027-10-20' }),
  row('in_1', 'DZ-0001', 'paid', 'bezahlt', 3900, 741),
  row('in_0', 'DZ-0000', 'paid', 'bezahlt', 0, 0, { einvoice: false, einvoiceMissing: 'Rechnung über 0 € (Testphase)' }),
  row('in_9', 'DZ-0003', 'void', 'storniert', 3900, 741),
];

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];

  for (const [label, viewport] of [['desktop', { width: 1280, height: 1000 }], ['handy', { width: 390, height: 844 }]]) {
    const page = await newPage(browser, { viewport, acceptDownloads: true });
    const errors = collectErrors(page);
    let listFails = false;
    if (!ECHT) {
      await page.route('**/routes/invoices/list*', (route) =>
        listFails
          ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'Stripe meldet: Testfehler' }) })
          : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: INVOICES }) }),
      );
      await page.route('**/routes/invoices/pdf*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Dranzeit-Rechnung-DZ-0002.pdf"' }, body: '%PDF-1.4 Test' }),
      );
      await page.route('**/routes/invoices/xrechnung*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/xml', headers: { 'Content-Disposition': 'attachment; filename="Dranzeit-Rechnung-DZ-0002-XRechnung.xml"' }, body: '<rsm:CrossIndustryInvoice/>' }),
      );
    }
    await signIn(page, fx);
    await page.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Kunden diesen Monat').waitFor({ timeout: 30000 });
    const heading = page.getByRole('heading', { name: 'Rechnungen', exact: true });
    if (!(await heading.isVisible().catch(() => false))) {
      const created = await ensureCustomer(page, fx.shopId);
      console.log(`Stripe-Kunde für den Testladen angelegt: ${created}`);
    }
    const shown = await heading.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    rows.push({ name: `${label}: Abschnitt Rechnungen sichtbar`, pass: shown });
    if (!shown) {
      await shot(page, `rechnungen-${label}-fehlt`);
      await page.close();
      continue;
    }
    const section = page.locator('section', { has: heading });

    if (ECHT) {
      await page.waitForFunction(() => !document.body.innerText.includes('Rechnungen werden geladen'), null, { timeout: 30000 });
      const t = await section.innerText();
      rows.push({ name: `${label}: echte Liste lädt ohne Fehler`, pass: !/Nochmal versuchen/.test(t), detail: t.replace(/\s+/g, ' ').slice(0, 160) });
      await shot(page, `rechnungen-echt-${label}`);
      rows.push({ name: `${label}: keine JavaScript-Fehler`, pass: errors.length === 0, detail: errors.join(' | ') });
      await page.close();
      continue;
    }

    await section.getByText('DZ-0001').waitFor({ timeout: 30000 });
    const t = await section.innerText();
    rows.push({ name: `${label}: alle 4 Rechnungen mit Nummer`, pass: ['DZ-0000', 'DZ-0001', 'DZ-0002', 'DZ-0003'].every((n) => t.includes(n)) });
    rows.push({ name: `${label}: Status bezahlt, offen, storniert`, pass: /bezahlt/.test(t) && /offen/.test(t) && /storniert/.test(t) });
    rows.push({ name: `${label}: Beträge netto + USt. = brutto`, pass: /39,00\s€ netto \+ 7,41\s€ USt\. = 46,41\s€/.test(t) && /702,10\s€/.test(t), detail: t.match(/[\d.,]+\s€ netto[^\n]*/)?.[0] });
    rows.push({ name: `${label}: Datum und Zeitraum`, pass: /vom 20\.10\.2026 · Zeitraum 20\.10\.2026 bis 20\.11\.2026/.test(t) });
    rows.push({ name: `${label}: PDF bei allen 4, E-Rechnung nur bei 2`, pass: (await section.getByRole('button', { name: 'PDF' }).count()) === 4 && (await section.getByRole('button', { name: 'E-Rechnung' }).count()) === 2 });
    rows.push({ name: `${label}: ohne Überlauf`, pass: (await overflow(page)) <= 0, detail: String(await overflow(page)) });
    await section.scrollIntoViewIfNeeded();
    await shot(page, `rechnungen-${label}`);

    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), section.getByRole('button', { name: 'PDF' }).first().click()]);
    rows.push({ name: `${label}: PDF wird heruntergeladen`, pass: pdf.suggestedFilename() === 'Dranzeit-Rechnung-DZ-0002.pdf', detail: pdf.suggestedFilename() });
    const [xml] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), section.getByRole('button', { name: 'E-Rechnung' }).first().click()]);
    rows.push({ name: `${label}: E-Rechnung wird heruntergeladen`, pass: xml.suggestedFilename() === 'Dranzeit-Rechnung-DZ-0002-XRechnung.xml', detail: xml.suggestedFilename() });

    // Fehler von Stripe: Meldung und neuer Versuch
    listFails = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const retry = section.getByRole('button', { name: 'Nochmal versuchen' });
    const failShown = await retry.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    rows.push({ name: `${label}: Fehler wird verständlich gemeldet`, pass: failShown && /Stripe meldet: Testfehler/.test(await section.innerText()) });
    listFails = false;
    if (failShown) await retry.click();
    rows.push({ name: `${label}: nach neuem Versuch wieder da`, pass: await section.getByText('DZ-0001').waitFor({ timeout: 15000 }).then(() => true).catch(() => false) });

    rows.push({ name: `${label}: keine JavaScript-Fehler`, pass: errors.length === 0, detail: errors.join(' | ') });
    await page.close();
  }
  await browser.close();
  return report(rows);
});
