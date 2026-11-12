// „Meine Läden“ (pages/Laeden.tsx) und „Laden löschen“ (components/LadenLoeschenDialog.tsx) für Inhaber.
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Geprüft: Liste mit Tarif, Löschen mit Hindernis (laufendes Abo → Link zum Tarif), Löschen mit Bestätigung per Name,
// danach ist der Laden aus der Liste weg; „Laden löschen …“ unter „Laden“; „Alle Läden …“ in der Ladenauswahl.
// Braucht: Entwicklungsserver (npm run dev). Bilder: dev/out/meine-laeden-*.png
const { BASE, launch, newPage, collectErrors, mockAuth, signInFake, shot, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });
const inTagen = (n) => zeit(new Date(Date.now() + n * 86400000).toISOString());

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser, { viewport: { width: 1100, height: 900 } });
  const errors = collectErrors(page);
  await mockAuth(page);

  const sonne = { id: 'sonne', name: 'Salon Sonne', street: 'Hauptstr. 1', postalCode: '10115', city: 'Berlin', owner: 'betreiber-test', plan: 'gratis', trialEndsAt: inTagen(12) };
  const mond = {
    id: 'mond', name: 'Salon Mond', city: 'Hamburg', owner: 'betreiber-test', plan: 'gratis', trialEndsAt: inTagen(-30),
    billing: { plan: 'laden', status: 'active', interval: 'monat' },
  };
  let laeden = [sonne, mond];
  const geloescht = [];
  const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/routes/{live,team,konto,telefon,geraete,team-push}/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/routes/konto/profil' && req.method() === 'GET') return json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } });
    if (p === '/routes/konto/profil') return json(route, 200, { profil: { uid: 'betreiber-test', role: 'shopOwner' } });
    if (p === '/routes/team/ich/laeden') return json(route, 200, { laeden });
    if (p === '/routes/team/laeden/sonne/loeschen' && req.method() === 'GET')
      return json(route, 200, {
        id: 'sonne', name: 'Salon Sonne', bestaetigung: 'Salon Sonne', hindernis: null, hindernisArt: null,
        anzahl: { kommende: 2, termine: 14, team: 3, leistungen: 6, kunden: 9 }, gruender: true, aboEndet: null,
      });
    if (p === '/routes/team/laeden/sonne/loeschen') {
      const body = JSON.parse(req.postData() || '{}');
      geloescht.push(body);
      laeden = laeden.filter((s) => s.id !== 'sonne');
      return json(route, 200, { geloescht: true, reste: 0 });
    }
    if (p === '/routes/team/laeden/mond/loeschen')
      return json(route, 200, {
        id: 'mond', name: 'Salon Mond', bestaetigung: 'Salon Mond', hindernisArt: 'tarif',
        hindernis: 'Für diesen Laden läuft noch ein Abo. Kündige es zuerst unter „Tarif“ – danach kannst du den Laden löschen.',
        anzahl: { kommende: 0, termine: 0, team: 1, leistungen: 1, kunden: 0 }, gruender: false, aboEndet: null,
      });
    if (p.startsWith('/routes/team/laeden/') && req.method() === 'GET' && p.split('/').length === 5) {
      const s = laeden.find((x) => p.endsWith(`/${x.id}`));
      return s ? json(route, 200, { laden: s }) : json(route, 404, { detail: 'Diesen Laden gibt es nicht.' });
    }
    if (p.startsWith('/routes/live/laden/')) {
      const s = laeden.find((x) => p === `/routes/live/laden/${x.id}`);
      if (s) return json(route, 200, { laden: s });
    }
    // Was die Seiten sonst nebenbei fragen (Telefon-Hinweis, Startklar, Tablets …): leer
    return json(route, 200, {});
  });

  await signInFake(page);
  await page.goto(`${BASE}/laeden`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Meine Läden' }).waitFor({ timeout: 15000 });
  await page.getByText('Salon Mond').first().waitFor();
  const text = await page.locator('main, body').first().innerText();
  rows.push({ name: 'Liste: beide Läden', pass: text.includes('Salon Sonne') && text.includes('Salon Mond') && /Du hast 2 Läden/.test(text) });
  rows.push({ name: 'Tarif je Laden', pass: /Testphase: noch 1[12] Tage/.test(text) && /Tarif Laden/.test(text), detail: (text.match(/Testphase[^\n]*|Tarif Laden[^\n]*/g) || []).join(' | ') });
  await shot(page, 'meine-laeden-liste');

  // Laufendes Abo: kein Löschen, aber der Weg zum Tarif
  await page.getByRole('button', { name: '„Salon Mond“ löschen' }).click();
  await page.getByRole('dialog').getByText('läuft noch ein Abo').waitFor();
  const dlg1 = page.getByRole('dialog');
  rows.push({
    name: 'Abo läuft: Hinweis + Link zum Tarif, kein Löschknopf',
    pass: (await dlg1.getByRole('link', { name: 'Zum Tarif' }).getAttribute('href')) === '/tarif?shopId=mond' && (await dlg1.getByRole('button', { name: 'Endgültig löschen' }).count()) === 0,
  });
  await page.waitForTimeout(400); // Einblenden abwarten
  await shot(page, 'meine-laeden-abo-laeuft', false);
  await dlg1.getByRole('button', { name: 'Abbrechen' }).click();
  await dlg1.waitFor({ state: 'hidden' });

  // Löschen mit Bestätigung
  await page.getByRole('button', { name: '„Salon Sonne“ löschen' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Das geht mit weg:').waitFor();
  const dt = await dlg.innerText();
  rows.push({ name: 'Vorschau: Zahlen und Warnung', pass: /14 Termine und Nummern/.test(dt) && /3 Personen im Team/.test(dt) && /9 Einträge in der Kundenliste/.test(dt) && /2 Kunden haben noch einen Termin/.test(dt) && /Gründerpreis/.test(dt) });
  const knopf = dlg.getByRole('button', { name: 'Endgültig löschen' });
  const feld = dlg.getByLabel(/Zum Bestätigen tipp den Namen des Ladens ein/);
  const ausVorher = await knopf.isDisabled();
  await feld.fill('Salon');
  const ausFalsch = await knopf.isDisabled();
  await feld.fill('  salon sonne ');
  const anRichtig = !(await knopf.isDisabled());
  rows.push({ name: 'Knopf erst mit richtigem Namen', pass: ausVorher && ausFalsch && anRichtig });
  await page.waitForTimeout(400);
  await shot(page, 'meine-laeden-loeschen-dialog', false);
  await knopf.click();
  await dlg.waitFor({ state: 'hidden' });
  await page.getByText('„Salon Sonne“ ist gelöscht.').waitFor();
  const nachher = await page.locator('main, body').first().innerText();
  rows.push({ name: 'POST mit eingetipptem Namen', pass: geloescht.length === 1 && geloescht[0].bestaetigung === '  salon sonne ', detail: JSON.stringify(geloescht) });
  rows.push({ name: 'Danach nur noch Salon Mond', pass: !nachher.includes('Salon Sonne\n') && /Du hast 1 Laden/.test(nachher) && nachher.includes('Salon Mond') });
  await shot(page, 'meine-laeden-nach-loeschen');

  // „Laden“: Abschnitt „Laden löschen …“
  laeden = [sonne, mond];
  await page.goto(`${BASE}/shop-profile?shopId=mond`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Laden löschen' }).waitFor({ timeout: 15000 });
  rows.push({ name: 'Laden-Seite: „Laden löschen …“', pass: (await page.getByRole('button', { name: 'Laden löschen …' }).count()) === 1 });
  rows.push({ name: 'Kachel „Meine Läden“', pass: (await page.getByRole('link', { name: /Meine Läden/ }).count()) >= 1 });

  // Ladenauswahl oben: „Alle Läden …“ führt zur Übersicht
  await page.getByRole('combobox', { name: 'Laden wechseln' }).click();
  await page.getByRole('option', { name: 'Alle Läden …' }).click();
  await page.waitForURL(/\/laeden$/, { timeout: 5000 }).catch(() => {});
  rows.push({ name: 'Ladenauswahl: „Alle Läden …“ → /laeden', pass: new URL(page.url()).pathname === '/laeden', detail: page.url() });

  // Handy
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Meine Läden' }).waitFor();
  await shot(page, 'meine-laeden-handy');
  const breit = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  rows.push({ name: 'Handy: nichts ragt seitlich heraus', pass: breit });

  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
