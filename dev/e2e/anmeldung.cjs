// Eigene Anmeldung im Browser (frontend/src/app/auth/konto.ts, Backend app/apis/anmeldung; requirements/eigene-datenbank.md
// Stufe 4). Ohne Testkonto: Das Backend ist nachgestellt (page.route). Geprüft:
//  - Anmelden über das Formular: E-Mail und Passwort gehen an /routes/anmeldung/anmelden, danach geht es weiter.
//  - Falsches Passwort: die übersetzte Meldung zum Code aus X-Anmeldung-Fehler.
//  - Nach dem Neuladen weiß die Seite sofort, wer angemeldet ist (gemerkter Stand), und fragt /ich nach.
//  - Meldet das Backend 401 (Sitzung abgelaufen), gilt man als abgemeldet.
//  - Endet die Sitzung bei offenem Tab: Nach einer 401 eines Backend-Aufrufs oder wenn der Tab wieder nach vorn kommt,
//    fragt die Seite /ich nach und schickt zum Anmelden (statt weiter „angemeldet“ und „Not authenticated“).
//  - Abmelden schickt /abmelden; kein Aufruf an Google.
// Braucht: Entwicklungsserver (npm run dev).
const { BASE, launch, newPage, collectErrors, report, run } = require('./lib.cjs');

const EMAIL = 'kim@salon-kaya.de';
const KONTO = { uid: 'kontoKim', email: EMAIL, emailVerified: true, displayName: null };

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const anfragen = [];
  const google = [];
  let sitzung = false;
  page.on('request', (r) => { if (/googleapis|firebaseapp|gstatic\.com\/firebasejs/.test(r.url())) google.push(r.url()); });

  await page.route('**/routes/anmeldung/**', (route) => {
    const req = route.request();
    const pfad = new URL(req.url()).pathname.replace('/routes/anmeldung/', '');
    const body = JSON.parse(req.postData() || '{}');
    anfragen.push({ pfad, body, origin: req.headers().origin || '' });
    const json = (status, data, code) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(data), headers: code ? { 'X-Anmeldung-Fehler': code } : {},
    });
    if (pfad === 'anmelden') {
      if (body.passwort !== 'richtig123') return json(400, { detail: 'E-Mail oder Passwort stimmen nicht.' }, 'auth/invalid-credential');
      sitzung = true;
      return json(200, KONTO);
    }
    if (pfad === 'ich') return sitzung ? json(200, KONTO) : json(401, { detail: 'Du bist nicht angemeldet.' }, 'auth/unauthenticated');
    if (pfad === 'abmelden') {
      sitzung = false;
      return json(200, { ok: true });
    }
    return json(404, { detail: 'unbekannt' });
  });
  await page.route('**/routes/konto/profil', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profil: { id: 'kontoKim', email: EMAIL, role: 'customer' } }) }),
  );
  // Irgendein geschützter Aufruf: 401, sobald die Sitzung weg ist
  await page.route('**/routes/konto/termine*', (route) =>
    route.fulfill(sitzung
      ? { status: 200, contentType: 'application/json', body: JSON.stringify({ termine: [] }) }
      : { status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }),
  );
  const anmeldenUndOeffnen = async () => {
    await page.evaluate(async () => {
      const { signInWithEmailAndPassword, anmeldung } = await import('/src/app/auth/konto.ts');
      await signInWithEmailAndPassword(anmeldung, 'kim@salon-kaya.de', 'richtig123');
    });
    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return new URL(page.url()).pathname === '/profile';
  };
  const zumAnmelden = async () => {
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 12000 }).catch(() => {});
    const url = new URL(page.url());
    return { pass: url.pathname === '/login' && url.searchParams.get('next') === '/profile', detail: page.url() };
  };

  await page.goto(`${BASE}/login?next=/profile`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-Mail').fill(EMAIL);
  await page.getByLabel('Passwort', { exact: true }).fill('falsch');
  await page.getByRole('button', { name: 'Anmelden' }).last().click();
  await page.getByText('E-Mail oder Passwort stimmen nicht.').waitFor({ timeout: 10000 });
  rows.push({ name: 'Falsch: Meldung zum Code', pass: true });
  const erster = anfragen.find((a) => a.pfad === 'anmelden');
  rows.push({ name: 'Anmelden: E-Mail und Passwort ans Backend', pass: erster?.body.email === EMAIL && erster?.body.passwort === 'falsch', detail: JSON.stringify(erster?.body) });

  await page.getByLabel('Passwort', { exact: true }).fill('richtig123');
  await page.getByRole('button', { name: 'Anmelden' }).last().click();
  await page.waitForURL((url) => url.pathname === '/profile', { timeout: 15000 }).catch(() => {});
  rows.push({ name: 'Richtig: weiter zu ?next', pass: new URL(page.url()).pathname === '/profile', detail: page.url() });

  const gemerkt = await page.evaluate(() => JSON.parse(localStorage.getItem('dranzeit.konto') || 'null'));
  rows.push({ name: 'Stand gemerkt (ohne Geheimnis)', pass: gemerkt?.uid === 'kontoKim' && Object.keys(gemerkt).sort().join() === 'displayName,email,emailVerified,uid', detail: JSON.stringify(gemerkt) });

  // Neu laden: sofort angemeldet, /ich wird nachgefragt
  const vorher = anfragen.filter((a) => a.pfad === 'ich').length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ich = await page.evaluate(async () => (await import('/src/app/auth/konto.ts')).anmeldung.currentUser?.uid ?? null);
  rows.push({ name: 'Neu geladen: angemeldet, /ich nachgefragt', pass: ich === 'kontoKim' && anfragen.filter((a) => a.pfad === 'ich').length > vorher });

  // Sitzung abgelaufen: Backend sagt 401 → abgemeldet
  sitzung = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const danach = await page.evaluate(async () => ({
    uid: (await import('/src/app/auth/konto.ts')).anmeldung.currentUser?.uid ?? null,
    gemerkt: localStorage.getItem('dranzeit.konto'),
  }));
  rows.push({ name: '401: abgemeldet, nichts mehr gemerkt', pass: danach.uid === null && danach.gemerkt === null, detail: JSON.stringify(danach) });
  rows.push({ name: 'Geschützte Seite: weiter zum Anmelden', pass: new URL(page.url()).pathname === '/login', detail: page.url() });

  // Sitzung endet bei offenem Tab: die nächste 401 eines Backend-Aufrufs schickt zum Anmelden
  const offen = await anmeldenUndOeffnen();
  sitzung = false;
  await page.evaluate(() => fetch('/routes/konto/termine').then((r) => r.status).catch(() => null));
  const nach401 = await zumAnmelden();
  rows.push({ name: 'Offener Tab, Sitzung weg: 401 → zum Anmelden', pass: offen && nach401.pass, detail: nach401.detail });

  // … oder wenn der Tab wieder nach vorn kommt
  const offen2 = await anmeldenUndOeffnen();
  sitzung = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const nachVorn = await zumAnmelden();
  rows.push({ name: 'Tab wieder vorn, Sitzung weg: zum Anmelden', pass: offen2 && nachVorn.pass, detail: nachVorn.detail });

  // Sitzung gilt noch: eine 401 ändert nichts (nur nachgefragt)
  const offen3 = await anmeldenUndOeffnen();
  const ichVorher = anfragen.filter((a) => a.pfad === 'ich').length;
  await page.route('**/routes/team/ich/laeden', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }));
  await page.evaluate(() => fetch('/routes/team/ich/laeden').catch(() => null));
  await page.waitForTimeout(6000);
  rows.push({
    name: 'Sitzung gilt: 401 fragt nach, bleibt angemeldet',
    pass: offen3 && new URL(page.url()).pathname === '/profile' && anfragen.filter((a) => a.pfad === 'ich').length > ichVorher,
    detail: page.url(),
  });

  // Wieder an, dann abmelden
  await page.evaluate(async () => {
    const { signInWithEmailAndPassword, anmeldung } = await import('/src/app/auth/konto.ts');
    await signInWithEmailAndPassword(anmeldung, 'kim@salon-kaya.de', 'richtig123');
  });
  await page.evaluate(async () => (await import('/src/app/auth/konto.ts')).signOut());
  const ab = anfragen.filter((a) => a.pfad === 'abmelden');
  rows.push({ name: 'Abmelden: /abmelden geschickt', pass: ab.length === 1 && ab[0].origin.startsWith('http') });
  rows.push({ name: 'Kein Aufruf an Google/Firebase', pass: google.length === 0, detail: google.slice(0, 3).join(' ') });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
