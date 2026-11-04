// Passwort vergessen: „Passwort vergessen?“ beim Anmelden und die Seite /passwort-neu aus der Mail.
//  - Backend nachgebildet (page.route, auch die Anmeldung unter /routes/anmeldung): kein Konto nötig, es wird kein
//    Passwort geändert und keine Mail verschickt. Geprüft wird, was die Seiten zeigen und was sie ans Backend schicken.
// Braucht: Entwicklungsserver (npm run dev). Die Mail selbst prüft backend/tests/test_password_reset.py, das Einlösen
// backend/tests/test_anmeldung.py.
const { BASE, launch, newPage, shot, collectErrors, report, run } = require('./lib.cjs');

const EMAIL = 'kim@salon-kaya.de';
const UID = 'konto-kim';

/** Anmeldung beantworten: Code GUT ist gültig, alles andere abgelaufen */
const mockAnmeldung = async (page, calls) => {
  let angemeldet = false;
  await page.route('**/routes/anmeldung/**', (route) => {
    const url = new URL(route.request().url());
    const pfad = url.pathname.replace('/routes/anmeldung/', '');
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ pfad, method: route.request().method(), code: url.searchParams.get('code') || body.code, body });
    const json = (status, data, code) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(data), headers: code ? { 'X-Anmeldung-Fehler': code } : {},
    });
    if (pfad === 'passwort-neu') {
      const code = url.searchParams.get('code') || body.code;
      return code === 'GUT' ? json(200, { email: EMAIL }) : json(400, { detail: 'Dieser Link ist abgelaufen.' }, 'auth/expired-action-code');
    }
    if (pfad === 'anmelden') {
      angemeldet = true;
      return json(200, { uid: UID, email: EMAIL, emailVerified: true });
    }
    if (pfad === 'ich') return angemeldet ? json(200, { uid: UID, email: EMAIL, emailVerified: true }) : json(401, { detail: 'nein' }, 'auth/unauthenticated');
    return json(200, { ok: true });
  });
};

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

run(async () => {
  const browser = await launch();
  const rows = [];

  // --- Anmelden: „Passwort vergessen?“ ---
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const backend = [];
  let answer = { status: 200, body: { status: 'verschickt' } };
  await mockAnmeldung(page, []);
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

  // Ohne Resend auf dem Server: Fehlermeldung statt stiller Erfolgsmeldung
  answer = { status: 200, body: { status: 'nicht_eingerichtet' } };
  await page.waitForTimeout(500);
  await forgot.click();
  await page.getByText('Der E-Mail-Versand ist gerade nicht eingerichtet').waitFor({ timeout: 10000 });
  rows.push({ name: 'Ohne Resend: Meldung sichtbar', pass: backend.length === 2 });

  // Zu oft: Meldung des Servers
  answer = { status: 429, body: { detail: 'Wir haben gerade erst eine E-Mail an diese Adresse geschickt.' } };
  await forgot.click();
  await page.getByText('Wir haben gerade erst eine E-Mail').waitFor({ timeout: 10000 });
  rows.push({ name: 'Zu oft: Meldung sichtbar', pass: backend.length === 3 });

  // --- /passwort-neu mit gültigem Code ---
  const neu = await newPage(browser);
  const neuErrors = collectErrors(neu);
  const calls = [];
  await mockAnmeldung(neu, calls);
  await neu.goto(`${BASE}/passwort-neu?code=GUT`, { waitUntil: 'domcontentloaded' });
  await neu.getByLabel('Neues Passwort').waitFor({ timeout: 15000 });
  rows.push({ name: 'Neu: Konto-Adresse sichtbar', pass: await neu.getByText(EMAIL).isVisible() });
  rows.push({ name: 'Neu: Code nur geprüft, nicht eingelöst', pass: calls.some((c) => c.pfad === 'passwort-neu' && c.method === 'GET' && c.code === 'GUT') && !calls.some((c) => c.pfad === 'passwort-neu' && c.method === 'POST') });
  rows.push({ name: 'Neu: Handy, nichts ragt heraus', pass: (await overflow(neu)) <= 0 });
  await shot(neu, 'passwort-neu');
  await neu.getByLabel('Neues Passwort').fill('kurz');
  await neu.getByRole('button', { name: 'Passwort speichern' }).click();
  await neu.waitForTimeout(500);
  rows.push({ name: 'Neu: unter 6 Zeichen nicht abgeschickt', pass: !calls.some((c) => c.pfad === 'passwort-neu' && c.method === 'POST') });
  await neu.getByLabel('Neues Passwort').fill('ganz-neues-Passwort-1');
  await neu.getByRole('button', { name: 'Passwort speichern' }).click();
  await neu.waitForURL((url) => !url.pathname.startsWith('/passwort-neu'), { timeout: 15000 }).catch(() => {});
  const saved = calls.find((c) => c.pfad === 'passwort-neu' && c.method === 'POST');
  rows.push({ name: 'Neu: Passwort mit Code gespeichert', pass: saved?.body.code === 'GUT' && saved?.body.passwort === 'ganz-neues-Passwort-1' });
  rows.push({ name: 'Neu: danach angemeldet', pass: calls.some((c) => c.pfad === 'anmelden' && c.body.passwort === 'ganz-neues-Passwort-1' && c.body.email === EMAIL) });
  rows.push({ name: 'Neu: Seite verlassen', pass: !new URL(neu.url()).pathname.startsWith('/passwort-neu'), detail: neu.url() });

  // --- abgelaufener Code und Link ohne Code ---
  const alt = await newPage(browser);
  const altErrors = collectErrors(alt);
  await mockAnmeldung(alt, []);
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
