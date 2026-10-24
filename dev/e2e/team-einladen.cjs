// Team einladen (Funde vom 20.10.2026), im Testladen durchgeklickt:
//  1. "Person anlegen" → Einladungslink: jeder neue Link ersetzt den alten, gespeichert ist nur ein Hash
//  2. E-Mail an eine Testadresse: ehrliche Meldung statt "versendet", Link trotzdem da
//  3. Gleiche E-Mail im selben Laden: klare Meldung; "Per E-Mail einladen" legt die Person wirklich an
//  4. Registrierung über den Link verbindet genau diesen Eintrag, "Mein Tag" erscheint
//  5. Kundenkonto mit derselben E-Mail: darf eingeladen werden und nimmt mit dem bestehenden Konto an
//  6. Ladenkonto kann fremde Einladung nicht annehmen
//  7. Deaktivieren sperrt "Mein Tag", Zurückholen gibt ihn wieder; E-Mail einer Deaktivierten: Hinweis aufs Zurückholen
//  8. Konto in zwei Läden: "Mein Tag" bietet die Ladenauswahl
// Braucht: Entwicklungsserver mit Backend ab diesem Stand (QME_BACKEND=https://q-me.spielmacherei.de) und Testdaten
// (python dev/fixtures.py anlegen). Räumt Personen, Zweitladen und die beiden Testkonten (…@example.com) selbst weg.
const { BASE, launch, newPage, collectErrors, fixture, signIn, report, run, shot } = require('./lib.cjs');

/** fn(fs, firestore, arg) im Browser ausführen – fs = Firestore-Funktionen der App, firestore = ihre Datenbank */
const db = (page, fn, arg) =>
  page.evaluate(
    async ([source, arg]) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      return (0, eval)(`(${source})`)(fs, firestore, arg);
    },
    [fn.toString(), arg],
  );

const TESTLADEN = 'Testladen (wird gleich gelöscht)';
const ok = (promise) => promise.then(() => true, () => false);
const tokenOf = (link) => new URL(link).searchParams.get('token');
const infoStatus = async (token) => {
  const r = await fetch(`${BASE}/routes/staff-invitation/${token}`);
  return r.status === 200 ? (await r.json()).status : r.status;
};

/** Team-Einträge dieses Laufs (Name endet auf "(Test)") */
const staffByName = (page, shopId, name) =>
  db(
    page,
    async (fs, firestore, { shopId, name }) => {
      const snap = await fs.getDocs(fs.query(fs.collection(firestore, 'staff'), fs.where('shopId', '==', shopId)));
      const d = snap.docs.find((x) => x.data().name === name);
      return d ? { id: d.id, ...d.data() } : null;
    },
    { shopId, name },
  );

/** Neues Konto im Browser anlegen (Kunde) oder null */
const newAccount = async (browser, email, role) => {
  const page = await newPage(browser);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const uid = await page.evaluate(
    async ({ email, role }) => {
      const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
      return (await registerWithRole(email, `Test-${Math.random().toString(36).slice(2)}`, role)).uid;
    },
    { email, role },
  );
  return { page, uid };
};

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
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const stamp = Date.now();
  const kimMail = `kim-${stamp}@example.com`;
  const kundeMail = `kunde-${stamp}@example.com`;
  const owner = await newPage(browser, { viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(owner);
  await signIn(owner, fx);
  const accountPages = [];
  let secondShop = null;

  // Backend mit dem Endpunkt? Sonst klar melden statt in Zeitüberschreitungen zu laufen
  const probe = await fetch(`${BASE}/routes/staff-invitation/0000000000000000ffff`).then((r) => r.json().catch(() => ({})), () => ({}));
  if (!/Einladungslink/.test(probe.detail || '')) {
    rows.push({ name: 'Backend kennt /routes/staff-invitation', pass: false, detail: 'Backend noch nicht ausgerollt? QME_BACKEND prüfen.' });
    await browser.close();
    return report(rows);
  }

  const team = async () => {
    await owner.goto(`${BASE}/staff-management`, { waitUntil: 'domcontentloaded' });
    await owner.getByRole('button', { name: 'Person anlegen' }).waitFor({ timeout: 15000 });
    await owner.getByRole('button', { name: 'Bearbeiten' }).first().waitFor({ timeout: 15000 });
  };
  const card = (name) => owner.locator('article', { has: owner.getByRole('heading', { name, exact: true }) });

  try {
    // ---------- 1./2. Person anlegen, Link, neuer Link, E-Mail an Testadresse ----------
    await team();
    await owner.getByRole('button', { name: 'Person anlegen' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Name').fill('Kim (Test)');
    await dlg.getByLabel(/^E-Mail/).fill(kimMail);
    await dlg.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const step2 = await ok(dlg.getByRole('heading', { name: 'Kim (Test) ist im Team.' }).waitFor({ timeout: 15000 }));
    const linkBox = dlg.getByTestId('invite-link');
    await dlg.getByRole('button', { name: 'Einladungslink erstellen' }).click();
    await linkBox.waitFor({ timeout: 15000 });
    const link1 = (await linkBox.innerText()).trim();
    await dlg.getByRole('button', { name: 'Neuen Link erstellen' }).click();
    await owner.waitForFunction((old) => document.querySelector('[data-testid="invite-link"]')?.textContent.trim() !== old, link1, { timeout: 15000 });
    const link2 = (await linkBox.innerText()).trim();
    await dlg.getByRole('button', { name: 'Neu per E-Mail schicken' }).click();
    const honest = await ok(dlg.getByText(/An Testadressen wie example\.com verschickt Dranzeit keine E-Mails/).waitFor({ timeout: 15000 }));
    await owner.waitForFunction((old) => document.querySelector('[data-testid="invite-link"]')?.textContent.trim() !== old, link2, { timeout: 15000 });
    const link3 = (await linkBox.innerText()).trim();
    await shot(owner, 'team-einladen-link', false);
    await dlg.getByRole('button', { name: 'Fertig' }).click();
    const kim = await staffByName(owner, fx.shopId, 'Kim (Test)');
    const t3 = tokenOf(link3);
    const status = [await infoStatus(tokenOf(link1)), await infoStatus(tokenOf(link2)), await infoStatus(t3)];
    const badge = await ok(card('Kim (Test)').getByText('Eingeladen', { exact: true }).waitFor({ timeout: 10000 }));
    rows.push(
      { name: 'Anlegen führt direkt zum Einladen', pass: step2 },
      { name: 'Link zeigt auf /staff-registration', pass: /\/staff-registration\?token=[\w-]{20,}$/.test(link3), detail: link3.replace(/token=.*/, 'token=…') },
      { name: 'Neuer Link ersetzt den alten', pass: status[0] === 404 && status[1] === 404 && status[2] === 'offen', detail: status.join(', ') },
      { name: 'Nur Hash gespeichert, kein Token', pass: !!kim?.inviteTokenHash && !JSON.stringify(kim).includes(t3) },
      { name: 'E-Mail-Fehler wird ehrlich gemeldet', pass: honest },
      { name: 'Team-Liste zeigt "Eingeladen"', pass: badge },
    );

    // ---------- 3. Gleiche E-Mail im selben Laden; "Per E-Mail einladen" ----------
    await owner.getByRole('button', { name: 'Person anlegen' }).click();
    await dlg.getByLabel('Name').fill('Kim doppelt (Test)');
    await dlg.getByLabel(/^E-Mail/).fill(kimMail.toUpperCase());
    await dlg.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const dupe = await ok(dlg.getByText('Kim (Test) hat diese E-Mail schon im Team.').waitFor({ timeout: 10000 }));
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(500);
    await owner.getByRole('button', { name: 'Per E-Mail einladen' }).click();
    await dlg.getByLabel('Name').fill('Mo (Test)');
    await dlg.getByLabel('E-Mail').fill(`mo-${stamp}@example.com`);
    await dlg.getByRole('button', { name: 'Einladung senden' }).click();
    const moDone = await ok(dlg.getByRole('heading', { name: 'Mo (Test) ist im Team.' }).waitFor({ timeout: 20000 }));
    const moHonest = await ok(dlg.getByText(/An Testadressen/).waitFor({ timeout: 5000 }));
    const moLink = await ok(dlg.getByTestId('invite-link').waitFor({ timeout: 5000 }));
    await shot(owner, 'team-per-email', false);
    await dlg.getByRole('button', { name: 'Fertig' }).click();
    const mo = await staffByName(owner, fx.shopId, 'Mo (Test)');
    rows.push(
      { name: 'Gleiche E-Mail im Laden: klare Meldung', pass: dupe },
      { name: 'Per E-Mail einladen legt Person an', pass: moDone && !!mo && mo.isActive === true && mo.serviceIds.length > 0 && mo.workingHours.length === 7 },
      { name: 'Per E-Mail: ehrliche Meldung und Link', pass: moHonest && moLink && !!mo?.inviteTokenHash },
    );

    // ---------- 4. Registrierung über den Link ----------
    const kimPage = await newPage(browser);
    accountPages.push(kimPage);
    await kimPage.goto(`${BASE}/staff-registration?token=${t3}`, { waitUntil: 'domcontentloaded' });
    const welcome = await ok(kimPage.getByRole('heading', { name: `Willkommen im Team von ${TESTLADEN}.` }).waitFor({ timeout: 15000 }));
    const prefilled = await kimPage.getByLabel('E-Mail').inputValue();
    await shot(kimPage, 'team-registrierung', false);
    await kimPage.getByLabel('Passwort', { exact: true }).fill(`Test-${Math.random().toString(36).slice(2)}`);
    await kimPage.getByRole('button', { name: 'Konto anlegen' }).click();
    const kimDay = await ok(kimPage.getByRole('button', { name: 'Meine Arbeitszeiten' }).waitFor({ timeout: 20000 }));
    const kimUid = await kimPage.evaluate(async () => (await import('/src/app/auth/firebase.ts')).firebaseAuth.currentUser?.uid);
    const kimAfter = await staffByName(owner, fx.shopId, 'Kim (Test)');
    // Profil liest nur das eigene Konto (firestore.rules)
    const kimProfile = await db(kimPage, async (fs, firestore, uid) => (await fs.getDoc(fs.doc(firestore, 'users', uid))).data() || null, kimUid);
    await owner.goto(`${BASE}/staff-registration?token=${t3}`, { waitUntil: 'domcontentloaded' });
    const already = await ok(owner.getByRole('heading', { name: 'Schon angenommen.' }).waitFor({ timeout: 15000 }));
    rows.push(
      { name: 'Link ohne Anmeldung: Laden und Formular', pass: welcome && prefilled === kimMail, detail: prefilled },
      { name: 'Konto anlegen führt zu Mein Tag', pass: kimDay && /employee-dashboard/.test(kimPage.url()) },
      { name: 'Genau dieser Eintrag ist verbunden', pass: !!kimUid && kimAfter?.userId === kimUid && kimProfile?.role === 'employee' },
      { name: 'Danach: Schon angenommen', pass: already },
    );

    // ---------- 5./6. Kundenkonto einladen; Ladenkonto darf nicht annehmen ----------
    const kunde = await newAccount(browser, kundeMail, 'customer');
    accountPages.push(kunde.page);
    await team();
    await owner.getByRole('button', { name: 'Person anlegen' }).click();
    await dlg.getByLabel('Name').fill('Kundin (Test)');
    await dlg.getByLabel(/^E-Mail/).fill(kundeMail);
    await dlg.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const customerAllowed = await ok(dlg.getByRole('heading', { name: 'Kundin (Test) ist im Team.' }).waitFor({ timeout: 15000 }));
    await dlg.getByRole('button', { name: 'Einladungslink erstellen' }).click();
    await dlg.getByTestId('invite-link').waitFor({ timeout: 15000 });
    const kundeToken = tokenOf((await dlg.getByTestId('invite-link').innerText()).trim());
    await dlg.getByRole('button', { name: 'Fertig' }).click();
    await owner.goto(`${BASE}/staff-registration?token=${kundeToken}`, { waitUntil: 'domcontentloaded' });
    await owner.getByRole('button', { name: 'Einladung annehmen' }).click();
    const ownerBlocked = await ok(owner.getByText(/Konto des Ladens/).waitFor({ timeout: 15000 }));
    await kunde.page.goto(`${BASE}/staff-registration?token=${kundeToken}`, { waitUntil: 'domcontentloaded' });
    await kunde.page.getByRole('button', { name: 'Einladung annehmen' }).click();
    const kundeDay = await ok(kunde.page.getByRole('button', { name: 'Meine Arbeitszeiten' }).waitFor({ timeout: 20000 }));
    const kundeProfile = await db(kunde.page, async (fs, firestore, uid) => (await fs.getDoc(fs.doc(firestore, 'users', uid))).data() || null, kunde.uid);
    const kundeNav = await kunde.page.getByRole('link', { name: 'Meine Termine' }).count();
    rows.push(
      { name: 'Kundenkonto-E-Mail darf eingeladen werden', pass: customerAllowed },
      { name: 'Ladenkonto kann nicht annehmen', pass: ownerBlocked },
      { name: 'Kundenkonto nimmt an, sieht Mein Tag', pass: kundeDay && kundeProfile?.role === 'employee' },
      { name: 'Meine Termine bleibt im Menü', pass: kundeNav > 0 },
    );

    // ---------- 7. Deaktivieren und zurückholen ----------
    await team();
    await card('Kim (Test)').getByRole('button', { name: 'Deaktivieren' }).click();
    await owner.getByRole('alertdialog').getByRole('button', { name: 'Deaktivieren' }).click();
    const listed = await ok(owner.getByText('Deaktiviert (1)').waitFor({ timeout: 15000 }));
    await kimPage.goto(`${BASE}/employee-dashboard`, { waitUntil: 'domcontentloaded' });
    const locked = await ok(kimPage.getByText('Noch mit keinem Laden verknüpft.').waitFor({ timeout: 15000 }));
    await owner.getByRole('button', { name: 'Person anlegen' }).click();
    await dlg.getByLabel('Name').fill('Kim neu (Test)');
    await dlg.getByLabel(/^E-Mail/).fill(kimMail);
    await dlg.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const hint = await ok(dlg.getByText(/ist deaktiviert\. Hol sie unten unter „Deaktiviert“ zurück/).waitFor({ timeout: 10000 }));
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(500);
    await owner.getByText('Deaktiviert (1)').click();
    await owner.getByRole('button', { name: 'Zurückholen' }).click();
    const back = await ok(card('Kim (Test)').waitFor({ timeout: 15000 }));
    await kimPage.goto(`${BASE}/employee-dashboard`, { waitUntil: 'domcontentloaded' });
    const unlocked = await ok(kimPage.getByRole('button', { name: 'Meine Arbeitszeiten' }).waitFor({ timeout: 20000 }));
    rows.push(
      { name: 'Deaktiviert steht in eigener Liste', pass: listed },
      { name: 'Deaktiviert: kein Mein Tag', pass: locked },
      { name: 'E-Mail einer Deaktivierten: Hinweis', pass: hint },
      { name: 'Zurückholen gibt Mein Tag wieder', pass: back && unlocked },
    );

    // ---------- 8. Konto in zwei Läden ----------
    secondShop = await db(
      owner,
      async (fs, firestore, { uid, email }) => {
        const now = fs.Timestamp.now();
        const shop = await fs.addDoc(fs.collection(firestore, 'shops'), { name: 'Zweitladen (Test)', owner: uid, createdAt: now, updatedAt: now });
        // Wie die App: E-Mail bei den Kontaktdaten des Ladens, nicht am öffentlichen Eintrag (firestore.rules)
        const { createStaff } = await import('/src/utils/firestore/staff.ts');
        const staff = await createStaff({ shopId: shop.id, name: 'Kim zwei (Test)', email, phone: '', role: '', userId: '', isActive: true, status: 'available', workingHours: [], serviceIds: [] });
        return { shopId: shop.id, staffId: staff.id };
      },
      { uid: fx.uid, email: kimMail },
    );
    const second = await owner.evaluate(async (staffId) => {
      const { createStaffInvite } = await import('/src/utils/staff-invitation.ts');
      return createStaffInvite(staffId);
    }, secondShop.staffId);
    await kimPage.goto(`${BASE}/staff-registration?token=${tokenOf(second.link)}`, { waitUntil: 'domcontentloaded' });
    await kimPage.getByRole('button', { name: 'Einladung annehmen' }).click();
    await kimPage.getByRole('button', { name: 'Meine Arbeitszeiten' }).waitFor({ timeout: 20000 });
    const picker = kimPage.getByRole('combobox', { name: 'Laden wählen' });
    const hasPicker = await ok(picker.waitFor({ timeout: 15000 }));
    const urlSecond = kimPage.url();
    let switched = false;
    if (hasPicker) {
      await picker.click();
      await kimPage.getByRole('option', { name: TESTLADEN }).click();
      switched = await ok(kimPage.waitForURL((u) => u.searchParams.get('staffId') === kimAfter.id, { timeout: 10000 }));
      await shot(kimPage, 'mein-tag-zwei-laeden', false);
    }
    rows.push(
      { name: 'Zweiter Laden: Annehmen öffnet ihn', pass: urlSecond.includes(`staffId=${secondShop.staffId}`), detail: urlSecond.replace(BASE, '') },
      { name: 'Mein Tag: Ladenauswahl, umschalten', pass: hasPicker && switched },
    );
  } finally {
    // Aufräumen: Personen dieses Laufs, Zweitladen, Testkonten
    await db(
      owner,
      async (fs, firestore, { shopId, second, uid }) => {
        const snap = await fs.getDocs(fs.query(fs.collection(firestore, 'staff'), fs.where('shopId', '==', shopId)));
        for (const d of snap.docs) if (/\(Test\)$/.test(d.data().name || '')) await fs.deleteDoc(d.ref);
        if (second) {
          await fs.deleteDoc(fs.doc(firestore, 'staff', second.staffId)).catch(() => {});
          // Laden löschen nur zusammen mit dem Vermerk in deleted_shops (firestore.rules)
          const batch = fs.writeBatch(firestore);
          batch.set(fs.doc(firestore, 'deleted_shops', second.shopId), { owner: uid, deletedAt: fs.Timestamp.now() });
          batch.delete(fs.doc(firestore, 'shops', second.shopId));
          await batch.commit().catch(() => {});
        }
      },
      { shopId: fx.shopId, second: secondShop, uid: fx.uid },
    ).catch((e) => console.log('Aufräumen unvollständig:', String(e).slice(0, 120)));
    for (const page of accountPages) await removeAccount(page);
  }

  rows.push({ name: 'Keine JavaScript-Fehler (Inhaber)', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
