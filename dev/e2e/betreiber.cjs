// Betreiber-Bereich (/betreiber): Übersicht, Filter, Laden sperren, Freischalten, Löschen mit Bestätigung, Konto.
//  - Die Antworten des Backends sind hier nachgebildet (page.route), damit keine echten Läden und Konten nötig sind
//    und nichts in der Datenbank geändert wird. Geprüft wird, was die Seite zeigt und was sie an das Backend schickt.
//  - QME_BETREIBER=echt fragt stattdessen das echte Backend: Das Testkonto ist kein Betreiber und muss abgewiesen
//    werden (Menüpunkt fehlt, /routes/betreiber/uebersicht antwortet 403).
// Braucht: Entwicklungsserver (npm run dev; für "echt" mit QME_BACKEND=https://dranzeit.de) und Testdaten
// (python dev/fixtures.py anlegen) – nur für die Anmeldung.
const { BASE, launch, newPage, shot, collectErrors, fixture, signIn, report, run } = require('./lib.cjs');

const ECHT = process.env.QME_BETREIBER === 'echt';
const NOW = new Date();
const iso = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const shop = (id, name, extra = {}) => ({
  id, nr: 'L1', name, owner: `${id}-inhaber`, ownerLabel: '', email: `${id}@laden.de`, city: 'Berlin', phone: '030 123',
  created: iso(-20), founder: false, billing: '', plan: '', interval: '', cancelAtPeriodEnd: false, currentPeriodEnd: null,
  customerId: '', subscriptionId: '', effectivePlan: 'gratis', source: 'gratis', trialEnd: iso(-1), grant: null, suspended: null,
  onboarding: ['testlaufAt'], services: 3, staff: 2, staffAccounts: [], customers: 4, appointments: 40, upcoming: 2,
  thisMonth: 17, last30: 25, lastAppointment: iso(-1), markers: [], kind: 'echt', ...extra,
});

const SHOPS = [
  shop('salon', 'Salon Schnitt', { billing: 'active', plan: 'laden', interval: 'monat', effectivePlan: 'laden', source: 'abo', customerId: 'cus_1', subscriptionId: 'sub_1', currentPeriodEnd: iso(20) }),
  shop('offen', 'Barber Offen', { billing: 'past_due', plan: 'solo', interval: 'monat', effectivePlan: 'solo', source: 'abo', customerId: 'cus_2' }),
  shop('neu', 'Neuer Laden', { effectivePlan: 'team', source: 'test', trialEnd: iso(3), founder: true }),
  shop('test', 'Testladen (wird gleich gelöscht)', { kind: 'test', markers: ['TESTLADEN', 'FIXTURE'] }),
];

const account = (uid, email, role, extra = {}) => ({
  uid, nr: 'K1', email, name: '', role, emailVerified: false, disabled: false, blockedByAdmin: false, created: iso(-30),
  lastSignIn: iso(-1), providers: ['password'], auth: true, profile: true, shops: [], staff: [], customers: [],
  appointments: 0, upcoming: 0, markers: [], kind: 'echt', ...extra,
});

const ACCOUNTS = [
  account('salon-inhaber', 'ina@salon.de', 'shopOwner', { shops: ['salon'], name: 'Ina Haber' }),
  account('offen-inhaber', 'otto@barber.de', 'shopOwner', { shops: ['offen'] }),
  account('neu-inhaber', 'nina@neu.de', 'shopOwner', { shops: ['neu'] }),
  account('kunde', 'kunde@web.de', 'customer', { appointments: 3 }),
  account('chef', 'chef@dranzeit.de', 'shopOwner', { kind: 'intern', markers: ['BETREIBER'], emailVerified: true }),
];

const OVERVIEW = {
  now: NOW.toISOString(),
  stats: {
    shops: 3, shopsTest: 1, newShops7: 1, newShops30: 3, byPlan: { gratis: 0, solo: 1, laden: 1, team: 1 }, inTrial: 1, paying: 2,
    granted: 0, mrr: 58, pastDue: 1, cancelling: 0, trialEndingSoon: 1, suspended: 0, founders: { taken: 7, limit: 100 },
    accounts: 4, accountsTest: 1, accountsByRole: { shopOwner: 3, customer: 1 }, accountsUnverified: 4, appointments30: 75,
  },
  shops: SHOPS,
  accounts: ACCOUNTS,
  orphans: { staff: 0, customers: 1, appointmentsInMissingShops: 0 },
  system: { stripe: 'test', stripeWebhook: true, stripePortal: true, resend: false, mailFrom: 'Dranzeit <hallo@dranzeit.de>', publicUrl: 'https://dranzeit.de', scheduler: { running: true, lastRun: iso(0), intervalSeconds: 300 }, admins: 1 },
};

const DETAIL = (id) => ({
  id, shop: { name: SHOPS.find((s) => s.id === id)?.name, street: 'Hauptstr. 1', postalCode: '10115', city: 'Berlin' },
  effectivePlan: 'laden', trialEnd: iso(-1),
  staff: [{ id: 's1', name: 'Kim', email: 'kim@salon.de', role: 'staff', userId: 'kim', active: true }],
  owner: { uid: `${id}-inhaber`, email: 'ina@salon.de', emailVerified: false, disabled: false, lastSignIn: iso(-1) },
  protokoll: [{ at: iso(-2), by: 'chef@dranzeit.de', action: 'Testphase', target: { shopId: id }, reason: 'Messe' }],
});

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Backend nachbilden; calls sammelt, was die Seite schickt */
const mockBackend = async (page, calls, { admin = true } = {}) => {
  await page.route('**/routes/betreiber/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/routes\/betreiber/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/ich') return json({ admin });
    if (!admin) return json({ detail: 'Nur für den Betreiber der App.' }, 403);
    if (path === '/uebersicht') return json(OVERVIEW);
    if (path === '/protokoll') return json({ entries: DETAIL('salon').protokoll });
    if (path === '/loeschen/probe') {
      const blocked = (body.shopIds || []).includes('salon');
      return json({
        shops: (body.shopIds || []).map((id) => ({ id, name: SHOPS.find((s) => s.id === id).name, related: { services: 3, appointments: 40 } })),
        users: (body.uids || []).map((uid) => ({ uid, email: 'nina@neu.de', auth: true, profile: true, appointments: 0, upcoming: 0, push: 0, offers: 0, queue: 0, customers: 0, staff: 0 })),
        foundersFreed: 1,
        problems: blocked ? ['„Salon Schnitt“ hat ein laufendes Abo (active) – erst in Stripe kündigen.'] : [],
        confirmWord: SHOPS.find((s) => s.id === (body.shopIds || [])[0])?.name || 'kunde@web.de',
      });
    }
    if (path === '/loeschen') return json({ result: { shops: 1, accounts: 1 }, left: [], backup: 'sicherung-test.json' });
    if (/^\/laden\/[^/]+$/.test(path)) return json(DETAIL(path.split('/')[2]));
    if (path.endsWith('/passwort-mail')) return json({ email: 'kunde@web.de' });
    return json({ changed: true, accounts: 2, skipped: [] });
  });
  // Passwort-Mail geht im Browser an Firebase: hier abfangen, damit keine echte Mail rausgeht
  await page.route('**/identitytoolkit.googleapis.com/**sendOobCode**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'kunde@web.de' }) }),
  );
};

/** Dialoge und Seitenleiste schließen (Escape, bis keiner mehr offen ist) */
const closeAll = async (p) => {
  for (let i = 0; i < 4 && (await p.getByRole('dialog').count()) > 0; i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
};
const tab = (p, name) => p.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name });
const posted = (calls, path) => calls.filter((c) => c.method === 'POST' && c.path === path);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];

  if (ECHT) {
    const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
    await signIn(page, fx);
    const status = await page.evaluate(async () => {
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      const token = await firebaseAuth.currentUser.getIdToken();
      const call = async (p, auth) => (await fetch(`/routes/betreiber${p}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} })).status;
      const ich = await (await fetch('/routes/betreiber/ich', { headers: { Authorization: `Bearer ${token}` } })).json();
      return { ich, ohne: await call('/uebersicht', false), testkonto: await call('/uebersicht', true) };
    });
    rows.push({ name: 'echt: Testkonto ist kein Betreiber', pass: status.ich.admin === false, detail: JSON.stringify(status.ich) });
    rows.push({ name: 'echt: ohne Anmeldung abgewiesen', pass: [401, 403].includes(status.ohne), detail: String(status.ohne) });
    rows.push({ name: 'echt: Testkonto abgewiesen (403)', pass: status.testkonto === 403, detail: String(status.testkonto) });
    await page.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
    const denied = await page.getByText('Hinein kommt nur').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    rows.push({ name: 'echt: Seite zeigt "kein Zugang"', pass: denied });
    await browser.close();
    return report(rows);
  }

  // --- Desktop: alles durchspielen ---
  const page = await newPage(browser, { viewport: { width: 1280, height: 1000 } });
  const errors = collectErrors(page);
  const calls = [];
  await mockBackend(page, calls);
  await signIn(page, fx);
  await page.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Dranzeit im Blick').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  rows.push({ name: 'Übersicht: Monatsumsatz', pass: await page.getByText('58,00 €').isVisible() });
  rows.push({ name: 'Übersicht: Gründerplätze 7/100', pass: await page.getByText('93 noch frei').isVisible() });
  const attention = await page.locator('section', { hasText: 'Braucht Aufmerksamkeit' }).innerText();
  rows.push({ name: 'Übersicht: Zahlung offen + Testende', pass: attention.includes('Barber Offen') && attention.includes('Neuer Laden') && !attention.includes('Salon Schnitt'), detail: attention.replace(/\s+/g, ' ').slice(0, 120) });
  await shot(page, 'betreiber-uebersicht');

  // Menüpunkt im Konto-Menü
  await page.getByRole('button', { name: 'Konto-Menü öffnen' }).click();
  rows.push({ name: 'Menü: Betreiber-Bereich', pass: await page.getByRole('menuitem', { name: 'Betreiber-Bereich' }).isVisible() });
  await page.keyboard.press('Escape');

  // Läden: Filter und Testläden
  await tab(page, /^Läden/).click();
  const table = page.locator('table');
  rows.push({ name: 'Läden: alle da, Testladen mit Schild', pass: (await table.innerText()).includes('Testladen') && (await table.getByText('Test', { exact: true }).count()) === 1 });
  await page.getByText(/Test- und eigene Läden ausblenden/).click();
  rows.push({ name: 'Läden: Testladen auf Wunsch weg', pass: !(await table.innerText()).includes('Testladen') });
  await page.getByText(/Test- und eigene Läden ausblenden/).click();
  await page.getByRole('button', { name: 'Zahlung offen', exact: true }).click();
  const filtered = await table.innerText();
  rows.push({ name: 'Läden: Filter Zahlung offen', pass: filtered.includes('Barber Offen') && !filtered.includes('Salon Schnitt') });
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByPlaceholder('Name, Ort, E-Mail, ID').fill('salon');
  rows.push({ name: 'Läden: Suche', pass: (await table.locator('tbody tr').count()) === 1 });

  // Laden öffnen, sperren: ohne Grund geht es nicht
  await table.getByText('Salon Schnitt').click();
  await page.getByRole('heading', { name: 'Salon Schnitt', exact: true }).waitFor();
  await page.getByText('Kim', { exact: true }).waitFor();
  await page.waitForTimeout(700);
  await shot(page, 'betreiber-laden', false);
  await page.getByRole('button', { name: 'Laden sperren …' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Sperren', exact: true });
  rows.push({ name: 'Sperren: ohne Grund gesperrt', pass: await confirm.isDisabled() });
  await page.getByRole('dialog').getByLabel(/Grund/).fill('Zahlung seit drei Monaten offen');
  await confirm.click();
  await page.getByText('Laden gesperrt.').waitFor({ timeout: 10000 });
  const sperren = posted(calls, '/laden/salon/sperren');
  rows.push({ name: 'Sperren: Grund ans Backend', pass: sperren.length === 1 && sperren[0].body.reason === 'Zahlung seit drei Monaten offen' });

  // Freischalten
  await page.getByLabel('Tarif', { exact: true }).selectOption('team');
  await page.getByLabel('Grund (nur im Protokoll)').fill('Partner Messe');
  await page.getByRole('button', { name: 'Freischalten' }).click();
  await page.getByText('Team freigeschaltet.').waitFor({ timeout: 10000 });
  const grant = posted(calls, '/laden/salon/freischaltung')[0];
  rows.push({ name: 'Freischalten: Tarif, Datum, Grund', pass: grant?.body.plan === 'team' && /^\d{4}-\d{2}-\d{2}$/.test(grant.body.until) && grant.body.reason === 'Partner Messe', detail: JSON.stringify(grant?.body) });

  // Löschen mit laufendem Abo: verweigert
  await page.getByRole('button', { name: 'Laden löschen …' }).click();
  await page.getByText('So geht es nicht:').waitFor({ timeout: 10000 });
  rows.push({ name: 'Löschen: Abo blockiert', pass: await page.getByRole('button', { name: 'Endgültig löschen' }).isDisabled() });
  await closeAll(page);

  // Löschen eines Ladens ohne Abo: erst mit Namen
  await page.getByPlaceholder('Name, Ort, E-Mail, ID').fill('Neuer');
  await table.getByText('Neuer Laden').click();
  await page.getByRole('heading', { name: 'Neuer Laden', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Laden löschen …' }).click();
  await page.getByText(/Inhaber-Konto .* mitlöschen/).click();
  const del = page.getByRole('button', { name: 'Endgültig löschen' });
  await page.getByLabel(/Zur Bestätigung/).waitFor({ timeout: 10000 });
  await page.getByLabel(/Zur Bestätigung/).fill('Neuer');
  rows.push({ name: 'Löschen: falscher Name gesperrt', pass: await del.isDisabled() });
  await page.getByLabel(/Zur Bestätigung/).fill('neuer laden');
  await del.click();
  await page.getByText(/Gelöscht\. Sicherung/).waitFor({ timeout: 10000 });
  const loeschen = posted(calls, '/loeschen')[0];
  rows.push({ name: 'Löschen: Laden + Inhaber + Name', pass: loeschen?.body.shopIds[0] === 'neu' && loeschen.body.uids[0] === 'neu-inhaber' && loeschen.body.confirm === 'neuer laden', detail: JSON.stringify(loeschen?.body) });
  await closeAll(page);

  // Konto: Passwort-Mail
  await tab(page, /^Konten/).click();
  await page.getByPlaceholder('E-Mail, Name, UID').fill('kunde@');
  await page.locator('table').getByText('kunde@web.de').click();
  await page.getByRole('button', { name: 'Passwort-Mail schicken' }).click();
  await page.getByText('Passwort-Mail an kunde@web.de verschickt.').waitFor({ timeout: 10000 });
  rows.push({ name: 'Konto: Passwort-Mail', pass: posted(calls, '/konto/kunde/passwort-mail').length === 1 });
  await closeAll(page);

  // Betrieb und Protokoll
  await tab(page, 'Betrieb').click();
  rows.push({ name: 'Betrieb: Stripe-Testmodus, Resend fehlt', pass: (await page.getByText('Stripe: Testmodus').isVisible()) && (await page.getByText(/RESEND_API_KEY fehlt/).isVisible()) });
  await tab(page, 'Protokoll').click();
  rows.push({ name: 'Protokoll: Eintrag mit Grund', pass: await page.getByText('„Messe“').waitFor({ timeout: 10000 }).then(() => true).catch(() => false) });
  rows.push({ name: 'Desktop: keine JS-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  // --- Handy: Übersicht und Laden-Liste ohne Querscrollen ---
  const phone = await newPage(browser);
  const phoneErrors = collectErrors(phone);
  await mockBackend(phone, []);
  await signIn(phone, fx);
  await phone.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await phone.getByText('Dranzeit im Blick').waitFor({ timeout: 30000 });
  await phone.waitForTimeout(800);
  rows.push({ name: 'Handy: Übersicht ohne Querscrollen', pass: (await overflow(phone)) <= 0, detail: `${await overflow(phone)} px` });
  await shot(phone, 'betreiber-handy');
  await tab(phone, /^Läden/).click();
  await phone.locator('table').getByText('Salon Schnitt').click();
  await phone.getByRole('heading', { name: 'Salon Schnitt', exact: true }).waitFor();
  await phone.waitForTimeout(700);
  await shot(phone, 'betreiber-handy-laden', false);
  await closeAll(phone);
  rows.push({ name: 'Handy: Läden ohne Querscrollen', pass: (await overflow(phone)) <= 0, detail: `${await overflow(phone)} px` });
  await phone.getByRole('button', { name: 'Menü öffnen' }).click();
  rows.push({ name: 'Handy-Menü: Betreiber-Bereich', pass: await phone.getByRole('link', { name: 'Betreiber-Bereich' }).isVisible() });
  rows.push({ name: 'Handy: keine JS-Fehler', pass: phoneErrors.length === 0, detail: phoneErrors.join(' | ') });

  // --- Kein Betreiber: kein Menüpunkt, Seite sagt warum ---
  const other = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await mockBackend(other, [], { admin: false });
  await signIn(other, fx);
  await other.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  rows.push({ name: 'Kein Betreiber: Hinweis', pass: await other.getByText('Hinein kommt nur').waitFor({ timeout: 20000 }).then(() => true).catch(() => false) });
  await other.getByRole('button', { name: 'Konto-Menü öffnen' }).click();
  rows.push({ name: 'Kein Betreiber: kein Menüpunkt', pass: (await other.getByRole('menuitem', { name: 'Betreiber-Bereich' }).count()) === 0 });

  await browser.close();
  return report(rows);
});
