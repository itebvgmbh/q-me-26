// E-Mail-Adresse bestätigen (20.10.2026):
//  1. Registrieren über das Formular: Konto da, an Testadressen (example.com) geht keine Mail und kein falscher Hinweis
//  2. Mein Profil: "noch nicht bestätigt", Knopf "Bestätigungs-Mail noch mal schicken" meldet ehrlich, was passiert
//  3. /email-bestaetigen ohne oder mit ungültigem Code (echte Firebase-Antwort): "Dieser Link klappt nicht."
//  4. Gültiger Code (Firebase nachgebildet): "Bestätigt.", danach zeigt das Profil "E-Mail-Adresse bestätigt"
//  5. Ohne Anmeldung: Backend lehnt ab
//  6. Mit QME_RESEND_TEST=1 zusätzlich echter Versand an Resends Testpostfach delivered+…@resend.dev
//     (braucht RESEND_API_KEY und eine bei Resend bestätigte Absender-Domain auf dem Server)
// Braucht: Entwicklungsserver mit Backend ab diesem Stand (QME_BACKEND=https://q-me.spielmacherei.de). Keine Testdaten nötig.
// Räumt die Testkonten selbst wieder weg.
const { BASE, launch, newPage, collectErrors, report, run, shot } = require('./lib.cjs');

const ok = (promise) => promise.then(() => true, () => false);

/** Angemeldetes Testkonto samt Profil löschen */
const removeAccount = (page) =>
  page
    .evaluate(async () => {
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const user = firebaseAuth.currentUser;
      if (!user) return;
      await fs.deleteDoc(fs.doc(firestore, 'users', user.uid)).catch(() => {});
      await user.delete();
    })
    .catch((e) => console.log('Testkonto nicht gelöscht:', String(e).slice(0, 120)));

run(async () => {
  const browser = await launch();
  const rows = [];
  const stamp = Date.now();
  const mail = `bestaetigen-${stamp}@example.com`;
  const pw = `Test-${Math.random().toString(36).slice(2)}`;

  // Backend mit dem Endpunkt? Ohne Anmeldung muss es 401 sagen, nicht 404
  const probe = await fetch(`${BASE}/routes/email-verification`, { method: 'POST' }).then((r) => r.status, () => 0);
  rows.push({ name: 'Ohne Anmeldung: Backend lehnt ab', pass: probe === 401 || probe === 403, detail: probe === 404 ? 'Backend noch nicht ausgerollt? QME_BACKEND prüfen.' : `HTTP ${probe}` });
  if (probe === 404 || probe === 0) {
    await browser.close();
    return report(rows);
  }

  const page = await newPage(browser);
  const errors = collectErrors(page);
  let extra = null;
  try {
    // ---------- 1. Registrieren ----------
    await page.goto(`${BASE}/register-customer`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('E-Mail').fill(mail);
    await page.getByLabel('Passwort', { exact: true }).fill(pw);
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const registered = await ok(page.waitForURL(/\/my-bookings/, { timeout: 20000 }));
    await page.waitForTimeout(2500);
    const falseHint = await page.getByText(/Wir haben dir eine E-Mail an/).count();
    rows.push(
      { name: 'Registrieren klappt', pass: registered, detail: page.url().replace(BASE, '') },
      { name: 'Kein "E-Mail geschickt" bei Testadresse', pass: falseHint === 0 },
    );

    // ---------- 2. Profil ----------
    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
    const note = page.getByTestId('email-unbestaetigt');
    const shown = await ok(note.waitFor({ timeout: 15000 }));
    const customerText = shown && /Kundenliste/.test(await note.innerText());
    await note.getByRole('button', { name: 'Bestätigungs-Mail noch mal schicken' }).click();
    const honest = await ok(note.getByText(/An Testadressen wie example\.com verschickt Dranzeit keine E-Mails/).waitFor({ timeout: 15000 }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, 'email-bestaetigen-profil-handy');
    rows.push(
      { name: 'Profil: "noch nicht bestätigt"', pass: shown },
      { name: 'Profil: Hinweis für Kunden', pass: customerText },
      { name: 'Noch mal schicken: ehrliche Meldung', pass: honest },
      { name: 'Profil am Handy ohne Überlauf', pass: overflow <= 0, detail: overflow > 0 ? `${overflow}px` : '' },
    );

    // ---------- 3. Link ohne / mit ungültigem Code ----------
    await page.goto(`${BASE}/email-bestaetigen`, { waitUntil: 'domcontentloaded' });
    const noCode = await ok(page.getByRole('heading', { name: 'Dieser Link klappt nicht.' }).waitFor({ timeout: 15000 }));
    await page.goto(`${BASE}/email-bestaetigen?code=gibts-nicht-${stamp}`, { waitUntil: 'domcontentloaded' });
    const badCode = await ok(page.getByRole('heading', { name: 'Dieser Link klappt nicht.' }).waitFor({ timeout: 15000 }));
    const toProfile = badCode && (await page.getByRole('link', { name: 'Zu meinem Profil' }).count()) === 1;
    await shot(page, 'email-bestaetigen-ungueltig');
    rows.push(
      { name: 'Link ohne Code: klare Meldung', pass: noCode },
      { name: 'Ungültiger Code: klare Meldung', pass: badCode },
      { name: 'Angemeldet: Weg ins Profil', pass: toProfile },
    );

    // ---------- 4. Gültiger Code (Firebase nachgebildet) ----------
    // applyActionCode → accounts:update; danach liest reload() das Konto (accounts:lookup) – beides als "bestätigt"
    let applied = '';
    await page.route('**/identitytoolkit.googleapis.com/v1/accounts:update**', async (route) => {
      applied = JSON.parse(route.request().postData() || '{}').oobCode || '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'identitytoolkit#SetAccountInfoResponse', email: mail, emailVerified: true }) });
    });
    await page.route('**/identitytoolkit.googleapis.com/v1/accounts:lookup**', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const u of body.users || []) u.emailVerified = true;
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });
    await page.goto(`${BASE}/email-bestaetigen?code=GUELTIG-${stamp}`, { waitUntil: 'domcontentloaded' });
    const success = await ok(page.getByRole('heading', { name: 'Bestätigt.' }).waitFor({ timeout: 15000 }));
    await shot(page, 'email-bestaetigen-erfolg');
    await page.getByRole('link', { name: 'Zu meinem Profil' }).click();
    const verifiedInProfile = await ok(page.getByTestId('email-bestaetigt').waitFor({ timeout: 15000 }));
    rows.push(
      { name: 'Gültiger Code: "Bestätigt."', pass: success },
      { name: 'Code einmal an Firebase', pass: applied === `GUELTIG-${stamp}`, detail: applied ? '' : 'nicht gesendet' },
      { name: 'Profil danach: bestätigt', pass: verifiedInProfile },
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // ---------- 6. Echter Versand an Resends Testpostfach ----------
    if (process.env.QME_RESEND_TEST === '1') {
      extra = await newPage(browser);
      await extra.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await extra.waitForTimeout(2500);
      const result = await extra.evaluate(
        async ({ email, pw }) => {
          const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
          const { sendVerificationMail } = await import('/src/utils/email-verification.ts');
          await registerWithRole(email, pw, 'customer');
          try {
            return await sendVerificationMail();
          } catch (e) {
            return { status: 'fehler', email: String(e.message || e) };
          }
        },
        { email: `delivered+dranzeit-${stamp}@resend.dev`, pw },
      );
      rows.push({ name: 'Echter Versand über Resend', pass: result.status === 'verschickt', detail: `${result.status} ${result.email}` });
    }
  } finally {
    rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
    await removeAccount(page);
    if (extra) await removeAccount(extra);
    await browser.close();
  }
  return report(rows);
});
