// Telefon-Assistent weitersagen: Kasten auf /telefon-assistent, Zeile auf dem QR-Plakat, Hinweis auf der Ladenseite, Preis auf /preise.
// Anmeldung, Inhaber und Backend sind nachgebildet: kein Testkonto nötig, es ändert sich nichts.
// Braucht: Entwicklungsserver (npm run dev), weil Vite die Seiten als einzelne Module ausliefert. Regel im Backend: backend/tests/test_telefon_eingang.py.
const path = require('path');
const { BASE, OUT, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const LADEN = { id: 'laden-test', name: 'Studio Kamm', phone: '030 555 555', owner: 'x', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin' };
const AKTIV = {
  freigegeben: true, aktiv: true, weitersagen: true, status: 'aktiv', anschluss: '+49305555555', vorschlag: '+49305555555', zielnummer: '+493082694105',
  eigeneNummer: false, minuten: 3, freiminuten: 30,
};
const GOOGLE = 'Geht bei uns gerade niemand ans Telefon, nimmt unser KI-Assistent deinen Anruf an.';
const HINWEIS = 'Geht keiner ran, nimmt ein KI-Assistent ab und bucht dir einen Termin.';
const ZEILE = 'Geht keiner ran, nimmt unser KI-Assistent ab und bucht deinen Termin.';

/** Läden und Ladendaten stehen in Firestore: nur diese Seiten bekommen sie nachgebildet */
const inhaberSeite = (page, datei) =>
  page.route(`**/src/pages/${datei}*`, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      /import \{ getShopsByOwnerId \} from "[^"]+";/,
      `const getShopsByOwnerId = async () => [${JSON.stringify(LADEN)}];`,
    );
    return route.fulfill({ response: res, body });
  });

/** Gedruckt hat das Blatt feste Maße und schneidet ab, was nicht draufpasst. A4 hoch mit 12 mm Rand sind 703 × 994 Pixel. */
const druckUeberstand = async (page) => {
  const vorher = page.viewportSize();
  await page.setViewportSize({ width: 703, height: 994 });
  await page.emulateMedia({ media: 'print' });
  const zuViel = await page.locator('article').evaluate((el) => Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth));
  await page.emulateMedia({ media: null });
  await page.setViewportSize(vorher);
  return zuViel;
};

/** Seiten im echten Druck: A4 nach den Angaben der Seite (@page) */
const druckSeiten = async (page, name) => {
  const pdf = await page.pdf({ path: path.join(OUT, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
};

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const passtBeimDrucken = async (name, page, datei) => {
    const zuViel = await druckUeberstand(page);
    check(`${name}: passt beim Drucken aufs Blatt`, zuViel <= 1, `${zuViel} px zu viel`);
    const seiten = await druckSeiten(page, datei);
    check(`${name}: genau eine Seite im PDF`, seiten === 1, `${seiten} Seiten`);
  };

  // --- Ladenseite: öffentlich, ohne Anmeldung ---
  const kunde = await newPage(browser);
  const kundeFehler = collectErrors(kunde);
  let hinweis = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ annahme: true }) });
  await kunde.route(`**/routes/telefon-hinweis/${LADEN.id}`, (route) => hinweis(route));
  await kunde.route('**/routes/verzeichnis/laden/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await kunde.route('**/src/pages/ShopDetails.tsx*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      /import \{ useShopDetails \} from "[^"]+";/,
      `const useShopDetails = () => ({ shop: ${JSON.stringify(LADEN)}, services: [], staff: [], loading: false, loadError: null });`,
    );
    return route.fulfill({ response: res, body });
  });
  const ladenseite = async (zusatz = '') => {
    await kunde.goto(`${BASE}/shop-details?shopId=${LADEN.id}${zusatz}`, { waitUntil: 'domcontentloaded' });
    await kunde.getByRole('link', { name: LADEN.phone }).waitFor({ timeout: 60000 });
    await kunde.waitForTimeout(500);
  };
  await ladenseite();
  check('Ladenseite: Hinweis unter der Nummer, wenn der Assistent abnimmt', await kunde.getByText(HINWEIS).isVisible());
  await shot(kunde, 'telefon-ladenseite');
  await ladenseite('&sprache=tr');
  check('Ladenseite auf Türkisch: sagt, dass er Deutsch spricht', await kunde.getByText('Almanca').isVisible());
  await ladenseite('&sprache=ar');
  check('Ladenseite auf Arabisch: sagt, dass er Deutsch spricht', await kunde.getByText('باللغة الألمانية').isVisible());
  await shot(kunde, 'telefon-ladenseite-ar');
  hinweis = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ annahme: false }) });
  await ladenseite('&sprache=de');
  check('Ladenseite: kein Hinweis, wenn der Assistent nicht abnimmt', !(await kunde.getByText(HINWEIS).isVisible()));
  hinweis = (route) => route.abort();
  await ladenseite();
  check('Ladenseite: kein Hinweis, wenn das Backend nicht antwortet', !(await kunde.getByText(HINWEIS).isVisible()));

  // --- Preise ---
  await kunde.goto(`${BASE}/preise`, { waitUntil: 'domcontentloaded' });
  const geplant = kunde.getByText('Geplant: 29 € netto im Monat mit 100 Minuten, danach 0,20 € pro Minute. Freiwilliger Zusatz ab Solo.');
  await geplant.waitFor({ timeout: 60000 });
  check('Preise: nennt den geplanten Preis', await geplant.isVisible());
  check('Preise: bleibt im Testbetrieb auf Anfrage', await kunde.getByText('Im Testbetrieb auf Anfrage:').isVisible());
  check('Ladenseite und Preise: keine JavaScript-Fehler', kundeFehler.length === 0, kundeFehler.join(' | '));

  // --- Inhaber ---
  const page = await newPage(browser, { viewport: { width: 1100, height: 1400 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = collectErrors(page);
  let stand = AKTIV;
  await mockAuth(page);
  await inhaberSeite(page, 'TelefonAssistent.tsx');
  await inhaberSeite(page, 'Plakat.tsx');
  await page.route(`**/routes/telefon-einrichtung/${LADEN.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stand) }),
  );
  await signInFake(page);

  const einrichtung = async () => {
    await page.goto(`${BASE}/telefon-assistent?sprache=de`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Probeanruf/ }).waitFor({ timeout: 60000 });
  };
  const kasten = () => page.getByRole('heading', { name: /Jetzt weitersagen/ });

  await einrichtung();
  check('Kasten: erscheint, sobald der Assistent abnimmt', await kasten().isVisible());
  check('Kasten: Google-Text steht da', await page.getByText(GOOGLE).isVisible());
  check('Kasten: Nummer so geschrieben wie in den Ladendaten', await page.getByText(`Ruf uns an: ${LADEN.phone}.`).isVisible());
  check('Kasten: warnt vor der Nummer des Assistenten', await page.getByText('nie die Nummer des Assistenten').isVisible());
  const ersterKnopf = page.locator('h3', { hasText: 'Google-Eintrag' }).locator('..').getByRole('button', { name: 'Kopieren' });
  await ersterKnopf.click();
  const kopiert = await page.evaluate(() => navigator.clipboard.readText());
  check('Kasten: Kopieren nimmt den ganzen Text', kopiert.startsWith(GOOGLE) && kopiert.endsWith('Adresse und Preisen.'), kopiert);
  check('Kasten: führt zum Plakat dieses Ladens', (await page.getByRole('link', { name: 'Plakat mit Telefon-Hinweis drucken' }).getAttribute('href')) === `/plakat?shopId=${LADEN.id}`);
  check('Kasten: nennt die Mailbox', await page.getByText('Läuft ein Anrufbeantworter oder eine Mailbox').isVisible());
  check('Handy: Code auch für ausgeschaltetes Handy', await page.getByText('**62*03082694105#').isVisible());
  check('Handy: Ausschalten nennt ihn mit', await page.getByText('##62#').isVisible());
  await shot(page, 'telefon-kasten');
  await page.getByRole('button', { name: 'Festnetz Telekom' }).click();
  check('Festnetz: kein Code für ausgeschaltetes Handy', (await page.getByText('*62*').count()) === 0);

  stand = { ...AKTIV, status: 'wartet', weitersagen: false };
  await einrichtung();
  check('Kasten: nicht vor dem Probeanruf', !(await kasten().isVisible()));
  stand = { ...AKTIV, minuten: 30, weitersagen: false };
  await einrichtung();
  check('Kasten: nicht, wenn die Minuten verbraucht sind', !(await kasten().isVisible()));
  stand = { ...AKTIV, anschluss: '+49170000000', weitersagen: true };
  await einrichtung();
  check('Kasten: nennt die umgeleitete Nummer, wenn in den Ladendaten eine andere steht', await page.getByText('Ruf uns an: 0170000000.').isVisible());

  // --- Plakat ---
  const plakat = async (zusatz = '') => {
    await page.goto(`${BASE}/plakat?shopId=${LADEN.id}${zusatz}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Drucken|Print|Yazdır|طباعة/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
  };
  stand = AKTIV;
  await plakat('&sprache=de');
  const haken = page.getByLabel('Telefon-Hinweis aufs Plakat');
  check('Plakat: Zeile steht da', await page.getByText(ZEILE).isVisible());
  check('Plakat: Nummer des Ladens steht da', await page.locator('article').getByText(LADEN.phone).isVisible());
  await shot(page, 'telefon-plakat');
  await passtBeimDrucken('Plakat mit Zeile', page, 'telefon-plakat');
  await page.emulateMedia({ media: 'print' });
  check('Plakat: Haken wird nicht mitgedruckt', !(await haken.isVisible()));
  await page.emulateMedia({ media: null });
  await page.setViewportSize({ width: 390, height: 844 });
  check('Plakat: Zeile bleibt in der Vorschau am Handy sichtbar', await page.getByText('localhost').or(page.getByText('dranzeit.de')).first().isVisible());
  await shot(page, 'telefon-plakat-handy');
  await page.setViewportSize({ width: 1100, height: 1400 });
  await haken.uncheck();
  check('Plakat: Zeile abwählbar', !(await page.getByText(ZEILE).isVisible()));
  await passtBeimDrucken('Plakat ohne Zeile', page, 'telefon-plakat-ohne');
  for (const sprache of ['en', 'tr', 'ar']) {
    await plakat(`&sprache=${sprache}`);
    await passtBeimDrucken(`Plakat auf ${sprache}`, page, `telefon-plakat-${sprache}`);
    await shot(page, `telefon-plakat-${sprache}`);
  }
  stand = { ...AKTIV, weitersagen: false };
  await plakat('&sprache=de');
  check('Plakat: ohne Zeile, wenn der Assistent nicht abnimmt', !(await page.getByText(ZEILE).isVisible()));
  check('Plakat: dann auch kein Haken', !(await page.getByLabel('Telefon-Hinweis aufs Plakat').isVisible()));

  check('Inhaber-Seiten: keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
