// Suche „Läden finden“ (/shop-map) auf der echten Seite, nur lesen: Was/Wo mit „Oft gesucht“, Tegel + Herrenschnitt
// findet Halit (Leistungsgruppe), freie Zeit wählt im Buchen die Uhrzeit vor (nicht zu Ende gebucht), Liste/Karte am
// Handy, Ortsseite mit Knopf zur Karte, Hilfe mit App-Menü. Am Rechner (1280) und am Handy (390).
// Standard: QME_URL=https://dranzeit.de (bucht nichts, legt nichts an).
const { launch, newPage, shot, collectErrors, report, run } = require('./lib.cjs');

const BASE = (process.env.QME_URL || 'https://dranzeit.de').replace(/\/$/, '');
const LADEN = process.env.QME_SUCHE_LADEN || "Halit's Barber Shop";

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const durchlauf = async (browser, rows, groesse) => {
  const handy = groesse === 'Handy';
  const pruefe = (name, pass, detail = '') => rows.push({ name: `${groesse}: ${name}`, pass: Boolean(pass), detail: String(detail ?? '') });
  const page = await newPage(browser, handy ? {} : { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);

  await page.goto(`${BASE}/shop-map`, { waitUntil: 'domcontentloaded' });
  const geladen = await page.getByText(LADEN).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  pruefe('Suche lädt, Laden in der Liste', geladen);
  pruefe('kein Überlauf', !(await ueberlauf(page)));

  // Was? ohne Eingabe: Gruppen unter „Oft gesucht“
  const offen = page.getByRole('button', { name: 'Suche öffnen' });
  if (handy && (await offen.count()) && (await offen.first().isVisible())) await offen.first().click();
  const was = page.getByPlaceholder('Leistung oder Laden, z. B. Herrenschnitt').first();
  await was.click();
  pruefe('„Oft gesucht“ mit Gruppen', await page.getByText('Oft gesucht').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  await was.fill('Herrenschnitt');
  await page.waitForTimeout(800);
  const vorschlag = page.getByRole('option', { name: /Herrenhaarschnitt|Herrenschnitt/ }).first();
  if (await vorschlag.count()) await vorschlag.click();
  const wo = page.getByPlaceholder('Bezirk, Ortsteil oder PLZ').first();
  await wo.click();
  await wo.fill('Tegel');
  await page.waitForTimeout(1500);
  const ort = page.getByRole('option', { name: /Tegel/ }).first();
  if (await ort.count()) await ort.click();
  else await wo.press('Enter');
  const suchen = page.getByRole('button', { name: /^(Suchen|Läden suchen)$/ });
  if ((await suchen.count()) && (await suchen.first().isVisible())) await suchen.first().click();
  await page.waitForTimeout(2500);
  pruefe('Tegel + Herrenschnitt findet den Laden (Maschinenschnitt)', await page.getByText(LADEN).first().isVisible().catch(() => false), page.url().replace(BASE, ''));
  await shot(page, `suche-live-${groesse.toLowerCase()}-treffer`);

  // Handy: Karte und Liste umschalten
  if (handy) {
    const karte = page.getByRole('button', { name: 'Karte', exact: true }).first();
    if (await karte.count()) {
      await karte.click();
      await page.waitForTimeout(1500);
      pruefe('Karte am Handy', await page.locator('.leaflet-container, [aria-label="Kartenausschnitt"]').first().isVisible().catch(() => false));
      await shot(page, 'suche-live-handy-karte');
      const liste = page.getByRole('button', { name: 'Liste', exact: true }).first();
      if (await liste.count()) await liste.click();
    } else {
      pruefe('Knopf „Karte“ am Handy', false);
    }
  }

  // Freie Zeit anklicken: Buchen öffnet mit der Zeit (nicht buchen)
  const zeit = page.locator('a[href*="book-appointment"]').filter({ hasText: /\d{1,2}:\d{2}/ }).first();
  if (await zeit.count()) {
    const text = (await zeit.innerText()).trim();
    await zeit.click();
    await page.waitForURL(/book-appointment/, { timeout: 15000 }).catch(() => {});
    pruefe('Freie Zeit öffnet Buchen mit Uhrzeit', /book-appointment/.test(page.url()) && /(time|start|zeit)=/i.test(page.url()), `${text} → ${page.url().replace(BASE, '')}`);
    await page.waitForTimeout(2000);
    await shot(page, `suche-live-${groesse.toLowerCase()}-buchen`);
  } else {
    pruefe('Freie Zeiten in der Trefferkarte', false, 'keine Uhrzeit-Links (Laden zu?)');
  }

  // Ortsseite: Knopf zur Karte
  await page.goto(`${BASE}/friseur/berlin`, { waitUntil: 'domcontentloaded' });
  const ortKnopf = page.getByRole('link', { name: /In Berlin auf der Karte suchen/ }).first();
  const ortDa = await ortKnopf.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  pruefe('Ortsseite: „In Berlin auf der Karte suchen“', ortDa);
  if (ortDa) {
    await ortKnopf.click();
    await page.waitForURL(/shop-map/, { timeout: 15000 }).catch(() => {});
    pruefe('… führt zur Suche', /shop-map/.test(page.url()), page.url().replace(BASE, ''));
  }

  // Hilfe mit App-Menü
  await page.goto(`${BASE}/hilfe`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // Auf den Backend-Seiten ist der Menüknopf ein <summary aria-label="Menü öffnen"> (navigation.json)
  if (handy) {
    const knopf = page.locator('[aria-label="Menü öffnen"]:visible').first();
    if (await knopf.count()) await knopf.click();
    await page.waitForTimeout(500);
  }
  const menue = page.getByRole('link', { name: 'Läden finden' }).filter({ visible: true });
  pruefe('Hilfe: App-Menü mit „Läden finden“', (await menue.count()) >= 1);
  pruefe('Hilfe: kein Überlauf', !(await ueberlauf(page)));
  await shot(page, `suche-live-${groesse.toLowerCase()}-hilfe`);

  const echteFehler = errors.filter((e) => !/401|Failed to load resource|EventSource/i.test(e));
  pruefe('keine JavaScript-Fehler', echteFehler.length === 0, echteFehler.join(' | ').slice(0, 300));
  await page.close();
};

run(async () => {
  const browser = await launch();
  const rows = [];
  await durchlauf(browser, rows, 'Rechner');
  await durchlauf(browser, rows, 'Handy');
  await browser.close();
  return report(rows);
});
