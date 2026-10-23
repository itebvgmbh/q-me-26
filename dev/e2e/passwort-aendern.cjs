// Mein Profil → Passwort ändern (Wegwerf-Laden mit eigenem Konto, räumt sich selbst weg).
//  - falsches aktuelles Passwort und gleiches neues Passwort werden abgelehnt
//  - danach geht die Anmeldung nur noch mit dem neuen Passwort
//  - "Aktuelles Passwort vergessen?" fordert die Mail fürs eigene Konto an (Backend nachgebildet, keine echte Mail)
// Handy: kein waagrechtes Überlaufen. Foto: dev/out/passwort-aendern.png
const { BASE, launch, newPage, shot, collectErrors, tempShop, removeTempShop, report, run } = require('./lib.cjs');

/** Abmelden und mit E-Mail/Passwort neu anmelden; true, wenn es klappt */
const signInAgain = (page, email, pw) =>
  page.evaluate(
    async ({ email, pw }) => {
      const src = await (await fetch('/src/app/auth/firebase.ts')).text();
      const { signInWithEmailAndPassword, signOut } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      await signOut(firebaseAuth);
      try {
        await signInWithEmailAndPassword(firebaseAuth, email, pw);
        return true;
      } catch {
        return false;
      }
    },
    { email, pw },
  );

run(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const shop = await tempShop(page, 'Passwort (Test)');
  const newPw = `Neu-${Math.random().toString(36).slice(2)}`;
  const rows = [];
  let signedInWith = shop.pw;
  try {
    const resetBodies = [];
    await page.route('**/routes/password-reset', (route) => {
      resetBodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'verschickt' }) });
    });
    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
    const card = page.locator('section[aria-labelledby="passwort-aendern"]');
    await card.waitFor({ timeout: 20000 });
    const current = card.getByLabel('Aktuelles Passwort');
    const next = card.getByLabel('Neues Passwort');
    const submit = card.getByRole('button', { name: 'Passwort ändern' });
    const problem = async () => {
      await page.waitForTimeout(300);
      await card.getByRole('button', { name: 'Passwort ändern' }).waitFor();
      return (await card.locator('[role="alert"]').textContent().catch(() => '')) || '';
    };

    // 1. falsches aktuelles Passwort
    await current.fill('ganz-falsch-123');
    await next.fill(newPw);
    await submit.click();
    await page.waitForTimeout(2500);
    const wrong = await problem();
    rows.push({ name: 'falsches aktuelles Passwort abgelehnt', pass: wrong.includes('Das aktuelle Passwort stimmt nicht.'), detail: wrong });

    // 2. neues wie altes
    await current.fill(shop.pw);
    await next.fill(shop.pw);
    await submit.click();
    const same = await problem();
    rows.push({ name: 'gleiches Passwort abgelehnt', pass: same.includes('dasselbe wie das alte'), detail: same });

    // 3. ändern
    await current.fill(shop.pw);
    await next.fill(newPw);
    await submit.click();
    const toast = await page.getByText('Dein Passwort ist geändert.').waitFor({ timeout: 15000 }).then(() => true, () => false);
    rows.push({ name: 'Passwort geändert, Meldung kommt', pass: toast });
    rows.push({ name: 'Felder danach leer', pass: (await current.inputValue()) === '' && (await next.inputValue()) === '' });
    await shot(page, 'passwort-aendern');

    // 4. vergessen? → Mail fürs eigene Konto
    await card.getByRole('button', { name: 'Aktuelles Passwort vergessen?' }).click();
    const mailToast = await page.getByText(/Wir haben dir eine E-Mail an/).waitFor({ timeout: 10000 }).then(() => true, () => false);
    rows.push({ name: '"vergessen?" fordert Mail fürs Konto an', pass: mailToast && resetBodies.length === 1 && resetBodies[0].email === shop.email, detail: JSON.stringify(resetBodies) });

    // 5. Handy
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    rows.push({ name: 'Handy: kein waagrechtes Überlaufen', pass: overflow <= 0, detail: `${overflow}px` });

    // 6. Anmelden: alt nein, neu ja
    const oldOk = await signInAgain(page, shop.email, shop.pw);
    const newOk = await signInAgain(page, shop.email, newPw);
    if (newOk) signedInWith = newPw;
    rows.push({ name: 'altes Passwort geht nicht mehr', pass: oldOk === false });
    rows.push({ name: 'neues Passwort geht', pass: newOk === true });

    rows.push({ name: 'keine JS-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  } finally {
    // removeTempShop löscht das Konto und braucht dafür eine frische Anmeldung
    await signInAgain(page, shop.email, signedInWith);
    await removeTempShop(page, shop);
    await browser.close();
  }
  return report(rows);
});
