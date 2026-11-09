// Anrufliste auf /telefon-assistent: wer angerufen hat, was daraus wurde, Zurückrufen
// (GET /routes/telefon-einrichtung/{id}/anrufe, backend/app/libs/telefon_anrufliste.py).
// Anmeldung, Inhaber und Backend nachgebildet: kein Testkonto nötig, es ändert sich nichts. Braucht den Entwicklungsserver
// (npm run dev). Regeln im Backend: backend/tests/test_telefon_anrufliste.py.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const LADEN = { id: 'laden-test', name: 'Studio Kamm', phone: '030 555 555', owner: 'betreiber-test', billing: { plan: 'solo', status: 'active' } };
const STAND = {
  sichtbar: true, offen: true, freigegeben: true, gesperrt: false, tarif: true, abo: true, kannTesten: false, kannBuchen: true, testmodus: false,
  zusatz: null, grund: null, verbrauch: { art: 'test', minuten: 4, grenze: 30, anteil: 0.13 }, warnung: 0, deckel: 59, aktiv: true,
  weitersagen: true, status: 'aktiv', anschluss: '+4930555555', vorschlag: '+4930555555', zielnummer: '+493082694105', eigeneNummer: false, minuten: 4, freiminuten: 30,
};
const vor = (minuten) => ({ __zeit: new Date(Date.now() - minuten * 60000).toISOString() });
const morgen = { __zeit: new Date(Date.now() + 26 * 3600000).toISOString() };
const ANRUFE = [
  { id: 'CA7', beginn: vor(1), sekunden: 0, laeuft: true, anrufer: '+491577777777', name: null, ergebnis: 'assistent', grund: null, termine: [] },
  { id: 'CA6', beginn: vor(20), sekunden: 108, laeuft: false, anrufer: '+491511111111', name: 'Alex Muster', ergebnis: 'assistent', grund: null,
    termine: [{ id: 't1', startTime: morgen, status: 'scheduled', type: 'booked', nummer: '12', leistung: 'Herrenschnitt', person: 'Kim' }] },
  { id: 'CA5', beginn: vor(40), sekunden: 35, laeuft: false, anrufer: '+491522222222', name: 'Herr Krause', ergebnis: 'assistent', grund: null, termine: [] },
  { id: 'CA4', beginn: vor(60), sekunden: 50, laeuft: false, anrufer: null, name: null, ergebnis: 'assistent', grund: null,
    termine: [{ id: 't2', status: 'scheduled', type: 'queue', nummer: '23', leistung: 'Bart', person: 'Robin' }] },
  { id: 'CA3', beginn: vor(90), sekunden: 12, laeuft: false, anrufer: '+491533333333', name: null, ergebnis: 'ansage', grund: 'test_verbraucht', termine: [] },
  { id: 'CA2', beginn: vor(26 * 60), sekunden: 20, laeuft: false, anrufer: '+491544444444', name: null, ergebnis: 'belegt', grund: null, termine: [] },
  { id: 'CA1', beginn: vor(5 * 24 * 60), sekunden: 70, laeuft: false, anrufer: '+491555555555', name: 'Eva', ergebnis: 'assistent', grund: null,
    termine: [{ id: 't3', startTime: morgen, status: 'cancelled', type: 'booked', leistung: 'Herrenschnitt', person: '' }] },
];

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const page = await newPage(browser, { viewport: { width: 1100, height: 1400 } });
  const fehler = collectErrors(page);
  await mockAuth(page);

  let stand = STAND;
  let anrufe = ANRUFE;
  let status = 200;
  let abrufe = 0;
  const json = (route, code, daten) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(daten) });
  await page.route('**/routes/{konto,team,telefon-einrichtung,telefon-hinweis,billing,invoices}/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const telefon = `/routes/telefon-einrichtung/${LADEN.id}`;
    if (p === '/routes/konto/profil') return json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } });
    if (p === '/routes/team/ich/laeden') return json(route, 200, { laeden: [LADEN] });
    if (p === `/routes/team/laeden/${LADEN.id}`) return json(route, 200, { laden: LADEN, kanaele: [] });
    if (p === telefon) return json(route, 200, stand);
    if (p === `${telefon}/anrufe`) {
      abrufe += 1;
      return status === 200 ? json(route, 200, { anrufe }) : json(route, status, { detail: 'kaputt' });
    }
    if (p === '/routes/billing/modus') return json(route, 200, { test: false });
    return route.continue();
  });
  await page.route('**/routes/telefon-hinweis', (route) => json(route, 200, { laeden: [], offen: true }));
  await page.route('**/routes/billing-public/**', (route) => json(route, 200, { left: 0 }));
  await signInFake(page);

  const seite = async (sprache = 'de') => {
    await page.goto(`${BASE}/telefon-assistent?sprache=${sprache}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 60000 });
    await page.getByText('Wird geladen', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(600);
  };

  await seite();
  const liste = page.getByRole('region', { name: 'Anrufe' });
  await liste.getByText('Alex Muster').waitFor({ timeout: 30000 });
  const eintraege = liste.locator('ul > li').filter({ has: page.locator('p.font-semibold') });
  const texte = await eintraege.allInnerTexts();
  check('Sieben Anrufe, neueste zuerst', texte.length === 7 && texte[0].includes('01577777777') && texte[6].includes('Eva'), JSON.stringify(texte));
  check('Laufendes Gespräch', texte[0].includes('Gespräch läuft gerade') && texte[0].startsWith('Heute'), texte[0]);
  check('Gebucht: Name, Nummer, Termin, Leistung bei Person', texte[1].includes('Alex Muster') && texte[1].includes('01511111111') && texte[1].includes('Termin gebucht:') && texte[1].includes('Herrenschnitt bei Kim'), texte[1]);
  check('Dauer in Minuten', texte[1].includes('1:48 Min.'), texte[1]);
  check('Ohne Termin', texte[2].includes('Herr Krause') && texte[2].includes('Kein Termin gebucht'), texte[2]);
  check('Nummer gezogen, unterdrückte Nummer', texte[3].includes('Unterdrückte Nummer') && texte[3].includes('Nummer 23 gezogen') && texte[3].includes('Bart bei Robin'), texte[3]);
  check('Nur Ansage mit Grund', texte[4].includes('Nur Ansage: Testminuten aufgebraucht'), texte[4]);
  check('Belegt, gestern', texte[5].includes('Alle Leitungen waren belegt') && texte[5].startsWith('Gestern'), texte[5]);
  check('Abgesagt durchgestrichen', (await eintraege.nth(6).locator('.line-through').count()) === 1, texte[6]);

  const zurueck = liste.getByRole('link', { name: 'Zurückrufen' });
  const ziele = await zurueck.evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  check(
    'Zurückrufen nur ohne Termin, mit Nummer, nicht während des Gesprächs',
    JSON.stringify(ziele) === JSON.stringify(['tel:+491522222222', 'tel:+491533333333', 'tel:+491544444444', 'tel:+491555555555']),
    JSON.stringify(ziele),
  );
  check('Hinweis auf 90 Tage', await liste.getByText('Anrufe der letzten 90 Tage. Ältere löschen wir.').isVisible());

  const vorher = abrufe;
  await liste.getByRole('button', { name: 'Aktualisieren' }).click();
  await page.waitForTimeout(500);
  check('Aktualisieren lädt neu', abrufe === vorher + 1, `${vorher} → ${abrufe}`);
  await shot(page, 'telefon-anrufliste');

  // --- Handy ---
  await page.setViewportSize({ width: 390, height: 844 });
  await seite();
  await liste.getByText('Alex Muster').waitFor({ timeout: 30000 });
  const ueber = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Handy: nichts ragt seitlich heraus', ueber <= 0, `${ueber} px`);
  await liste.scrollIntoViewIfNeeded();
  await shot(page, 'telefon-anrufliste-handy');
  await page.setViewportSize({ width: 1100, height: 1400 });

  // --- Leer, Fehler, nicht eingeschaltet ---
  anrufe = [];
  await seite();
  check('Leer und eingeschaltet: Hinweis', await liste.getByText('Noch keine Anrufe.').isVisible());
  stand = { ...STAND, aktiv: false, status: 'aus' };
  await seite();
  check('Leer und aus: keine Anrufliste', (await page.getByRole('region', { name: 'Anrufe' }).count()) === 0);
  stand = STAND;
  status = 500;
  await seite();
  check('Fehler beim Laden: Meldung', await liste.getByRole('alert').getByText('Die Anrufe konnten nicht geladen werden.').isVisible());
  status = 200;
  anrufe = ANRUFE;

  // --- Andere Sprache ---
  await seite('en');
  const calls = page.getByRole('region', { name: 'Calls' });
  await calls.getByText('Alex Muster').waitFor({ timeout: 30000 });
  check('Englisch: übersetzt', (await calls.getByText('Appointment booked:').count()) === 2 && (await calls.getByRole('link', { name: 'Call back' }).count()) === 4);
  await seite('ar');
  check('Arabisch: Nummern bleiben links nach rechts', (await page.locator('[dir="ltr"]', { hasText: '01511111111' }).count()) >= 1);

  check('Keine JavaScript-Fehler', fehler.filter((f) => !f.includes('500')).length === 0, fehler.join(' | '));
  await browser.close();
  return report(rows);
});
