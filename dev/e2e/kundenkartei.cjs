// Kundenkartei (Seite „Kunden“, pages/Kunden.tsx und pages/Kunde.tsx): Liste mit Suche, Gruppen und Sortierung,
// Kundenseite mit Kennzahlen, Notiz fürs Team, Verlauf mit Preis und Notiz je Besuch; Gratis-Tarif nur mit Hinweis.
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Braucht: Entwicklungsserver (npm run dev), Adresse über QME_URL.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (tageZurueck, stunde = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - tageZurueck);
  d.setHours(stunde, 0, 0, 0);
  return { __zeit: d.toISOString() };
};
const zahlen = (extra) => ({
  besuche: 0, umsatz: 0, abgesagt: 0, nichtGekommen: 0, zuletzt: null, erster: null, naechster: null,
  abstandTage: null, lieblingsLeistung: '', lieblingsPerson: '', ...extra,
});
const LADEN = { id: 'laden-test', name: 'Salon Test', owner: 'betreiber-test', plan: 'solo', billing: { plan: 'solo', status: 'active' } };
const KUNDEN = [
  { id: 'k1', shopId: 'laden-test', name: 'Jürgen Müller', email: '', phone: '+491701234567', source: 'telefon', createdAt: zeit(300), hatNotiz: true,
    kennzahlen: zahlen({ besuche: 6, umsatz: 240, zuletzt: zeit(70), erster: zeit(300), abstandTage: 40, lieblingsLeistung: 'Herrenschnitt', lieblingsPerson: 'Kim' }) },
  { id: 'k2', shopId: 'laden-test', name: 'Kara Krause', email: 'kara@example.com', userId: 'konto', createdAt: zeit(100),
    kennzahlen: zahlen({ besuche: 3, umsatz: 195, zuletzt: zeit(5), erster: zeit(100), abstandTage: 30, naechster: zeit(-7) }) },
  { id: 'k3', shopId: 'laden-test', name: 'Sam Neu', email: '', phone: '+491515550000', source: 'online', createdAt: zeit(3),
    kennzahlen: zahlen({}) },
];
const KARTE = {
  kartei: true,
  kunde: { ...KUNDEN[0], notiz: 'mag es kurz an den Seiten', notizGeaendert: zeit(20) },
  kennzahlen: KUNDEN[0].kennzahlen,
  termine: [
    { id: 't9', startTime: zeit(-14), status: 'scheduled', type: 'booked', source: 'telefon', leistung: 'Herrenschnitt', person: 'Kim', preis: 40, noShow: false, zugeordnet: false },
    { id: 't3', startTime: zeit(70), status: 'completed', type: 'queue', leistung: 'Herrenschnitt', person: 'Kim', preis: 40, noShow: false, zugeordnet: true, notiz: 'Maschine 3 mm, oben 4 cm' },
    { id: 't2', startTime: zeit(90), status: 'cancelled', type: 'booked', leistung: 'Bart', person: 'Ali', preis: 15, noShow: true, zugeordnet: false },
    { id: 't1', startTime: zeit(110), status: 'completed', type: 'booked', leistung: 'Farbe', person: 'Kim', preis: 60, noShow: false, zugeordnet: false },
  ],
};

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const page = await newPage(browser, { viewport: { width: 420, height: 900 } });
  const errors = collectErrors(page);
  await mockAuth(page);

  let laden = { ...LADEN };
  const gesendet = [];
  const json = (route, status, daten) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(daten) });
  await page.route('**/routes/konto/profil', (route) => json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } }));
  await page.route('**/routes/team/ich/laeden', (route) => json(route, 200, { laeden: [laden] }));
  await page.route(/\/routes\/team\/laeden\/laden-test(\?.*)?$/, (route) => json(route, 200, { laden }));
  await page.route('**/routes/team/laeden/laden-test/kartei**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const kartei = laden.plan !== 'gratis';
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      gesendet.push({ p, body });
      if (p.endsWith('/besuch/t1')) return json(route, 200, { notiz: { text: body.notiz, geaendert: zeit(0) } });
      return json(route, 200, { kunde: { ...KARTE.kunde, ...body.aenderung, notizGeaendert: zeit(0) } });
    }
    if (p.endsWith('/kartei')) {
      return json(route, 200, { kartei, kunden: kartei ? KUNDEN : KUNDEN.map(({ kennzahlen, hatNotiz, ...k }) => k) });
    }
    if (p.endsWith('/kartei/k1')) {
      if (kartei) return json(route, 200, KARTE);
      const { notiz, notizGeaendert, ...kunde } = KARTE.kunde;
      return json(route, 200, { kartei, kunde, termine: KARTE.termine.map(({ notiz: _, ...t }) => t) });
    }
    return json(route, 404, { detail: 'Diesen Kunden gibt es nicht mehr.' });
  });
  await signInFake(page);

  // --- Liste ---
  await page.goto(`${BASE}/kunden`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Kunden', level: 1 }).waitFor({ timeout: 30000 });
  await page.getByText('Jürgen Müller').waitFor({ timeout: 15000 });
  check('Menüpunkt Kunden', (await page.getByRole('link', { name: 'Kunden', exact: true }).count()) >= 1 || (await page.getByRole('button', { name: 'Menü öffnen' }).count()) === 1);
  const namen = async () => (await page.locator('main ul > li a, ul > li > a[href^="/kunden/"]').allInnerTexts()).map((t) => t.split('\n')[0]);
  check('Zuletzt da zuerst', (await namen()).join(',') === 'Kara Krause,Jürgen Müller,Sam Neu', (await namen()).join(','));
  check('Gruppen mit Zahlen', await page.getByRole('radio', { name: /Stammkunden 2/ }).isVisible() && await page.getByRole('radio', { name: /Lange nicht da 1/ }).isVisible() && await page.getByRole('radio', { name: /Neu 1/ }).isVisible());
  check('Zeile mit Besuchen und Umsatz', await page.getByText(/6 Besuche · 240/).isVisible());
  check('Nächster Termin bei Kara', await page.getByText(/Nächster Termin:/).isVisible());
  await shot(page, 'kundenkartei-liste');

  await page.getByRole('radio', { name: /Lange nicht da/ }).click();
  check('Gruppe Lange nicht da', (await namen()).join(',') === 'Jürgen Müller', (await namen()).join(','));
  await page.getByRole('radio', { name: /Alle/ }).click();
  await page.getByPlaceholder('Name, Telefon oder E-Mail').fill('0170 123');
  check('Suche nach Telefon in anderer Schreibweise', (await namen()).join(',') === 'Jürgen Müller', (await namen()).join(','));
  await page.getByPlaceholder('Name, Telefon oder E-Mail').fill('muller');
  check('Suche ohne Umlaut', (await namen()).join(',') === 'Jürgen Müller');
  await page.getByPlaceholder('Name, Telefon oder E-Mail').fill('');
  await page.locator('select').selectOption('umsatz');
  check('Nach Umsatz', (await namen()).join(',') === 'Jürgen Müller,Kara Krause,Sam Neu', (await namen()).join(','));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Liste am Handy ohne Überlauf', overflow <= 0, `${overflow}px`);

  // --- Kundenseite ---
  await page.getByText('Jürgen Müller').click();
  await page.getByRole('heading', { name: 'Jürgen Müller', level: 1 }).waitFor({ timeout: 15000 });
  check('Adresse der Kundenseite', page.url().includes('/kunden/k1'), page.url());
  check('Kennzahlen', await page.getByText('Besuche', { exact: true }).isVisible() && await page.getByText('alle 6 Wochen').isVisible() && await page.getByText('laut Preisliste').isVisible());
  check('Meist Leistung bei Person', await page.getByText('Meist Herrenschnitt bei Kim.').isVisible());
  check('Notiz fürs Team geladen', (await page.locator('textarea').first().inputValue()) === 'mag es kurz an den Seiten');
  check('Hinweis Gesundheitsdaten', await page.getByText(/keine Angaben zur Gesundheit/).isVisible());
  check('Kommender Termin getrennt', await page.getByRole('heading', { name: 'Kommende Termine' }).isVisible());
  const verlauf = page.locator('section[aria-labelledby="verlauf"] li');
  const texte = await verlauf.allInnerTexts();
  check('Verlauf: drei Termine, neueste zuerst', texte.length === 3 && texte[0].includes('Maschine 3 mm'), JSON.stringify(texte));
  check('Preis am Besuch', texte[0].includes('40'), texte[0]);
  check('Nicht gekommen ohne Notiz-Knopf', texte[1].includes('Nicht gekommen') && !texte[1].includes('Notiz zum Besuch'), texte[1]);
  await shot(page, 'kundenkartei-kunde');

  await page.locator('textarea').first().fill('mag es kurz, Espresso');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await page.getByText('Notiz gespeichert.').first().waitFor({ timeout: 10000 });
  check('Notiz gespeichert', gesendet.some((g) => g.p.endsWith('/kartei/k1') && g.body.aenderung.notiz === 'mag es kurz, Espresso'), JSON.stringify(gesendet));

  await verlauf.nth(2).getByRole('button', { name: 'Notiz zum Besuch' }).click();
  await page.getByRole('textbox', { name: 'Notiz zu diesem Besuch' }).fill('7/1 + 6 %, 30 Min.');
  await verlauf.nth(2).getByRole('button', { name: 'Speichern' }).click();
  await verlauf.nth(2).getByText('7/1 + 6 %, 30 Min.').waitFor({ timeout: 10000 });
  check('Besuchsnotiz gespeichert', gesendet.some((g) => g.p.endsWith('/besuch/t1') && g.body.notiz === '7/1 + 6 %, 30 Min.'));

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await page.getByLabel('Name').fill('Jürgen Müller-Lang');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('heading', { name: 'Jürgen Müller-Lang', level: 1 }).waitFor({ timeout: 10000 });
  check('Name geändert', gesendet.some((g) => g.body.aenderung?.name === 'Jürgen Müller-Lang'));
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Kundenseite am Handy ohne Überlauf', overflow2 <= 0, `${overflow2}px`);

  // --- Gratis: Liste und Termine, Kennzahlen und Notizen nur als Hinweis ---
  laden = { ...LADEN, plan: 'gratis', billing: {} };
  await page.goto(`${BASE}/kunden`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Jürgen Müller').waitFor({ timeout: 30000 });
  check('Gratis: Hinweis auf Solo', await page.getByText('Besuche, Umsatz und Notizen je Kunde gehören zum Tarif Solo.').isVisible());
  check('Gratis: keine Gruppen', (await page.getByRole('radio', { name: /Stammkunden/ }).count()) === 0);
  await page.getByText('Jürgen Müller').click();
  await page.getByRole('heading', { name: 'Jürgen Müller', level: 1 }).waitFor({ timeout: 15000 });
  check('Gratis: Verlauf da, keine Notizen', (await page.locator('textarea').count()) === 0 && (await page.getByText('Notiz zum Besuch').count()) === 0 && await page.getByText('Verlauf').isVisible());
  await shot(page, 'kundenkartei-gratis');

  // --- Tresen: „Kunde zuordnen“ bei „Jetzt dran“ (components/counter/KundeZuordnen.tsx) direkt gerendert ---
  const TERMIN = { id: 'a1', shopId: 'laden-test', staffId: 'kim', serviceId: 's', status: 'in-progress', type: 'queue', customerName: 'Juergen',
    customerPhone: '0170 1234567', isAnonymous: true, startTime: zeit(0, 9), endTime: zeit(0, 10) };
  let termin = { ...TERMIN };
  await page.route('**/routes/team/laeden/laden-test/kunden', (route) => json(route, 200, { kunden: KUNDEN.map(({ kennzahlen, hatNotiz, ...k }) => k) }));
  await page.route('**/routes/team/termine/a1', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      gesendet.push({ p: '/team/termine/a1', body });
      termin = { ...termin, ...body.aenderung };
    }
    return json(route, 200, { termin });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(async (t) => {
    const main = await (await fetch('/src/main.tsx')).text();
    const React = (await import(main.match(/from "([^"]*\/react\.js[^"]*)"/)[1])).default;
    const { createRoot } = (await import(main.match(/from "([^"]*react-dom_client[^"]*)"/)[1])).default;
    // Router aus demselben Modul wie die Komponente, sonst kennt Link den Router nicht
    const quelle = await (await fetch('/src/components/counter/KundeZuordnen.tsx')).text();
    const { MemoryRouter } = await import(quelle.match(/from "([^"]*react-router-dom[^"]*)"/)[1]);
    const { KundeZuordnen } = await import('/src/components/counter/KundeZuordnen.tsx');
    const el = document.createElement('div');
    el.id = 'zuordnen-test';
    document.body.prepend(el);
    window.__zuordnenRender = (termin) => createRoot(el).render(React.createElement(MemoryRouter, null, React.createElement(KundeZuordnen, { termin })));
    window.__zuordnenRender(t);
  }, { ...TERMIN, startTime: undefined, endTime: undefined });
  const knopf = page.getByRole('button', { name: 'Kunde zuordnen' });
  await knopf.waitFor({ timeout: 15000 });
  check('Tresen: Knopf Kunde zuordnen', await knopf.isVisible());
  await knopf.click();
  const dialog = page.getByRole('dialog', { name: 'Kunde zuordnen' });
  await dialog.waitFor({ timeout: 10000 });
  check('Tresen: Vorschlag über die Handynummer', (await dialog.getByText('Passt vielleicht').count()) === 1 && (await dialog.getByText('Jürgen Müller').count()) === 1);
  check('Tresen: Neu anlegen mit Name und Nummer vorbelegt', await dialog.getByRole('button', { name: 'Als neuen Kunden anlegen' }).isVisible());
  await shot(page, 'kundenkartei-zuordnen');
  await dialog.getByRole('button', { name: 'Zuordnen' }).first().click();
  await page.getByText('Jürgen Müller zugeordnet.').first().waitFor({ timeout: 10000 });
  check('Tresen: zugeordnet über kundeId', gesendet.some((g) => g.p === '/team/termine/a1' && g.body.aenderung.kundeId === 'k1'), JSON.stringify(gesendet.slice(-1)));

  const echteFehler = errors.filter((e) => !/401|403|Failed to load resource|anmeldung|EventSource|push|billing|telefon/i.test(e));
  check('Keine JavaScript-Fehler', echteFehler.length === 0, echteFehler.join(' | '));
  await browser.close();
  return report(rows);
});
