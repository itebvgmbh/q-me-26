// Betreiber-Bereich, Reiter Verzeichnis: Code erzeugen, Brief als PDF laden, Meldung vom Backend, Hinweis bei Entwürfen.
// Anmeldung und Backend sind nachgebildet: kein Testkonto nötig, kein Eintrag ändert sich, kein Code entsteht.
// Braucht: Entwicklungsserver (npm run dev). Den Brief selbst prüft backend/tests/test_verzeichnis.py, ansehen: dev/brief-muster.py.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const CODE = 'ABCDE-FGHJK';
const PDF = '%PDF-1.4\n%%EOF\n';

const eintrag = (id, name, extra = {}) => ({
  id, name, status: 'online', kategorie: 'friseur', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin', ortsteil: 'Wedding', bezirk: 'Mitte',
  phone: '', website: '', beschreibung: '', schwerpunkte: [], services: [], businessHoursByDay: [], ohneTermin: '', coordinates: null, slug: id,
  stadtSlug: 'berlin', pfad: `/friseur/berlin/${id}`, altePfade: null, shopId: null, shopName: '', shopFehlt: false, googlePlaceId: null, quelle: null,
  wuensche: 0, vorschlag: null, uebernahme: null, fehlt: [], angelegtAm: null, geaendertAm: null, veroeffentlichtAm: null, entferntAm: null, ...extra,
});

const EINTRAEGE = [eintrag('nord', 'Salon Nord'), eintrag('sued', 'Salon Süd', { status: 'entwurf' })];

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

  const briefe = [];
  let briefAntwort = null;
  await mockAuth(page);
  await page.route('**/routes/betreiber/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/ich') return json({ admin: true });
    if (path === '/uebersicht') return json(OVERVIEW);
    if (path === '/verzeichnis') return json({ eintraege: EINTRAEGE, status: { google: false, ai: false } });
    if (/\/verzeichnis\/[^/]+\/code$/.test(path)) return json({ code: CODE, link: `https://dranzeit.de/uebernehmen#code=${CODE.replace('-', '')}`, gueltigBis: '2027-04-28T10:00:00+00:00' });
    if (/\/verzeichnis\/[^/]+\/brief$/.test(path)) {
      briefe.push({ path, ...route.request().postDataJSON(), auth: (route.request().headers().authorization || '').split(' ')[0] });
      return briefAntwort(route);
    }
    return json({});
  });
  await signInFake(page);

  const oeffne = async (name, gruppe) => {
    await page.goto(`${BASE}/betreiber?reiter=verzeichnis`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: new RegExp(`^${gruppe}`) }).click({ timeout: 60000 });
    await page.getByText(name, { exact: true }).first().click({ timeout: 15000 });
    await page.getByRole('heading', { name: 'Übernahme-Code' }).waitFor({ timeout: 15000 });
  };

  // Seite ist online: Code erzeugen, dann liegt der Brief einen Klick entfernt
  briefAntwort = (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Dranzeit-Brief-salon-nord.pdf"' }, body: PDF });
  await oeffne('Salon Nord', 'Online');
  check('Online: kein Hinweis', !(await page.getByText('Für den Brief muss die Seite veröffentlicht sein.').isVisible()));
  check('Vor dem Code gibt es keinen Brief-Knopf', !(await page.getByRole('button', { name: 'Brief als PDF' }).isVisible()));
  await page.getByRole('button', { name: 'Code erzeugen' }).click();
  const knopf = page.getByRole('button', { name: 'Brief als PDF' });
  await knopf.waitFor({ timeout: 15000 });
  check('Code wird gezeigt', await page.getByText(CODE, { exact: true }).isVisible());
  await shot(page, 'brief-knopf');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), knopf.click()]);
  check('Download mit Namen vom Backend', download.suggestedFilename() === 'Dranzeit-Brief-salon-nord.pdf', download.suggestedFilename());
  check('Backend bekommt Eintrag, Code und Anmeldung', briefe[0]?.path === '/verzeichnis/nord/brief' && briefe[0]?.code === CODE && briefe[0]?.auth === 'Bearer', JSON.stringify(briefe[0]));

  // Backend lehnt ab: Meldung, Code bleibt sichtbar
  const text = 'Für den Brief fehlt die Anschrift (Straße, PLZ, Ort).';
  briefAntwort = (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: text }) });
  await knopf.click();
  await page.getByText(text).first().waitFor({ timeout: 15000 });
  check('Abgelehnt: Meldung vom Backend, Code bleibt', await page.getByText(CODE, { exact: true }).isVisible());

  // Entwurf: Hinweis schon vor dem Erzeugen
  await oeffne('Salon Süd', 'Entwürfe');
  check('Entwurf: Hinweis', await page.getByText('Für den Brief muss die Seite veröffentlicht sein.').isVisible());

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
