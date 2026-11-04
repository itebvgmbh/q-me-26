// Betreiber-Bereich, Reiter Briefe (requirements/briefversand.md, Stufe A): auswählen, filtern, Welle erzeugen (PDF), hochladen,
// Erinnerung, Einstellungen, Grenzen; im Reiter Verzeichnis „Keine Post mehr“ und „Unzustellbar“ am Eintrag.
// Anmeldung und Backend sind nachgebildet: kein Testkonto nötig, kein Eintrag ändert sich, kein Code entsteht, kein Brief geht raus.
// Braucht: Entwicklungsserver (npm run dev). Regeln und PDF prüft backend/tests/test_briefe.py.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const PDF = '%PDF-1.4\n%%EOF\n';
const salon = (id, name, extra = {}) => ({
  id, name, kategorie: 'friseur', street: `${name}str. 1`, postalCode: '13353', city: 'Berlin', bezirk: 'Mitte', ortsteil: 'Wedding', status: 'online',
  pfad: `/friseur/berlin/${id}`, briefe: 0, letzterBrief: null, gruende: { brief: '', erinnerung: 'Hat noch keinen Brief bekommen.' }, ...extra,
});
const SALONS = [
  salon('nord', 'Salon Nord', { postalCode: '13187', bezirk: 'Pankow', ortsteil: 'Pankow' }),
  salon('mitte', 'Salon Mitte'),
  salon('kamm', 'Kamm & Co', { gruende: { brief: 'Der Salon möchte keine Post von uns.', erinnerung: 'Der Salon möchte keine Post von uns.' } }),
  salon('alt', 'Salon Alt', { briefe: 1, letzterBrief: '2026-10-01T10:00:00+00:00', gruende: { brief: 'Hat schon einen Brief bekommen.', erinnerung: '' } }),
  salon('frisch', 'Salon Frisch', { briefe: 1, letzterBrief: '2026-11-01T10:00:00+00:00', gruende: { brief: 'Hat schon einen Brief bekommen.', erinnerung: 'Erinnerung ab 22.11.2026.' } }),
];
const WELLE = {
  id: 'w1', art: 'brief', am: '2026-11-04T10:00:00+00:00', status: 'erzeugt', anzahl: 2, preis: 0.77, kosten: 1.54, verschicktAm: null,
  auswertung: { uebernommen: 0, unzustellbar: 0, entfernt: 0, keinePost: 0, kostenJeUebernahme: null },
};
const ALT = {
  id: 'w0', art: 'brief', am: '2026-10-01T10:00:00+00:00', status: 'verschickt', anzahl: 40, preis: 0.77, kosten: 30.8, verschicktAm: '2026-10-01T12:00:00+00:00',
  auswertung: { uebernommen: 2, unzustellbar: 1, entfernt: 1, keinePost: 3, kostenJeUebernahme: 15.4 },
};

const eintrag = (id, name, extra = {}) => ({
  id, name, status: 'online', kategorie: 'friseur', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin', ortsteil: 'Wedding', bezirk: 'Mitte',
  phone: '', website: '', beschreibung: '', schwerpunkte: [], services: [], businessHoursByDay: [], ohneTermin: '', coordinates: null, slug: id,
  stadtSlug: 'berlin', pfad: `/friseur/berlin/${id}`, altePfade: null, shopId: null, shopName: '', shopFehlt: false, googlePlaceId: null, quelle: null,
  wuensche: 0, vorschlag: null, uebernahme: null, fehlt: [], angelegtAm: null, geaendertAm: null, veroeffentlichtAm: null, entferntAm: null,
  postSperre: null, unzustellbar: false, post: [{ welle: 'w0', art: 'brief', am: '2026-10-01T10:00:00+00:00', status: 'verschickt', verschicktAm: '2026-10-01T12:00:00+00:00' }],
  ...extra,
});

const OVERVIEW = {
  now: new Date().toISOString(),
  stats: {
    shops: 0, shopsTest: 0, newShops7: 0, newShops30: 0, byPlan: { gratis: 0, solo: 0, laden: 0, team: 0 }, inTrial: 0, paying: 0, granted: 0, mrr: 0, pastDue: 0,
    cancelling: 0, trialEndingSoon: 0, suspended: 0, founders: { taken: 0, limit: 100 }, accounts: 0, accountsTest: 0, accountsByRole: {}, accountsUnverified: 0, appointments30: 0,
  },
  shops: [],
  accounts: [],
  orphans: { staff: 0, customers: 0, appointmentsInMissingShops: 0 },
  system: { stripe: 'test', stripeWebhook: true, stripePortal: true, resend: true, mailFrom: 'Dranzeit <hallo@dranzeit.de>', publicUrl: 'https://dranzeit.de' },
};

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });

  const calls = [];
  let wellen = [ALT];
  let einstellungen = { proWelle: 200, proMonat: 300, preis: 0.77 };
  await mockAuth(page);
  await page.route('**/routes/betreiber/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const method = route.request().method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (method === 'POST') calls.push({ path, body: route.request().postDataJSON() });
    if (path === '/ich') return json({ admin: true });
    if (path === '/uebersicht') return json(OVERVIEW);
    if (path === '/briefe') {
      return json({ einstellungen, monat: { kosten: wellen.includes(WELLE) ? 1.54 : 0, grenze: einstellungen.proMonat }, eintraege: SALONS, wellen, erinnerungTage: 21 });
    }
    if (path === '/briefe/welle') {
      wellen = [WELLE, ALT];
      return route.fulfill({
        status: 200, contentType: 'application/pdf', body: PDF,
        headers: { 'Content-Disposition': 'attachment; filename="Dranzeit-Briefe-2026-11-04-Brief-2.pdf"', 'X-Welle': 'w1' },
      });
    }
    if (path === '/briefe/welle/w1/hochgeladen') {
      wellen = [{ ...WELLE, status: 'verschickt', verschicktAm: '2026-11-04T11:00:00+00:00' }, ALT];
      return json({ ok: true, status: 'verschickt' });
    }
    if (path === '/briefe/einstellungen') {
      einstellungen = route.request().postDataJSON();
      return json(einstellungen);
    }
    if (path === '/verzeichnis') return json({ eintraege: [eintrag('mitte', 'Salon Mitte')], status: { google: false, ai: false } });
    return json({ ok: true });
  });
  page.on('dialog', (d) => d.accept());
  await signInFake(page);

  await page.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Briefe', exact: true }).click({ timeout: 60000 });
  const knopf = page.getByRole('button', { name: /^\d+ (Briefe?|Erinnerung(en)?) erzeugen$/ });
  await knopf.waitFor({ timeout: 15000 });

  // Auswahl: nur, wer darf; der Rest mit Grund
  check('Zwei Salons auswählbar', (await knopf.textContent()) === '2 Briefe erzeugen', await knopf.textContent());
  check('Kosten nach Preis je Brief', await page.getByText('ca. 1,54 €').isVisible());
  check('Ausgeschlossene mit Grund', await page.getByText('Nicht dabei: 3').isVisible());
  await page.getByText('Nicht dabei: 3').click();
  check('Grund „keine Post“ sichtbar', await page.getByText('1 × Der Salon möchte keine Post von uns.').isVisible());
  await shot(page, 'briefe-auswahl');

  // Filter und Abwählen
  await page.getByLabel('Bezirk').selectOption('Pankow');
  check('Filter Bezirk', (await knopf.textContent()) === '1 Brief erzeugen', await knopf.textContent());
  await page.getByLabel('Bezirk').selectOption('');
  await page.getByLabel('Salon Nord auswählen').uncheck();
  check('Abwählen', (await knopf.textContent()) === '1 Brief erzeugen', await knopf.textContent());
  await page.getByLabel('Salon Nord auswählen').check();

  // Welle erzeugen: PDF kommt, Backend bekommt Art und Salons
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), knopf.click()]);
  check('PDF mit Namen vom Backend', download.suggestedFilename() === 'Dranzeit-Briefe-2026-11-04-Brief-2.pdf', download.suggestedFilename());
  const welle = calls.find((c) => c.path === '/briefe/welle');
  check('Backend bekommt Art und beide Salons', welle?.body?.art === 'brief' && JSON.stringify(welle.body.ids.sort()) === '["mitte","nord"]', JSON.stringify(welle?.body));
  await page.getByText('noch nicht hochgeladen').first().waitFor({ timeout: 15000 });
  check('Hinweis auf offene Welle', await page.getByText(/Eine Welle ist erzeugt, aber noch nicht hochgeladen/).isVisible());
  await shot(page, 'briefe-welle-offen');
  await page.getByRole('button', { name: 'Hochgeladen' }).click();
  await page.getByText('verschickt 04.11.2026').waitFor({ timeout: 15000 });
  check('Hochgeladen ans Backend', calls.some((c) => c.path === '/briefe/welle/w1/hochgeladen'));
  check('Auswertung der alten Welle', await page.getByText(/1 unzustellbar · 1 Eintrag entfernt · 3 keine Post/).isVisible());

  // Erinnerung: nur fällige, Text erklärt die Regel
  await page.getByRole('button', { name: /^Erinnerung/ }).click();
  check('Erinnerung: ein Salon fällig', (await knopf.textContent()) === '1 Erinnerung erzeugen', await knopf.textContent());
  check('Erinnerung: Regel erklärt', await page.getByText(/Frühestens 21 Tage nach dem ersten Brief/).isVisible());

  // Einstellungen: Grenze je Welle greift sofort in der Auswahl
  await page.getByRole('button', { name: 'Erster Brief' }).click();
  await page.getByLabel('Höchstens Briefe je Welle').fill('1');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByText('Höchstens 1 Brief je Welle.', { exact: false }).waitFor({ timeout: 15000 });
  const gespeichert = calls.find((c) => c.path === '/briefe/einstellungen');
  check('Einstellungen ans Backend', gespeichert?.body?.proWelle === 1 && gespeichert?.body?.preis === 0.77, JSON.stringify(gespeichert?.body));
  check('Über der Grenze: Knopf gesperrt', await knopf.isDisabled());
  await shot(page, 'briefe-grenze');

  // Reiter Verzeichnis: Post am Eintrag
  await page.getByRole('button', { name: 'Verzeichnis', exact: true }).click();
  await page.getByRole('button', { name: /^Online/ }).click({ timeout: 15000 });
  await page.getByText('Salon Mitte', { exact: true }).first().click({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Post' }).waitFor({ timeout: 15000 });
  check('Bisherige Briefe am Eintrag', await page.getByText('Brief vom 01.10.2026').isVisible());
  await page.getByLabel('Salon will keine Post, gesagt per').selectOption('Anruf');
  await page.getByRole('button', { name: 'Keine Post mehr' }).click();
  await page.getByRole('button', { name: 'Unzustellbar' }).click();
  await page.waitForTimeout(500);
  check('Keine Post mit Grund ans Backend', calls.some((c) => c.path === '/verzeichnis/mitte/keine-post' && c.body?.grund === 'Anruf'));
  check('Unzustellbar ans Backend', calls.some((c) => c.path === '/verzeichnis/mitte/unzustellbar' && c.body?.unzustellbar === true));
  await shot(page, 'briefe-post-am-eintrag');

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
