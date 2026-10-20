// Funde aus dem Onboarding-Check vom 20.10.2026, im Testladen durchgeklickt:
//  1. Leistung löschen: Rückfrage nennt kommende Termine, Leistung verschwindet aus Buchung und Nummer ziehen,
//     bleibt in der Datenbank (archived) und lässt sich zurückholen
//  2. Ladenauswahl unter "Leistungen" und "Mein Laden" (zweiter Laden des Testkontos, ?shopId=)
//  3. Vorlaufzeit für Online-Termine: im Formular als Zahl gespeichert, Online-Zeiten und Speichern beachten sie,
//     Nummer ziehen (frühester Platz) nicht
//  4. "Kunde anlegen" in Mein Tag: Link bleibt sichtbar, in der Datenbank steht nur sein Hash, gleiche E-Mail gibt
//     einen neuen Link (der alte gilt nicht mehr), /activate verbindet ein Kundenkonto, Termine wandern mit
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://q-me.spielmacherei.de) und Testdaten
// (python dev/fixtures.py anlegen). Teil 4 braucht das Backend mit POST /routes/customer-activation (ab diesem Stand).
// Räumt Zweitladen, Testperson, Vorlaufzeit und Kundenkonto selbst weg; Kunden, Termine und Leistungen im
// Testladen löscht python dev/fixtures.py loeschen.
const { createHash } = require('crypto');
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

/** Termine der Testkundin "Kim Test" löschen – die Regeltests erwarten Montag 14:00 frei */
const removeKim = (page, shopId) =>
  db(
    page,
    async (fs, firestore, shopId) => {
      const snap = await fs.getDocs(fs.query(fs.collection(firestore, 'appointments'), fs.where('shopId', '==', shopId)));
      for (const d of snap.docs) if (d.data().customerName === 'Kim Test') await fs.deleteDoc(d.ref);
    },
    shopId,
  );

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const owner = await newPage(browser, { viewport: { width: 1280, height: 800 } });
  const errors = collectErrors(owner);
  await signIn(owner, fx);
  const row = (page, name) => page.locator('li', { has: page.getByText(name, { exact: true }) });

  // ---------- 1. Leistung löschen ----------
  const bartId = await db(
    owner,
    async (fs, firestore, shopId) => {
      // Rest eines abgebrochenen Laufs weg
      const old = await fs.getDocs(fs.query(fs.collection(firestore, 'services'), fs.where('shopId', '==', shopId)));
      for (const d of old.docs) if (d.data().name === 'Bart (Test)') await fs.deleteDoc(d.ref);
      const ref = fs.doc(fs.collection(firestore, 'services'));
      const now = fs.Timestamp.now();
      await fs.setDoc(ref, { id: ref.id, shopId, name: 'Bart (Test)', duration: 20, price: 15, createdAt: now, updatedAt: now });
      return ref.id;
    },
    fx.shopId,
  );
  await owner.goto(`${BASE}/service-management?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  await row(owner, 'Bart (Test)').waitFor({ timeout: 15000 });
  const dialog = owner.getByRole('alertdialog');
  // "Schnitt" hat den Termin am Montag: Rückfrage nennt ihn, Abbrechen ändert nichts
  await row(owner, 'Schnitt').getByRole('button', { name: 'Löschen' }).click();
  await dialog.getByText(/kommender? Termin/).waitFor({ timeout: 10000 });
  const schnittDialog = (await dialog.innerText()).replace(/\s+/g, ' ');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await row(owner, 'Bart (Test)').getByRole('button', { name: 'Löschen' }).click();
  await dialog.getByText(/kein kommender Termin/).waitFor({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  const archivedShown = await owner.getByText('Gelöschte Leistungen (1)').waitFor({ timeout: 10000 }).then(() => true, () => false);
  const bartStillEditable = await row(owner, 'Bart (Test)').getByRole('button', { name: 'Bearbeiten' }).count();
  await shot(owner, 'leistungen-geloescht', false);
  const archivedDoc = await db(owner, async (fs, firestore, id) => (await fs.getDoc(fs.doc(firestore, 'services', id))).data() || null, bartId);
  const schnittDoc = await db(owner, async (fs, firestore, id) => (await fs.getDoc(fs.doc(firestore, 'services', id))).data() || null, fx.serviceId);

  const guest = await newPage(browser);
  await guest.goto(`${BASE}/book-appointment?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  await guest.getByText('Schnitt', { exact: true }).first().waitFor({ timeout: 20000 });
  const bookText = await guest.locator('main').innerText();
  await guest.goto(`${BASE}/public-join-queue?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  await guest.getByText('Schnitt', { exact: true }).first().waitFor({ timeout: 20000 });
  const queueText = await guest.locator('main').innerText();

  await owner.getByText('Gelöschte Leistungen (1)').click();
  await row(owner, 'Bart (Test)').getByRole('button', { name: 'Zurückholen' }).click();
  const restored = await row(owner, 'Bart (Test)').getByRole('button', { name: 'Bearbeiten' }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  const restoredDoc = await db(owner, async (fs, firestore, id) => (await fs.getDoc(fs.doc(firestore, 'services', id))).data() || null, bartId);
  await db(owner, async (fs, firestore, id) => fs.deleteDoc(fs.doc(firestore, 'services', id)), bartId);
  rows.push(
    { name: 'Löschen fragt nach, nennt kommenden Termin', pass: /(Ein kommender Termin ist|\d+ kommende Termine sind) damit gebucht/.test(schnittDialog), detail: schnittDialog.slice(0, 90) },
    { name: 'Abbrechen löscht nichts', pass: schnittDoc && !schnittDoc.archived },
    { name: 'Gelöschte Leistung nicht mehr in der Liste', pass: archivedShown && bartStillEditable === 0 },
    { name: 'Gelöscht = ausgeblendet, Dokument bleibt', pass: archivedDoc?.archived === true && !!archivedDoc?.archivedAt },
    { name: 'Buchung bietet sie nicht mehr an', pass: !bookText.includes('Bart (Test)') },
    { name: 'Nummer ziehen bietet sie nicht mehr an', pass: !queueText.includes('Bart (Test)') },
    { name: 'Zurückholen macht sie wieder buchbar', pass: restored && restoredDoc?.archived === false },
  );

  // ---------- 2. Ladenauswahl ----------
  const second = await db(
    owner,
    async (fs, firestore, uid) => {
      const now = fs.Timestamp.now();
      const shop = await fs.addDoc(fs.collection(firestore, 'shops'), { name: 'Zweitladen (Test)', owner: uid, createdAt: now, updatedAt: now });
      const ref = fs.doc(fs.collection(firestore, 'services'));
      await fs.setDoc(ref, { id: ref.id, shopId: shop.id, name: 'Nur im Zweitladen', duration: 15, price: 10, createdAt: now, updatedAt: now });
      return { shopId: shop.id, serviceId: ref.id };
    },
    fx.uid,
  );
  try {
    await owner.goto(`${BASE}/service-management?shopId=${second.shopId}`, { waitUntil: 'domcontentloaded' });
    const secondShown = await owner.getByText('Nur im Zweitladen', { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    const secondHasSchnitt = await owner.getByText('Schnitt', { exact: true }).count();
    await owner.getByRole('combobox', { name: 'Laden wählen' }).click();
    await owner.getByRole('option', { name: TESTLADEN }).click();
    const switched = await owner.getByText('Schnitt', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const switchedUrl = owner.url();
    await owner.goto(`${BASE}/shop-profile?shopId=${second.shopId}`, { waitUntil: 'domcontentloaded' });
    const profileSecond = await owner.getByRole('heading', { level: 1, name: 'Zweitladen (Test)' }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    await owner.getByRole('combobox', { name: 'Laden wählen' }).click();
    await owner.getByRole('option', { name: TESTLADEN }).click();
    const profileSwitched = await owner.getByRole('heading', { level: 1, name: TESTLADEN }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    rows.push(
      { name: 'Leistungen: zweiter Laden über ?shopId=', pass: secondShown && secondHasSchnitt === 0 },
      { name: 'Leistungen: Laden umschalten', pass: switched && switchedUrl.includes(`shopId=${fx.shopId}`), detail: switchedUrl.replace(BASE, '') },
      { name: 'Mein Laden: zweiter Laden und umschalten', pass: profileSecond && profileSwitched },
    );
  } finally {
    // Andere Tests nehmen den ersten Laden des Kontos – den Zweitladen gleich wieder weg
    await db(
      owner,
      async (fs, firestore, s) => {
        await fs.deleteDoc(fs.doc(firestore, 'services', s.serviceId));
        await fs.deleteDoc(fs.doc(firestore, 'shops', s.shopId));
      },
      second,
    );
  }

  // ---------- 3. Vorlaufzeit für Online-Termine ----------
  const days = [0, 1, 2, 3, 4];
  const slotsNow = (page) =>
    page.evaluate(
      async ({ fx, days }) => {
        const { getAvailableTimeslotsDirect, findEarliestSlots } = await import('/src/utils/firestore/timeslots.ts');
        const iso = (o) => {
          const d = new Date();
          d.setDate(d.getDate() + o);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const online = [];
        for (const o of days) (await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, iso(o))).forEach((s) => online.push(s.start.getTime()));
        const queue = (await findEarliestSlots(fx.shopId, fx.serviceId, [fx.staffId]))[fx.staffId];
        return { online, queue: queue ? queue.start.getTime() : null, now: Date.now() };
      },
      { fx, days },
    );
  const before = await slotsNow(owner);
  await owner.goto(`${BASE}/shop-profile?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  await owner.getByRole('button', { name: 'Bearbeiten' }).click();
  await owner.getByLabel('Vorlaufzeit für Online-Termine (Minuten)').fill('1440');
  await owner.getByRole('button', { name: 'Änderungen speichern' }).click();
  const leadSaved = await owner.getByText('Shop-Profil aktualisiert').waitFor({ timeout: 15000 }).then(() => true, () => false);
  try {
    const stored = await db(owner, async (fs, firestore, id) => (await fs.getDoc(fs.doc(firestore, 'shops', id))).data().timeSlotBuffer, fx.shopId);
    const after = await slotsNow(owner);
    const lead = 1440 * 60000;
    const expected = before.online.filter((t) => t >= after.now + lead);
    const tooEarly = after.online.filter((t) => t < after.now + lead);
    const save = await owner.evaluate(
      async ({ shopId, lead }) => {
        const { assertOnlineLead } = await import('/src/utils/booking-rules.ts');
        const tryAt = (t) => assertOnlineLead(shopId, new Date(t)).then(() => 'ok', (e) => e.message);
        return { early: await tryAt(Date.now() + lead - 30 * 60000), late: await tryAt(Date.now() + lead + 30 * 60000) };
      },
      { shopId: fx.shopId, lead },
    );
    rows.push(
      { name: 'Vorlaufzeit im Formular gespeichert (Zahl)', pass: leadSaved && stored === lead, detail: `${typeof stored} ${stored}` },
      { name: 'Online-Zeiten erst nach der Vorlaufzeit', pass: tooEarly.length === 0 && after.online.length === expected.length, detail: `${before.online.length} → ${after.online.length} Zeiten` },
      { name: 'Speichern zu kurzfristig abgelehnt', pass: /frühestens 24 Stunden/.test(save.early) && save.late === 'ok', detail: `${save.early} / ${save.late}` },
      { name: 'Nummer ziehen ohne Vorlaufzeit', pass: after.queue === before.queue, detail: before.queue ? new Date(before.queue).toISOString() : 'kein Platz' },
    );
  } finally {
    await db(owner, async (fs, firestore, id) => fs.updateDoc(fs.doc(firestore, 'shops', id), { timeSlotBuffer: 0 }), fx.shopId);
  }

  // ---------- 4. Kunde anlegen und Konto verbinden ----------
  const chefStaff = await db(
    owner,
    async (fs, firestore, fx) => {
      const ref = fs.doc(fs.collection(firestore, 'staff'));
      const now = fs.Timestamp.now();
      await fs.setDoc(ref, { id: ref.id, shopId: fx.shopId, name: 'Chef (Test)', email: fx.email, phone: '', role: 'staff', userId: fx.uid, isActive: true, status: 'available', workingHours: [], serviceIds: [], createdAt: now, updatedAt: now });
      return ref.id;
    },
    fx,
  );
  const customerEmail = `kunde-${Date.now()}@example.com`;
  let customerPage = null;
  const kundenLink = async () => {
    // Backend mit dem Endpunkt? Sonst klar melden statt in Zeitüberschreitungen zu laufen (ohne Anmeldung: 401)
    const probe = await fetch(`${BASE}/routes/customer-activation`, { method: 'POST' }).then((r) => r.status, () => 0);
    if ([0, 404, 405].includes(probe) || probe >= 500) {
      rows.push({ name: 'Backend erzeugt Kunden-Links (POST /routes/customer-activation)', pass: false, detail: `Status ${probe} – Backend noch nicht ausgerollt?` });
      return;
    }
    await owner.goto(`${BASE}/employee-dashboard`, { waitUntil: 'domcontentloaded' });
    await owner.getByRole('button', { name: 'Kunde anlegen' }).click();
    const create = owner.getByRole('dialog');
    await create.getByLabel('Name').fill('Kim Test');
    await create.getByLabel('E-Mail').fill(customerEmail);
    await create.getByRole('button', { name: 'Kunde anlegen' }).click();
    const linkBox = create.getByTestId('activation-link');
    await linkBox.waitFor({ timeout: 15000 });
    const link = (await linkBox.innerText()).trim();
    const dialogStaysOpen = await create.getByRole('button', { name: 'Fertig' }).isVisible();
    await shot(owner, 'kunde-anlegen-link', false);
    // gleiche E-Mail noch einmal: kein zweiter Eintrag, neuer Link
    await create.getByRole('button', { name: 'Weiteren Kunden anlegen' }).click();
    await create.getByLabel('Name').fill('Kim Test');
    await create.getByLabel('E-Mail').fill(customerEmail);
    await create.getByRole('button', { name: 'Kunde anlegen' }).click();
    await linkBox.waitFor({ timeout: 15000 });
    const link2 = (await linkBox.innerText()).trim();
    await create.getByRole('button', { name: 'Fertig' }).click();

    const customer = await db(
      owner,
      async (fs, firestore, { shopId, email }) => {
        const snap = await fs.getDocs(fs.query(fs.collection(firestore, 'customers'), fs.where('shopId', '==', shopId), fs.where('email', '==', email)));
        return snap.docs.map((d) => ({ id: d.id, hash: d.data().activationTokenHash || '', plain: 'activationToken' in d.data(), expires: d.data().activationExpires.toMillis() }));
      },
      { shopId: fx.shopId, email: customerEmail },
    );
    const oldToken = new URL(link).searchParams.get('token');
    const token = new URL(link2).searchParams.get('token');
    const oldStatus = await fetch(`${BASE}/routes/customer-activation/${oldToken}`).then((r) => r.status, () => 0);
    rows.push(
      { name: 'Kunde anlegen zeigt Link, Dialog bleibt offen', pass: /\/activate\?token=[A-Za-z0-9_-]{32}$/.test(link) && dialogStaysOpen, detail: link.replace(/token=.*/, 'token=…') },
      { name: 'Gleiche E-Mail: kein zweiter Eintrag, neuer Link', pass: customer.length === 1 && link2 !== link && /\/activate\?token=[A-Za-z0-9_-]{32}$/.test(link2) },
      { name: 'Alter Link gilt danach nicht mehr', pass: oldStatus === 404, detail: `Status ${oldStatus}` },
      {
        name: 'In der Datenbank nur der Hash, kein Token',
        pass: customer.length === 1 && customer[0].hash === createHash('sha256').update(token).digest('hex') && !customer[0].plain,
      },
      { name: 'Link gilt 30 Tage', pass: customer.length === 1 && Math.abs(customer[0].expires - Date.now() - 30 * 86400000) < 3600000 },
    );

    // Termin, den der Laden für den Eintrag einträgt (Montag 14:00 bei Robin); Reste früherer Läufe vorher weg
    await removeKim(owner, fx.shopId);
    const apptId = await owner.evaluate(
      async ({ fx, customerId }) => {
        const { createAppointment } = await import('/src/utils/firestore/appointments.ts');
        const [y, m, d] = fx.monday.split('-').map(Number);
        const start = new Date(y, m - 1, d, 14, 0);
        const created = await createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId, customerName: 'Kim Test', status: 'scheduled', type: 'booked', startTime: start, endTime: new Date(start.getTime() + 30 * 60000) });
        return created.id;
      },
      { fx, customerId: customer[0].id },
    );

    // Ohne Anmeldung: Laden genannt, Konto anlegen oder anmelden
    const visitor = await newPage(browser);
    await visitor.goto(`${BASE}/activate?token=${token}`, { waitUntil: 'domcontentloaded' });
    const visitorOk = await visitor.getByRole('heading', { name: `${TESTLADEN} hat dich angelegt.` }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    const visitorButtons = (await visitor.getByRole('link', { name: 'Konto anlegen' }).count()) + (await visitor.getByRole('link', { name: 'Ich habe schon ein Konto' }).count());
    await shot(visitor, 'aktivieren-gast', false);
    const badLink = await newPage(browser);
    await badLink.goto(`${BASE}/activate?token=0000000000000000ffffffffffffffff`, { waitUntil: 'domcontentloaded' });
    const badOk = await badLink.getByText('Diesen Link gibt es nicht').waitFor({ timeout: 15000 }).then(() => true, () => false);

    // Inhaber mit dem Ladenkonto: abgelehnt
    await owner.goto(`${BASE}/activate?token=${token}`, { waitUntil: 'domcontentloaded' });
    await owner.getByRole('button', { name: 'Mit diesem Konto verbinden' }).click();
    const ownerBlocked = await owner.getByText(/Konto des Ladens/).waitFor({ timeout: 15000 }).then(() => true, () => false);

    // Kundin mit eigenem Konto verbindet
    customerPage = await newPage(browser);
    await customerPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await customerPage.waitForTimeout(2500);
    const customerUid = await customerPage.evaluate(async (email) => {
      const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
      return (await registerWithRole(email, `Test-${Math.random().toString(36).slice(2)}`, 'customer')).uid;
    }, customerEmail);
    // Ein Kundenkonto darf für den Laden keinen Link erzeugen (sonst könnte es Einträge übernehmen)
    const foreignLink = await customerPage.evaluate(async (customerId) => {
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${await firebaseAuth.currentUser.getIdToken()}` };
      return (await fetch('/routes/customer-activation', { method: 'POST', headers, body: JSON.stringify({ customer_id: customerId }) })).status;
    }, customer[0].id);
    await customerPage.goto(`${BASE}/activate?token=${token}`, { waitUntil: 'domcontentloaded' });
    await customerPage.getByRole('button', { name: 'Mit diesem Konto verbinden' }).click();
    const connected = await customerPage.getByRole('heading', { name: 'Verbunden.' }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    await shot(customerPage, 'aktivieren-verbunden', false);
    const after = await db(
      owner,
      async (fs, firestore, { customerId, apptId }) => ({
        customer: (await fs.getDoc(fs.doc(firestore, 'customers', customerId))).data(),
        appt: (await fs.getDoc(fs.doc(firestore, 'appointments', apptId))).data(),
      }),
      { customerId: customer[0].id, apptId },
    );
    await customerPage.goto(`${BASE}/my-bookings`, { waitUntil: 'domcontentloaded' });
    const inBookings = await customerPage.getByText(/Testladen/i).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    // Anderes Konto (Inhaber) sieht danach "Schon verbunden"
    await owner.goto(`${BASE}/activate?token=${token}`, { waitUntil: 'domcontentloaded' });
    const alreadyLinked = await owner.getByRole('heading', { name: 'Schon verbunden.' }).waitFor({ timeout: 15000 }).then(() => true, () => false);

    rows.push(
      { name: 'Link ohne Anmeldung: Laden und Wege', pass: visitorOk && visitorButtons === 2 },
      { name: 'Falscher Link: klare Meldung', pass: badOk },
      { name: 'Ladenkonto kann sich nicht verbinden', pass: ownerBlocked },
      { name: 'Kundenkonto kann keinen Link erzeugen', pass: foreignLink === 403, detail: `Status ${foreignLink}` },
      { name: 'Kundenkonto verbindet sich', pass: connected && after.customer?.userId === customerUid && after.customer?.isActive === true },
      { name: 'Termin des Eintrags gehört jetzt dem Konto', pass: after.appt?.customerId === customerUid, detail: after.appt?.customerId === customerUid ? '' : String(after.appt?.customerId) },
      { name: 'Termin steht unter Meine Termine', pass: inBookings },
      { name: 'Danach: Schon verbunden', pass: alreadyLinked },
    );
  };
  try {
    await kundenLink();
  } finally {
    await removeKim(owner, fx.shopId);
    await db(owner, async (fs, firestore, id) => fs.deleteDoc(fs.doc(firestore, 'staff', id)), chefStaff);
    if (customerPage) {
      // Testkonto der Kundin wieder löschen (Profil zuerst, dann das Konto)
      await customerPage
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
        .catch((e) => console.log('Kundenkonto nicht gelöscht:', String(e).slice(0, 120)));
    }
  }

  rows.push({ name: 'Keine JavaScript-Fehler (Inhaber)', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
