// Betreiber-Bereich → „Testkonten aufräumen …“ (frontend/src/components/betreiber/TestkontenDialog.tsx):
//  - Knopf nur, wenn es Test-Konten oder -Läden gibt; Probelauf zeigt Konten mit ihren Läden, verwaiste Testläden und
//    was bleibt; gelöscht wird erst nach „löschen“, genau die Liste aus dem Probelauf; danach ist der Knopf weg
//  - Handy: Dialog ohne Querscrollen
// Backend und Anmeldung nachgebildet (wie verzeichnis.cjs): nichts wird gelöscht, keine Testdaten nötig.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const NOW = new Date();
const iso = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const shop = (id, name, extra = {}) => ({
  id, nr: 'L1', name, owner: `${id}-inhaber`, ownerLabel: '', email: `${id}@laden.de`, city: 'Berlin', phone: '030 123',
  created: iso(-20), founder: false, billing: '', plan: '', interval: '', cancelAtPeriodEnd: false, currentPeriodEnd: null,
  customerId: '', subscriptionId: '', effectivePlan: 'gratis', source: 'gratis', trialEnd: iso(-1), grant: null, suspended: null,
  onboarding: [], services: 1, staff: 1, staffAccounts: [], customers: 0, appointments: 0, upcoming: 0,
  thisMonth: 0, last30: 0, lastAppointment: null, markers: [], kind: 'echt', ...extra,
});
const account = (uid, email, role, extra = {}) => ({
  uid, nr: 'K1', email, name: '', role, emailVerified: false, disabled: false, blockedByAdmin: false, created: iso(-30),
  lastSignIn: iso(-1), providers: ['password'], auth: true, profile: true, shops: [], staff: [], customers: [],
  appointments: 0, upcoming: 0, markers: [], kind: 'echt', ...extra,
});

const WEGWERF = 'q-me-test-1793901010996-75vz@example.com';
const overview = (mitTests) => ({
  now: NOW.toISOString(),
  stats: {
    shops: 1, shopsTest: mitTests ? 3 : 0, newShops7: 0, newShops30: 1, byPlan: { gratis: 1, solo: 0, laden: 0, team: 0 }, inTrial: 0, paying: 0,
    granted: 0, mrr: 0, pastDue: 0, cancelling: 0, trialEndingSoon: 0, suspended: 0, founders: { taken: 0, limit: 100 },
    accounts: 1, accountsTest: mitTests ? 2 : 0, accountsByRole: { shopOwner: 1 }, accountsUnverified: 1, appointments30: 0,
  },
  shops: [
    shop('salon', 'Salon Schnitt', { owner: 'ina' }),
    ...(mitTests
      ? [
          shop('la', 'Laden A (Test Ladenwahl)', { owner: 'wegwerf', kind: 'test', markers: ['TESTADRESSE'] }),
          shop('lb', 'Laden B (Test Ladenwahl)', { owner: 'wegwerf', kind: 'test', markers: ['TESTADRESSE'] }),
          shop('verwaist', 'Testladen (wird gleich gelöscht)', { owner: 'weg', kind: 'test', markers: ['TESTLADEN', 'INHABER-KONTO FEHLT'] }),
        ]
      : []),
  ],
  accounts: [
    account('ina', 'ina@salon.de', 'shopOwner', { shops: ['salon'] }),
    ...(mitTests
      ? [
          account('wegwerf', WEGWERF, 'shopOwner', { shops: ['la', 'lb'], kind: 'test', markers: ['TESTADRESSE'] }),
          account('kimtest', 'kim-1793901010996@example.com', 'employee', { kind: 'intern', markers: ['ITEBV', 'E2E'] }),
        ]
      : []),
  ],
  orphans: { staff: 0, customers: 0, appointmentsInMissingShops: 0 },
  system: { stripe: 'test', stripeWebhook: true, stripePortal: true, resend: true, mailFrom: 'x', publicUrl: 'https://dranzeit.de', scheduler: { running: true, lastRun: iso(0), intervalSeconds: 300 }, admins: 1 },
});

const PROBE = {
  shops: [
    { id: 'la', name: 'Laden A (Test Ladenwahl)', related: { services: 1, staff: 1 } },
    { id: 'lb', name: 'Laden B (Test Ladenwahl)', related: { services: 1 } },
    { id: 'verwaist', name: 'Testladen (wird gleich gelöscht)', related: {} },
  ],
  users: [{ uid: 'wegwerf', email: WEGWERF, auth: true, profile: true, appointments: 0, upcoming: 0, push: 0, offers: 0, queue: 0, customers: 0, staff: 0 }],
  foundersFreed: 0,
  problems: [],
  confirmWord: 'löschen',
  uids: ['wegwerf'],
  shopIds: ['la', 'lb', 'verwaist'],
  // Am Laden steht die Adresse, wie sie angelegt wurde (hier mit Großbuchstaben); der Probelauf schreibt sie klein
  owners: { la: WEGWERF.toUpperCase(), lb: WEGWERF, verwaist: '' },
  skipped: [{ label: 'kim-1793901010996@example.com', why: 'Inhaber oder im Team der ITEBV GmbH – bei Bedarf einzeln löschen' }],
};

const mockBackend = async (page, calls) => {
  let geloescht = false;
  await page.route('**/routes/betreiber/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/ich') return json({ admin: true });
    if (path === '/uebersicht') return json(overview(!geloescht));
    if (path === '/protokoll') return json({ entries: [] });
    if (path === '/testkonten/probe') return json(PROBE);
    if (path === '/testkonten') {
      geloescht = true;
      return json({ result: { shops: 3, accounts: 1 }, left: [], backup: 'sicherung-test.json' });
    }
    return json({ detail: `nicht nachgebildet: ${path}` }, 404);
  });
};

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tab = (p, name) => p.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name });

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });

  const page = await newPage(browser, { viewport: { width: 1280, height: 1000 } });
  const errors = collectErrors(page);
  const calls = [];
  await mockAuth(page);
  await mockBackend(page, calls);
  await signInFake(page);
  await page.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Dranzeit im Blick').waitFor({ timeout: 30000 });
  await tab(page, /^Läden/).click();
  const knopf = page.getByRole('button', { name: 'Testkonten aufräumen …' });
  check('Knopf da, wenn es Testläden gibt', await knopf.isVisible());

  await knopf.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/Weg gehen/).waitFor({ timeout: 10000 });
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  check('Probelauf: Anzahl', text.includes('Weg gehen 1 Konto und 3 Läden'), text.slice(0, 120));
  const liste = (await dialog.getByRole('list', { name: 'Was gelöscht wird' }).innerText()).replace(/\s+/g, ' ');
  check('Probelauf: Konto mit seinen beiden Läden', liste.includes(WEGWERF) && liste.includes('Laden A (Test Ladenwahl), Laden B (Test Ladenwahl)'), liste);
  check('Probelauf: verwaister Testladen', liste.includes('Testladen (wird gleich gelöscht) Laden ohne Inhaber-Konto'), liste);
  check('Probelauf: was bleibt, mit Grund', text.includes('Bleiben, obwohl Testadresse') && text.includes('kim-1793901010996@example.com – Inhaber oder im Team der ITEBV GmbH'));
  check('Probelauf allein schickt kein Löschen', !calls.some((c) => c.path === '/testkonten'));
  await shot(page, 'testkonten-dialog', false);

  const los = dialog.getByRole('button', { name: 'Endgültig löschen' });
  check('Ohne Wort gesperrt', await los.isDisabled());
  await dialog.getByLabel(/Zur Bestätigung/).fill('ja');
  check('Falsches Wort gesperrt', await los.isDisabled());
  await dialog.getByLabel(/Zur Bestätigung/).fill('Löschen');
  await los.click();
  await page.getByText('1 Konto und 3 Läden gelöscht. Sicherung auf dem Server: sicherung-test.json').waitFor({ timeout: 10000 });
  const gesendet = calls.find((c) => c.method === 'POST' && c.path === '/testkonten');
  check(
    'Gelöscht wird genau die Liste',
    gesendet && gesendet.body.uids.join() === 'wegwerf' && gesendet.body.shopIds.join() === 'la,lb,verwaist' && gesendet.body.confirm === 'Löschen',
    JSON.stringify(gesendet?.body),
  );
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  check('Danach: Knopf weg (keine Testkonten mehr)', (await knopf.count()) === 0);
  check('Desktop: keine JS-Fehler', errors.length === 0, errors.join(' | '));

  // Handy: Dialog passt
  const phone = await newPage(browser, { viewport: { width: 390, height: 844 } });
  const phoneErrors = collectErrors(phone);
  await mockAuth(phone);
  await mockBackend(phone, []);
  await signInFake(phone);
  await phone.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await phone.getByText('Dranzeit im Blick').waitFor({ timeout: 30000 });
  await tab(phone, /^Konten/).click();
  await phone.getByRole('button', { name: 'Testkonten aufräumen …' }).click();
  await phone.getByRole('dialog').getByText(/Weg gehen/).waitFor({ timeout: 10000 });
  const box = await phone.getByRole('dialog').boundingBox();
  check('Handy: Dialog im Bild', box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  check('Handy: kein Querscrollen', (await overflow(phone)) <= 0, `${await overflow(phone)} px`);
  await shot(phone, 'testkonten-dialog-handy', false);
  check('Handy: keine JS-Fehler', phoneErrors.length === 0, phoneErrors.join(' | '));

  await browser.close();
  return report(rows);
});
