// Betreiber-Bereich, Reiter Briefe (requirements/briefversand.md): auswählen, filtern, Welle als PDF erzeugen und hochladen,
// Erinnerung; Stufe B: ohne Zugang kein Knopf, mit Zugang Testmodus-Hinweis, Versand über PIN mit Fortschritt und Fehlern;
// Einstellungen samt Testmodus, Grenzen; im Reiter Verzeichnis „Keine Post mehr“ und „Unzustellbar“ am Eintrag.
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
const LEER = { weg: 'pdf', test: false, geschickt: 0, unklar: 0, fehler: [], hinweis: '' };
const WELLE = {
  ...LEER, id: 'w1', art: 'brief', am: '2026-11-04T10:00:00+00:00', status: 'erzeugt', anzahl: 2, preis: 0.77, kosten: 1.54, verschicktAm: null,
  auswertung: { uebernommen: 0, unzustellbar: 0, entfernt: 0, keinePost: 0, kostenJeUebernahme: null },
};
const ALT = {
  ...LEER, geschickt: 40, id: 'w0', art: 'brief', am: '2026-10-01T10:00:00+00:00', status: 'verschickt', anzahl: 40, preis: 0.77, kosten: 30.8, verschicktAm: '2026-10-01T12:00:00+00:00',
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
  let einstellungen = { proWelle: 200, proMonat: 300, preis: 0.77, testmodus: true };
  let schnittstelle = { test: false, echt: false };
  let pinAbrufe = -1;
  const PINWELLE = { ...WELLE, id: 'w2', weg: 'pin', test: true, status: 'versendet', geschickt: 1, kosten: 0 };
  await mockAuth(page);
  await page.route('**/routes/betreiber/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const method = route.request().method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (method === 'POST') calls.push({ path, body: route.request().postDataJSON() });
    if (path === '/ich') return json({ admin: true });
    if (path === '/uebersicht') return json(OVERVIEW);
    if (path === '/briefe') {
      if (pinAbrufe >= 0 && ++pinAbrufe >= 2) {
        wellen = [{ ...PINWELLE, status: 'verschickt', verschicktAm: '2026-11-04T12:00:00+00:00', fehler: [{ id: 'nord', name: 'Salon Nord', grund: 'Die Adresse ist nicht lesbar.' }] }, ...wellen.slice(1)];
      }
      return json({ einstellungen, monat: { kosten: wellen.includes(WELLE) ? 1.54 : 0, grenze: einstellungen.proMonat }, eintraege: SALONS, wellen, erinnerungTage: 21, schnittstelle });
    }
    if (path === '/briefe/versand') {
      wellen = [PINWELLE, ...wellen];
      pinAbrufe = 0;
      return json({ welle: 'w2', test: true });
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
  const knopf = page.getByRole('button', { name: /^\d+ (Briefe?|Erinnerung(en)?) als PDF$/ });
  await knopf.waitFor({ timeout: 15000 });

  // Auswahl: nur, wer darf; der Rest mit Grund
  check('Zwei Salons auswählbar', (await knopf.textContent()) === '2 Briefe als PDF', await knopf.textContent());
  check('Kosten nach Preis je Brief', await page.getByText('ca. 1,54 €').isVisible());
  check('Ausgeschlossene mit Grund', await page.getByText('Nicht dabei: 3').isVisible());
  await page.getByText('Nicht dabei: 3').click();
  check('Grund „keine Post“ sichtbar', await page.getByText('1 × Der Salon möchte keine Post von uns.').isVisible());
  check('Ohne Zugang zu PIN: kein Knopf, Hinweis', !(await page.getByRole('button', { name: /an PIN$|über PIN$/ }).count()) && await page.getByText(/Zugang für die Testumgebung fehlt noch/).isVisible());
  await shot(page, 'briefe-auswahl');

  // Filter und Abwählen
  await page.getByLabel('Bezirk').selectOption('Pankow');
  check('Filter Bezirk', (await knopf.textContent()) === '1 Brief als PDF', await knopf.textContent());
  await page.getByLabel('Bezirk').selectOption('');
  await page.getByLabel('Salon Nord auswählen').uncheck();
  check('Abwählen', (await knopf.textContent()) === '1 Brief als PDF', await knopf.textContent());
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
  check('Erinnerung: ein Salon fällig', (await knopf.textContent()) === '1 Erinnerung als PDF', await knopf.textContent());
  check('Erinnerung: Regel erklärt', await page.getByText(/Frühestens 21 Tage nach dem ersten Brief/).isVisible());

  // Stufe B: mit Zugang Testmodus-Hinweis, Versand über PIN mit Fortschritt, danach Fehler je Brief
  schnittstelle = { test: true, echt: true };
  await page.getByRole('button', { name: 'Verzeichnis', exact: true }).click();
  await page.getByRole('button', { name: 'Briefe', exact: true }).click();
  const pinKnopf = page.getByRole('button', { name: /als Test an PIN$/ });
  await pinKnopf.waitFor({ timeout: 15000 });
  check('Testmodus-Hinweis', await page.getByText(/Testmodus: „Über PIN“ geht an die Testumgebung/).isVisible());
  check('Knopf für den Test', (await pinKnopf.textContent()) === '2 Briefe als Test an PIN', await pinKnopf.textContent());
  await pinKnopf.click();
  await page.getByText('wird verschickt · 1 von 2').waitFor({ timeout: 15000 });
  const versand = calls.find((c) => c.path === '/briefe/versand');
  check('Versand ans Backend', versand?.body?.art === 'brief' && versand.body.ids.length === 2, JSON.stringify(versand?.body));
  check('Während des Versands keine neue Welle', await pinKnopf.isDisabled() && await page.getByText(/Gerade läuft eine Welle über PIN/).isVisible());
  await shot(page, 'briefe-pin-laeuft');
  await page.getByText('1 bei PIN angekommen · 1 nicht verschickt').waitFor({ timeout: 15000 });
  check('Fortschritt aktualisiert sich von selbst', true);
  await page.getByText('Nicht verschickt: 1 (wieder auswählbar)').click();
  check('Fehler je Brief mit Grund', await page.getByText('– Die Adresse ist nicht lesbar.').isVisible());
  check('Testwelle markiert', await page.getByText('Test', { exact: true }).first().isVisible());
  await shot(page, 'briefe-pin-fertig');

  // Einstellungen: Grenze je Welle greift sofort in der Auswahl, Testmodus ausschalten
  await page.getByRole('button', { name: 'Erster Brief' }).click();
  await page.getByLabel(/Testmodus für den Versand über PIN/).uncheck();
  await page.getByLabel('Höchstens Briefe je Welle').fill('1');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByText('Höchstens 1 Brief je Welle.', { exact: false }).waitFor({ timeout: 15000 });
  const gespeichert = calls.find((c) => c.path === '/briefe/einstellungen');
  check('Einstellungen ans Backend', gespeichert?.body?.proWelle === 1 && gespeichert?.body?.preis === 0.77 && gespeichert?.body?.testmodus === false, JSON.stringify(gespeichert?.body));
  check('Echter Versand: Knopf heißt „über PIN“', await page.getByRole('button', { name: /^\d+ Briefe? über PIN$/ }).isVisible());
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
