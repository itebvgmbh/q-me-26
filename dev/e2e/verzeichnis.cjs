// Salon-Verzeichnis: Reiter „Verzeichnis“ im Betreiber-Bereich und graue Salons auf der Karte.
//  - Backend nachgebildet (page.route), wie betreiber.cjs: nichts wird in der Datenbank geändert, Google und Claude
//    werden nicht gefragt. Geprüft wird, was die Seite zeigt und was sie ans Backend schickt.
//  - Anmeldung nachgebildet (Firebase-Auth-Antworten aus page.route): kein Testkonto nötig, keine Testdaten.
//  - Karte: echte Läden aus Firestore (ohne Anmeldung lesbar), dazu ein nachgebildeter Salon aus dem Verzeichnis.
// Braucht: Entwicklungsserver (npm run dev). Die Salonseiten selbst prüft backend/tests/test_verzeichnis.py.
const { BASE, launch, newPage, shot, collectErrors, report, run } = require('./lib.cjs');

const NOW = new Date();
const iso = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const UID = 'betreiber-test';
const EMAIL = 'chef@example.com';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: 'https://securetoken.google.com/qmedata-7c79e', aud: 'qmedata-7c79e', auth_time: now, user_id: UID, sub: UID,
    iat: now, exp: now + 3600, email: EMAIL, email_verified: true, firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
  })}.x`;
};

/** Firebase-Anmeldung beantworten, ohne Google zu fragen; Firestore mit dem falschen Token gar nicht erst fragen */
const mockAuth = async (page) => {
  const token = fakeToken();
  const user = {
    localId: UID, email: EMAIL, emailVerified: true, displayName: 'Chef', createdAt: '1700000000000', lastLoginAt: String(Date.now()),
    providerUserInfo: [{ providerId: 'password', email: EMAIL, federatedId: EMAIL, rawId: EMAIL }],
  };
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => {
    const url = route.request().url();
    const body = url.includes('accounts:lookup')
      ? { kind: 'identitytoolkit#GetAccountInfoResponse', users: [user] }
      : { kind: 'identitytoolkit#VerifyPasswordResponse', localId: UID, email: EMAIL, displayName: 'Chef', idToken: token, registered: true, refreshToken: 'r', expiresIn: '3600' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/securetoken.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: token, id_token: token, expires_in: '3600', refresh_token: 'r', token_type: 'Bearer', user_id: UID }) }),
  );
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
};

const signInFake = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(async ({ email }) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, email, 'egal');
  }, { email: EMAIL });
};

const HOURS = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: '09:00', closeTime: '18:00', breaks: [] }));
const entry = (id, name, extra = {}) => ({
  id, status: 'entwurf', name, kategorie: 'friseur', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin', ortsteil: 'Wedding',
  bezirk: 'Mitte', phone: '030 1', website: `https://${id}.example/`, beschreibung: 'Der Salon schneidet Damen und Herren.',
  schwerpunkte: ['Damen'], services: [{ name: 'Schnitt', category: '', price: 25, priceFrom: true }], businessHoursByDay: HOURS,
  ohneTermin: '', coordinates: { latitude: 52.55, longitude: 13.35 }, slug: id, stadtSlug: 'berlin', pfad: `/friseur/berlin/${id}`,
  altePfade: null, shopId: null, shopName: '', shopFehlt: false, googlePlaceId: 'ChIJ_x', wuensche: 0, vorschlag: null, fehlt: [],
  quelle: { website: `https://${id}.example/`, seiten: [`https://${id}.example/`, `https://${id}.example/impressum`], gelesenAm: iso(-1) },
  angelegtAm: iso(-2), geaendertAm: iso(-1), veroeffentlichtAm: null, entferntAm: null, ...extra,
});

const ENTRIES = [
  entry('haarwerk', 'Haarwerk', { fehlt: ['Preise'], services: [] }),
  entry('nord', 'Salon Nord', { status: 'online', veroeffentlichtAm: iso(-1), wuensche: 5 }),
  entry('laden-s1', 'Kings Cut', { status: 'online', shopId: 's1', shopName: 'Kings Cut', kategorie: 'barbershop' }),
  entry('kiez', 'Kiez Schnitt', { vorschlag: { shopId: 's2', name: 'Kiez Schnitt GmbH', grund: 'gleicher Google-Eintrag', am: iso(0) } }),
];

const HITS = [
  { placeId: 'ChIJ_neu_00001', name: 'Schnittpunkt', address: 'Seestr. 9, 13353 Berlin', postalCode: '13353', website: 'https://schnittpunkt.example/', websiteFremd: '', kategorie: 'friseur', geschlossen: false, eintragId: '', shopId: '' },
  { placeId: 'ChIJ_bekannt_01', name: 'Salon Nord', address: 'Müllerstr. 1, 13353 Berlin', postalCode: '13353', website: 'https://nord.example/', websiteFremd: '', kategorie: 'friseur', geschlossen: false, eintragId: 'nord', shopId: '' },
  { placeId: 'ChIJ_insta_0001', name: 'Fade Brothers', address: 'Amrumer Str. 3, 13353 Berlin', postalCode: '13353', website: '', websiteFremd: 'https://www.instagram.com/fade', kategorie: 'barbershop', geschlossen: false, eintragId: '', shopId: '' },
  { placeId: 'ChIJ_nagel_0001', name: 'Nail Art', address: 'Seestr. 1, 13353 Berlin', postalCode: '13353', website: 'https://nails.example/', websiteFremd: '', kategorie: null, geschlossen: false, eintragId: '', shopId: '' },
];

const OVERVIEW = {
  now: NOW.toISOString(),
  stats: {
    shops: 0, shopsTest: 0, newShops7: 0, newShops30: 0, byPlan: { gratis: 0, solo: 0, laden: 0, team: 0 }, inTrial: 0, paying: 0, granted: 0,
    mrr: 0, pastDue: 0, cancelling: 0, trialEndingSoon: 0, suspended: 0, founders: { taken: 0, limit: 100 }, accounts: 0, accountsTest: 0,
    accountsByRole: {}, accountsUnverified: 0, appointments30: 0,
  },
  shops: [], accounts: [], orphans: { staff: 0, customers: 0, appointmentsInMissingShops: 0 },
  system: { stripe: 'test', stripeWebhook: true, stripePortal: true, resend: false, mailFrom: 'x', publicUrl: 'https://dranzeit.de', scheduler: { running: true, lastRun: iso(0), intervalSeconds: 300 }, admins: 1 },
};

const mockBackend = async (page, calls) => {
  await page.route('**/routes/betreiber/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/ich') return json({ admin: true });
    if (path === '/uebersicht') return json(OVERVIEW);
    if (path === '/protokoll') return json({ entries: [] });
    if (path === '/verzeichnis') return json({ eintraege: ENTRIES, status: { google: true, ai: true } });
    if (path === '/verzeichnis/suche') return json({ treffer: HITS, nextPageToken: '' });
    if (path === '/verzeichnis/import') {
      await new Promise((r) => setTimeout(r, 400));
      return json(entry('schnittpunkt', 'Schnittpunkt', { fehlt: ['Beschreibung'] }));
    }
    let m = path.match(/^\/verzeichnis\/([^/]+)\/status$/);
    if (m) return json({ status: body.status });
    m = path.match(/^\/verzeichnis\/([^/]+)\/(uebernahme|uebernahme-ablehnen|loeschen)$/);
    if (m) return json({ ok: true });
    m = path.match(/^\/verzeichnis\/([^/]+)$/);
    if (m) return json({ ...ENTRIES.find((e) => e.id === m[1]), ...body });
    return json({ detail: 'unbekannt' }, 404);
  });
};

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const posted = (calls, path) => calls.filter((c) => c.method === 'POST' && c.path === path);

run(async () => {
  const browser = await launch();
  const rows = [];

  // --- Betreiber-Bereich, Reiter Verzeichnis ---
  const page = await newPage(browser, { viewport: { width: 1280, height: 1000 } });
  const errors = collectErrors(page);
  const calls = [];
  await mockAuth(page);
  await mockBackend(page, calls);
  await signInFake(page);
  await page.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Dranzeit im Blick').waitFor({ timeout: 30000 });
  await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name: 'Verzeichnis' }).click();
  await page.getByText('Übernahme bestätigen').waitFor({ timeout: 10000 });
  rows.push({ name: 'Vorschlag zur Übernahme sichtbar', pass: await page.getByText('↔ Laden „Kiez Schnitt GmbH“').isVisible() });
  const table = page.locator('table');
  const drafts = await table.innerText();
  rows.push({ name: 'Liste: Entwürfe vorausgewählt', pass: drafts.includes('Haarwerk') && drafts.includes('fehlt: Preise') && !drafts.includes('Salon Nord'), detail: drafts.replace(/\s+/g, ' ').slice(0, 100) });
  await page.getByRole('button', { name: /^Dranzeit-Läden/ }).click();
  rows.push({ name: 'Liste: Filter Dranzeit-Läden', pass: (await table.innerText()).includes('Kings Cut') });

  // Suchen, auswählen, anlegen
  await page.getByLabel('Suche bei Google').fill('Friseur Wedding');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await page.getByText('4 Treffer, 1 neu mit eigener Webseite').waitFor({ timeout: 10000 });
  rows.push({ name: 'Suche: bekannte, fremde, andere markiert', pass:
    (await page.getByText('im Verzeichnis', { exact: true }).isVisible()) &&
    (await page.getByText(/keine eigene Webseite \(nur instagram\.com\)/).isVisible()) &&
    (await page.getByText('andere Branche').isVisible()) &&
    (await page.getByLabel('Fade Brothers auswählen').isDisabled()) });
  rows.push({ name: 'Suche: Hinweis Google Maps', pass: await page.getByText('Suchergebnisse: Google Maps').isVisible() });
  await page.getByRole('button', { name: 'Alle neuen auswählen' }).click();
  await shot(page, 'verzeichnis-suche', false);
  await page.getByRole('button', { name: 'Ausgewählte anlegen (1)' }).click();
  await page.getByText(/Entwurf angelegt · fehlt: Beschreibung/).waitFor({ timeout: 10000 });
  const imp = posted(calls, '/verzeichnis/import');
  rows.push({ name: 'Anlegen: Webseite und Place-ID ans Backend', pass: imp.length === 1 && imp[0].body.website === 'https://schnittpunkt.example/' && imp[0].body.placeId === 'ChIJ_neu_00001', detail: JSON.stringify(imp[0]?.body) });

  // Bearbeiten und veröffentlichen
  await page.getByRole('button', { name: /^Entwürfe/ }).click();
  await table.getByText('Haarwerk').click();
  await page.getByRole('heading', { name: 'Haarwerk', exact: true }).waitFor();
  rows.push({ name: 'Bearbeiten: Zeiten als Text', pass: (await page.getByLabel('Montag').inputValue()) === '09:00–18:00' && (await page.getByLabel('Sonntag').inputValue()) === '' });
  await page.getByLabel('Montag').fill('abends');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByText(/Öffnungszeit am Montag so schreiben/).waitFor({ timeout: 5000 });
  rows.push({ name: 'Bearbeiten: unlesbare Zeit abgefangen', pass: posted(calls, '/verzeichnis/haarwerk').length === 0 });
  await page.getByLabel('Montag').fill('9-12, 13-18:30');
  await page.getByRole('button', { name: 'Leistung' }).click();
  await page.getByLabel('Leistung', { exact: true }).last().fill('Herrenschnitt');
  await page.getByLabel('Preis in Euro').last().fill('28,50');
  await shot(page, 'verzeichnis-bearbeiten', false);
  await page.getByRole('button', { name: 'Speichern und veröffentlichen' }).click();
  await page.getByText('Veröffentlicht.').waitFor({ timeout: 10000 });
  const saved = posted(calls, '/verzeichnis/haarwerk')[0]?.body;
  const monday = saved?.businessHoursByDay.find((d) => d.dayOfWeek === 1);
  rows.push({ name: 'Speichern: Pause aus "9-12, 13-18:30"', pass: monday?.openTime === '09:00' && monday?.closeTime === '18:30' && monday?.breaks[0]?.startTime === '12:00', detail: JSON.stringify(monday) });
  rows.push({ name: 'Speichern: neue Leistung mit Preis', pass: saved?.services.some((s) => s.name === 'Herrenschnitt' && s.price === 28.5), detail: JSON.stringify(saved?.services) });
  rows.push({ name: 'Veröffentlichen: Status online', pass: posted(calls, '/verzeichnis/haarwerk/status')[0]?.body.status === 'online' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Übernahme bestätigen
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await page.getByText('Übernommen.').waitFor({ timeout: 10000 });
  rows.push({ name: 'Übernahme: Laden ans Backend', pass: posted(calls, '/verzeichnis/kiez/uebernahme')[0]?.body.shopId === 's2' });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  // Handy: nichts ragt heraus
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  rows.push({ name: 'Handy: nichts ragt heraus', pass: (await overflow(page)) <= 0, detail: `${await overflow(page)} px` });
  await shot(page, 'verzeichnis-handy');

  // --- Karte: graue Salons aus dem Verzeichnis ---
  const map = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const mapErrors = collectErrors(map);
  await map.route('**/routes/verzeichnis/karte', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ salons: [
      { id: 'nord', name: 'Salon Nord (Test)', kategorie: 'friseur', street: 'Müllerstr. 1', postalCode: '13353', city: 'Berlin', ortsteil: 'Wedding', latitude: 52.55, longitude: 13.35, pfad: '/friseur/berlin/nord' },
    ] }) }),
  );
  await map.goto(`${BASE}/shop-map`, { waitUntil: 'domcontentloaded' });
  await map.getByText('Weitere Salons').waitFor({ timeout: 30000 });
  const card = map.getByRole('link', { name: /Salon Nord \(Test\)/ });
  rows.push({ name: 'Karte: Salon in der Liste mit Link', pass: (await card.getAttribute('href')) === '/friseur/berlin/nord' });
  rows.push({ name: 'Karte: grauer Marker', pass: (await map.locator('img.leaflet-marker-icon.grayscale').count()) === 1 });
  await map.locator('img.leaflet-marker-icon.grayscale').click({ force: true });
  rows.push({ name: 'Karte: Hinweis im Marker', pass: await map.getByText('Noch nicht online buchbar').isVisible() });
  await shot(map, 'verzeichnis-karte', false);
  rows.push({ name: 'Karte: keine JavaScript-Fehler', pass: mapErrors.length === 0, detail: mapErrors.join(' | ') });

  await browser.close();
  return report(rows);
});
