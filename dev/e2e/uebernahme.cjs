// Seite übernehmen ohne Code, als Inhaber mit Laden: Anfrage an den Betreiber, Nachweis per E-Mail, und was die Seite dazu zeigt.
// Anmeldung, Inhaber und Backend sind nachgebildet: kein Testkonto nötig, kein Eintrag ändert sich, keine Mail geht raus.
// Braucht: Entwicklungsserver (npm run dev), weil Vite die Seite als einzelnes Modul ausliefert.
// Den Weg dorthin von der Karte prüft verzeichnis.cjs, das Backend backend/tests/test_verzeichnis.py.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const VORSCHAU = {
  id: 'nord', pfad: '/friseur/berlin/nord', name: 'Salon Nord (Test)', kategorie: 'friseur', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin',
  phone: '030 1', website: '', beschreibung: '', googlePlaceId: '', coordinates: null, businessHoursByDay: [], services: [],
};
const LADEN = { id: 'laden-test', name: 'Studio Kamm' };

/** Nur diese Seite sieht den nachgebildeten Inhaber: Profil und Läden stehen sonst in Firestore */
const inhaberSeite = (page) =>
  page.route('**/src/pages/Uebernehmen.tsx*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text())
      .replace(/import \{ getShopsByOwnerId \} from "[^"]+";/, `const getShopsByOwnerId = async () => [${JSON.stringify(LADEN)}];`)
      .replace(/import \{ getUserProfile \} from "[^"]+";/, "const getUserProfile = async () => ({ role: 'shopOwner' });");
    return route.fulfill({ response: res, body });
  });

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });

  const anfragen = [];
  let antwort = null;
  await mockAuth(page);
  await inhaberSeite(page);
  await page.route('**/routes/verzeichnis/nord/vorschau', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VORSCHAU) }),
  );
  await page.route('**/routes/verzeichnis/uebernahme/anfragen', (route) => {
    anfragen.push({ ...route.request().postDataJSON(), auth: (route.request().headers().authorization || '').split(' ')[0] });
    return antwort(route);
  });
  await signInFake(page);

  const oeffne = async () => {
    await page.goto(`${BASE}/uebernehmen?eintrag=nord`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: VORSCHAU.name }).waitFor({ timeout: 60000 });
    const knopf = page.getByRole('button', { name: `Mit ${LADEN.name} verbinden` });
    await knopf.waitFor({ timeout: 30000 });
    return knopf;
  };

  // Anfrage geht durch
  antwort = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pfad: VORSCHAU.pfad }) });
  const verbinden = await oeffne();
  check('Ohne Code: Inhaber kann seinen Laden verbinden', await verbinden.isVisible());
  await shot(page, 'uebernahme-inhaber');
  await verbinden.click();
  await page.getByRole('heading', { name: 'Angefragt.' }).waitFor({ timeout: 15000 });
  check(
    'Anfrage: Seite und Laden ans Backend (Anmeldung im Cookie)',
    anfragen[0]?.eintragId === 'nord' && anfragen[0]?.shopId === LADEN.id,
    JSON.stringify(anfragen[0]),
  );
  check('Anfrage: sagt, dass wir erst prüfen', await page.getByText(`Wir prüfen kurz, ob es dein Salon ist, und verbinden die Seite dann mit ${LADEN.name}.`).isVisible());
  await shot(page, 'uebernahme-angefragt');

  // Schon abgelehnt: Meldung vom Backend
  const text = 'Diese Seite gehört nach unserer Prüfung zu einem anderen Salon.';
  antwort = (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: text }) });
  await (await oeffne()).click();
  await page.getByRole('heading', { name: 'Noch nicht verbunden.' }).waitFor({ timeout: 15000 });
  check('Abgelehnt: Meldung vom Backend', await page.getByText(text).isVisible());

  // Keine Verbindung: bleibt auf der Seite, man kann es noch einmal versuchen
  antwort = (route) => route.abort();
  const nochmal = await oeffne();
  await nochmal.click();
  await page.getByText('Keine Verbindung zum Server').waitFor({ timeout: 15000 });
  check('Keine Verbindung: Knopf bleibt', await nochmal.isVisible());

  // Mit eigener Webseite: zuerst der Nachweis per E-Mail, der Weg von Hand bleibt darunter
  const MIT_WEBSEITE = { ...VORSCHAU, id: 'sued', website: 'https://salon.example/', domain: 'salon.example' };
  const nachweise = [];
  let nachweisAntwort = null;
  await page.route('**/routes/verzeichnis/sued/vorschau', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MIT_WEBSEITE) }),
  );
  await page.route('**/routes/verzeichnis/uebernahme/nachweis', (route) => {
    nachweise.push({ ...route.request().postDataJSON(), auth: route.request().headers().authorization });
    return nachweisAntwort(route);
  });
  await page.goto(`${BASE}/uebernehmen?eintrag=sued`, { waitUntil: 'domcontentloaded' });
  const anfordern = page.getByRole('button', { name: 'Link anfordern' });
  await anfordern.waitFor({ timeout: 30000 });
  check('Mit Webseite: Hinweis nennt die Domain', await page.getByText('@salon.example').first().isVisible());
  const vonHand = page.getByRole('button', { name: `Mit ${LADEN.name} verbinden` });
  await vonHand.waitFor({ timeout: 30000 });
  const hintergrund = (knopf) => knopf.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('Mit Webseite: Weg von Hand bleibt, aber nicht als Hauptknopf', (await hintergrund(vonHand)) !== (await hintergrund(anfordern)));
  await shot(page, 'uebernahme-nachweis');

  // Adresse abgelehnt: Meldung vom Backend, Formular bleibt
  await page.getByLabel('E-Mail-Adresse deines Salons').fill('info@salon.example');
  nachweisAntwort = (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Bitte gib eine gültige E-Mail-Adresse an.' }) });
  await anfordern.click();
  await page.getByText('Bitte gib eine gültige E-Mail-Adresse an.').waitFor({ timeout: 15000 });
  check('Abgelehnt: Formular bleibt', await anfordern.isVisible());

  // Angekommen: sagt nicht, ob die Adresse gepasst hat
  nachweisAntwort = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  await anfordern.click();
  await page.getByText('Deine Anfrage ist angekommen.').waitFor({ timeout: 15000 });
  check('Nachweis: Seite und Adresse ans Backend, ohne Anmeldung', nachweise[1]?.eintragId === 'sued' && nachweise[1]?.email === 'info@salon.example' && !nachweise[1]?.auth, JSON.stringify(nachweise[1]));
  check('Nachweis: Antwort nennt die Adresse', await page.getByText('Gehört info@salon.example zu deinem Salon').isVisible());
  await shot(page, 'uebernahme-nachweis-angekommen');

  // Link aus der Mail: wie mit dem Brief, kein zweiter Nachweis
  await page.route('**/routes/verzeichnis/uebernahme/pruefen', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'ABCDE-FGHJK', eintrag: { ...MIT_WEBSEITE, domain: undefined } }) }),
  );
  await page.goto(`${BASE}/uebernehmen#code=ABCDEFGHJK`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Bestätigt. Richte deinen Laden ein').waitFor({ timeout: 30000 });
  await vonHand.waitFor({ timeout: 30000 });
  check('Link aus der Mail: kein zweiter Nachweis', !(await anfordern.isVisible()));

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
