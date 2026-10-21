// Passwort vergessen: „Passwort vergessen?“ beim Anmelden und die Seite /passwort-neu aus der Mail.
//  - Backend und Firebase-Anmeldung nachgebildet (page.route): kein Konto nötig, es wird kein Passwort geändert und
//    keine Mail verschickt. Geprüft wird, was die Seiten zeigen und was sie an Backend und Firebase schicken.
// Braucht: Entwicklungsserver (npm run dev). Die Mail selbst prüft backend/tests/test_password_reset.py.
const { BASE, launch, newPage, shot, collectErrors, report, run } = require('./lib.cjs');

const EMAIL = 'kim@salon-kaya.de';
const UID = 'konto-kim';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const TOKEN = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  iss: 'https://securetoken.google.com/qmedata-7c79e', aud: 'qmedata-7c79e', auth_time: now, user_id: UID, sub: UID,
  iat: now, exp: now + 3600, email: EMAIL, email_verified: true, firebase: { identities: { email: [EMAIL] }, sign_in_provider: 'password' },
})}.x`;

/** Firebase beantworten: Code GUT ist gültig, alles andere abgelaufen; Firestore gar nicht erst fragen */
const mockFirebase = async (page, calls) => {
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => {
    const url = route.request().url();
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ url, body });
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.includes('accounts:resetPassword')) {
      return body.oobCode === 'GUT'
        ? json(200, { email: EMAIL, requestType: 'PASSWORD_RESET' })
        : json(400, { error: { code: 400, message: 'EXPIRED_OOB_CODE' } });
    }
    if (url.includes('accounts:sendOobCode')) return json(200, { email: EMAIL });
    if (url.includes('accounts:lookup')) {
      return json(200, { users: [{ localId: UID, email: EMAIL, emailVerified: true, providerUserInfo: [{ providerId: 'password', email: EMAIL }] }] });
    }
    return json(200, { localId: UID, email: EMAIL, idToken: TOKEN, registered: true, refreshToken: 'r', expiresIn: '3600' });
  });
  await page.route('**/securetoken.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: TOKEN, id_token: TOKEN, expires_in: '3600', refresh_token: 'r', token_type: 'Bearer', user_id: UID }) }),
  );
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
};

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

run(async () => {
  const browser = await launch();
  const rows = [];

  // --- Anmelden: „Passwort vergessen?“ ---
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const firebase = [];
  const backend = [];
  let answer = { status: 200, body: { status: 'verschickt' } };
  await mockFirebase(page, firebase);
  await page.route('**/routes/password-reset', (route) => {
    backend.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-Mail').fill(` ${EMAIL} `);
  const forgot = page.getByRole('button', { name: 'Passwort vergessen?' });
  await forgot.click();
  await page.getByText('Wenn es ein Konto gibt, ist der Link unterwegs').waitFor({ timeout: 10000 });
  rows.push({ name: 'Vergessen: Adresse ans Backend', pass: backend.length === 1 && backend[0].email === EMAIL, detail: JSON.stringify(backend) });
  rows.push({ name: 'Vergessen: Firebase verschickt nichts', pass: !firebase.some((c) => c.url.includes('sendOobCode')) });

  // Ohne Resend auf dem Server: Firebase verschickt seine eigene Mail
  answer = { status: 200, body: { status: 'nicht_eingerichtet' } };
  await page.waitForTimeout(500);
  await forgot.click();
  await page.waitForTimeout(1500);
  const oob = firebase.filter((c) => c.url.includes('sendOobCode'));
  rows.push({ name: 'Ohne Resend: Firebase-Mail', pass: oob.length === 1 && oob[0].body.email === EMAIL && oob[0].body.requestType === 'PASSWORD_RESET' });

  // Zu oft: Meldung des Servers, keine Firebase-Mail
  answer = { status: 429, body: { detail: 'Wir haben gerade erst eine E-Mail an diese Adresse geschickt.' } };
  await forgot.click();
  await page.getByText('Wir haben gerade erst eine E-Mail').waitFor({ timeout: 10000 });
  rows.push({ name: 'Zu oft: Meldung sichtbar', pass: firebase.filter((c) => c.url.includes('sendOobCode')).length === 1 });

  // --- /passwort-neu mit gültigem Code ---
  const neu = await newPage(browser);
  const neuErrors = collectErrors(neu);
  const calls = [];
  await mockFirebase(neu, calls);
  await neu.goto(`${BASE}/passwort-neu?code=GUT`, { waitUntil: 'domcontentloaded' });
  await neu.getByLabel('Neues Passwort').waitFor({ timeout: 15000 });
  rows.push({ name: 'Neu: Konto-Adresse sichtbar', pass: await neu.getByText(EMAIL).isVisible() });
  rows.push({ name: 'Neu: Code nur geprüft, nicht eingelöst', pass: calls.filter((c) => c.url.includes('resetPassword')).every((c) => !c.body.newPassword) });
  rows.push({ name: 'Neu: Handy, nichts ragt heraus', pass: (await overflow(neu)) <= 0 });
  await shot(neu, 'passwort-neu');
  await neu.getByLabel('Neues Passwort').fill('kurz');
  await neu.getByRole('button', { name: 'Passwort speichern' }).click();
  await neu.waitForTimeout(500);
  rows.push({ name: 'Neu: unter 6 Zeichen nicht abgeschickt', pass: !calls.some((c) => c.body.newPassword) });
  await neu.getByLabel('Neues Passwort').fill('ganz-neues-Passwort-1');
  await neu.getByRole('button', { name: 'Passwort speichern' }).click();
  await neu.waitForURL((url) => !url.pathname.startsWith('/passwort-neu'), { timeout: 15000 }).catch(() => {});
  const saved = calls.find((c) => c.body.newPassword);
  rows.push({ name: 'Neu: Passwort mit Code gespeichert', pass: saved?.body.oobCode === 'GUT' && saved?.body.newPassword === 'ganz-neues-Passwort-1' });
  rows.push({ name: 'Neu: danach angemeldet', pass: calls.some((c) => c.url.includes('signInWithPassword') && c.body.password === 'ganz-neues-Passwort-1') });
  rows.push({ name: 'Neu: Seite verlassen', pass: !new URL(neu.url()).pathname.startsWith('/passwort-neu'), detail: neu.url() });

  // --- abgelaufener Code und Link ohne Code ---
  const alt = await newPage(browser);
  const altErrors = collectErrors(alt);
  await mockFirebase(alt, []);
  await alt.goto(`${BASE}/passwort-neu?code=ALT`, { waitUntil: 'domcontentloaded' });
  await alt.getByText('Dieser Link klappt nicht.').waitFor({ timeout: 15000 });
  rows.push({ name: 'Abgelaufen: Hinweis und Weg zurück', pass: await alt.getByRole('link', { name: 'Zum Anmelden' }).isVisible() });
  await shot(alt, 'passwort-neu-abgelaufen');
  await alt.goto(`${BASE}/passwort-neu`, { waitUntil: 'domcontentloaded' });
  await alt.getByText('Dieser Link klappt nicht.').waitFor({ timeout: 15000 });
  rows.push({ name: 'Ohne Code: Hinweis', pass: true });

  const all = [...errors, ...neuErrors, ...altErrors];
  rows.push({ name: 'Keine JavaScript-Fehler', pass: all.length === 0, detail: all.join(' | ') });
  await browser.close();
  return report(rows);
});
