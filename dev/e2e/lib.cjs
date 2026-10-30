// Gemeinsame Einstellungen der Testskripte (siehe dev/README.md)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Adresse der App: Entwicklungsserver (npm run dev) oder Vorschau des Builds (npm run preview → :4173)
const BASE = (process.env.QME_URL || 'http://localhost:5173').replace(/\/$/, '');
// Laden für die Durchläufe: ITEBV GmbH (Testbetrieb)
const SHOP_ID = process.env.QME_SHOP_ID || 'zNS505OFvKZpFaR1vTdN';
const OUT = path.join(__dirname, '..', 'out');
const FIXTURE = path.join(__dirname, '..', '.local', 'fixture.json');

/** Browser starten; QME_BROWSER_ARGS z. B. für Proxys in Cloud-Umgebungen */
const launch = () => chromium.launch({ args: (process.env.QME_BROWSER_ARGS || '').split(' ').filter(Boolean) });

/** Neue Seite in deutscher Zeit; Handygröße, wenn nichts anderes angegeben */
const newPage = async (browser, options = {}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Berlin', locale: 'de-DE', ...options });
  // „Wofür nutzt du dieses Gerät?“ (frontend/src/utils/geraet.ts) nicht fragen – sonst liegt der Dialog über dem Tresen
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('dranzeit-geraet-spaeter', '1');
    } catch {
      /* about:blank */
    }
  });
  return context.newPage();
};

/** "2026-10-19T11:50" als deutsche Ortszeit (Sommer-/Winterzeit richtig), egal in welcher Zeitzone dieser Rechner läuft */
const berlin = (local) => {
  const guess = new Date(`${local}Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value; // z. B. "GMT+2"
  const [, sign, hours, minutes] = name.match(/GMT([+-])(\d+)(?::(\d+))?/) || [null, '+', '0', '0'];
  const offset = (Number(hours) * 60 + Number(minutes || 0)) * (sign === '-' ? -1 : 1);
  return new Date(guess.getTime() - offset * 60000);
};

/** Bildschirmfoto nach dev/out/<name>.png */
const shot = (page, name, fullPage = true) => {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
};

/** JavaScript-Fehler der Seite sammeln */
const collectErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  return errors;
};

/** Testdaten aus dev/fixtures.py (Laden, Person, Pausen, Termin) */
const fixture = () => {
  if (!fs.existsSync(FIXTURE)) {
    console.error('Keine Testdaten. Erst anlegen:  python dev/fixtures.py anlegen');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
};

/** Im Browser mit E-Mail und Passwort anmelden (Firebase der App, ohne Formular) */
const signIn = async (page, account) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (account) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, account.email, account.pw);
  }, account);
};

/** Nächster Montag nach heute (deutsche Zeit) als "YYYY-MM-DD" – wie in fixtures.py */
const nextMonday = () => {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())}T12:00:00Z`);
  const weekday = (today.getUTCDay() + 6) % 7; // Montag = 0
  today.setUTCDate(today.getUTCDate() + (7 - weekday || 7));
  return today.toISOString().slice(0, 10);
};

/**
 * Wegwerf-Laden mit eigenem Inhaber-Konto, danach in page angemeldet (eigener Browser-Kontext, newPage). Aufbau wie
 * der Testladen aus fixtures.py: Mo–Fr 9–17 Uhr, Person Robin Mo–Sa 8–18 Uhr, Leistung Schnitt 30 Minuten.
 * Für Tarif-Stände, die nur das Backend ändern darf (firestore.rules): Die gibt es nur beim Anlegen und nur zum
 * eigenen Nachteil – state.trialEndsAt (Date, Testphase vorbei) oder state.suspended (gesperrt).
 * Rückgabe wie fixture(): { email, pw, uid, shopId, staffId, serviceId, monday }. Wieder weg mit removeTempShop.
 */
const tempShop = async (page, name, state = {}) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const shop = await page.evaluate(
    async ({ name, trialEndsAt, suspended }) => {
      const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const email = `q-me-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
      const pw = `Test-${Math.random().toString(36).slice(2)}`;
      const { uid } = await registerWithRole(email, pw, 'shopOwner');
      const now = fs.Timestamp.now();
      const days = [0, 1, 2, 3, 4, 5, 6];
      const ref = await fs.addDoc(fs.collection(firestore, 'shops'), {
        name, owner: uid, phone: '1', email, createdAt: now, updatedAt: now,
        businessHoursByDay: days.map((d) => ({ dayOfWeek: d, isOpen: d >= 1 && d <= 5, openTime: '09:00', closeTime: '17:00', breaks: [] })),
        ...(trialEndsAt ? { trialEndsAt: fs.Timestamp.fromMillis(trialEndsAt) } : {}),
        ...(suspended ? { suspended: { at: now } } : {}),
      });
      const service = await fs.addDoc(fs.collection(firestore, 'services'), { shopId: ref.id, name: 'Schnitt', duration: 30, price: 20, createdAt: now, updatedAt: now });
      // E-Mail der Person bei den Kontaktdaten des Ladens (nur Inhaber), wie createStaff in der App
      const { createStaff } = await import('/src/utils/firestore/staff.ts');
      const staff = await createStaff({
        shopId: ref.id, name: 'Robin', email: 'robin@example.com', phone: '', role: 'staff', serviceIds: [service.id], isActive: true,
        status: 'available', userId: '',
        workingHours: days.map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '18:00', isWorking: d !== 0 })),
      });
      return { email, pw, uid, shopId: ref.id, staffId: staff.id, serviceId: service.id };
    },
    { name, trialEndsAt: state.trialEndsAt ? state.trialEndsAt.getTime() : null, suspended: Boolean(state.suspended) },
  );
  return { ...shop, monday: nextMonday() };
};

/** Wegwerf-Laden samt Konto wieder löschen (page: dieselbe Seite wie bei tempShop, noch angemeldet) */
const removeTempShop = (page, shop) =>
  page.evaluate(async ({ shopId, uid }) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    // Termine vor ihren Kurzfassungen: die darf erst weg, wenn der Termin weg ist (firestore.rules)
    for (const coll of ['appointments', 'public_appointments', 'earlier_slot_notifications', 'services', 'staff', 'customers', 'breaks', 'recurring-breaks', 'schedules', 'shop_days']) {
      const snap = await fs.getDocs(fs.query(fs.collection(firestore, coll), fs.where('shopId', '==', shopId)));
      for (const d of snap.docs) await fs.deleteDoc(d.ref);
    }
    for (const d of (await fs.getDocs(fs.collection(firestore, 'shops', shopId, 'staff_contacts'))).docs) await fs.deleteDoc(d.ref);
    // Laden löschen geht nur mit Vermerk in deleted_shops im selben Schritt (firestore.rules)
    const batch = fs.writeBatch(firestore);
    batch.set(fs.doc(firestore, 'deleted_shops', shopId), { owner: uid, deletedAt: fs.Timestamp.now() });
    batch.delete(fs.doc(firestore, 'shops', shopId));
    await batch.commit();
    await fs.deleteDoc(fs.doc(firestore, 'users', uid));
    await firebaseAuth.currentUser.delete();
  }, shop);

/** Ergebnisliste ausgeben; Rückgabe true, wenn alles passt */
const report = (rows) => {
  let ok = true;
  for (const { name, pass, detail } of rows) {
    ok = ok && pass;
    console.log(`${pass ? 'OK  ' : 'FEHL'} ${name.padEnd(40)} ${detail ?? ''}`);
  }
  console.log(ok ? 'Alles bestanden.' : 'Es gibt Fehler.');
  return ok;
};

/** Skript ausführen; Exit-Code 1 bei Fehler oder false */
const run = (fn) =>
  fn()
    .then((ok) => process.exit(ok === false ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });

// --- Anmeldung nachgebildet: kein Testkonto nötig, Firestore wird nicht gefragt ---------------------------------------

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

module.exports = { BASE, SHOP_ID, OUT, berlin, launch, newPage, shot, collectErrors, fixture, signIn, mockAuth, signInFake, tempShop, removeTempShop, report, run };
