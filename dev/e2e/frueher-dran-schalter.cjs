// "Früher dran" selbst schalten unter "Meine Termine" (backend/app/apis/frueher_dran), im Testladen:
//  1. Termin, den der Laden für ein verbundenes Kundenkonto eingetragen hat (ohne Haken): Schalter steht aus,
//     Einschalten speichert checkEarlierOptions samt Zeitpunkt, ein früherer Platz wird angeboten, bleibt nach
//     Neuladen an; Ausschalten nimmt Haken und Angebot wieder weg
//  2. Abgesagter Termin: kein Schalter. Gratis-Tarif: kein Schalter, das Backend lehnt Einschalten ab
//  3. Rechte: fremder Termin (403), ohne Anmeldung (401)
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://q-me.spielmacherei.de) ab diesem Stand und
// Testdaten (python dev/fixtures.py anlegen). Räumt Kundenkonto, Termine, Angebote und Tarif-Änderung selbst weg.
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

/** Endpunkt direkt aufrufen; Status der Antwort. withLogin=false schickt keine Anmeldung mit. */
const callApi = (page, appointmentId, an, withLogin = true) =>
  page.evaluate(
    async ({ appointmentId, an, withLogin }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (withLogin) {
        const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
        headers.Authorization = `Bearer ${await firebaseAuth.currentUser.getIdToken()}`;
      }
      const res = await fetch(`/routes/frueher-dran/${appointmentId}`, { method: 'POST', headers, body: JSON.stringify({ an }) });
      return res.status;
    },
    { appointmentId, an, withLogin },
  );

const appt = (page, id) => db(page, async (fs, firestore, id) => (await fs.getDoc(fs.doc(firestore, 'appointments', id))).data() || null, id);

/** offene Angebote (noch nicht angenommen, nicht verfallen) für einen Termin */
const openOffers = (page, { shopId, appointmentId }) =>
  db(
    page,
    async (fs, firestore, { shopId, appointmentId }) => {
      const snap = await fs.getDocs(fs.query(fs.collection(firestore, 'earlier_slot_notifications'), fs.where('shopId', '==', shopId)));
      return snap.docs.map((d) => d.data()).filter((n) => n.appointmentId === appointmentId && n.isAccepted !== true && n.status !== 'expired').length;
    },
    { shopId, appointmentId },
  );

/** bis zu `ms` warten, bis check() true liefert */
const until = async (check, ms, step = 1500) => {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const SWITCH = { name: /Früher dran, wenn etwas frei wird/ };

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const owner = await newPage(browser, { viewport: { width: 1280, height: 800 } });
  await signIn(owner, fx);

  // Backend mit dem Endpunkt? Ohne Anmeldung antwortet ein vorhandener Endpunkt mit 401/403, ein fehlender mit 404
  const probe = await callApi(owner, 'probe', true, false).catch(() => 0);
  if (probe === 404 || probe === 0) {
    rows.push({ name: 'Backend kennt /routes/frueher-dran', pass: false, detail: `Status ${probe} – Backend noch nicht ausgerollt?` });
    await browser.close();
    return report(rows);
  }

  const kunde = await newPage(browser);
  const errors = collectErrors(kunde);
  let customerUid = null;
  const ids = [];
  const steps = async () => {
    // Kundenkonto (so, als hätte es sich über den Link aus "Kunde anlegen" verbunden)
    await kunde.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await kunde.waitForTimeout(2500);
    customerUid = await kunde.evaluate(async (email) => {
      const { registerWithRole } = await import('/src/utils/auth-helpers.ts');
      return (await registerWithRole(email, `Test-${Math.random().toString(36).slice(2)}`, 'customer')).uid;
    }, `frueher-dran-${Date.now()}@example.com`);

    // Vom Laden eingetragen: Montag 15:00 bei Robin, ohne "früher benachrichtigen"; dazu ein abgesagter um 16:00
    const scheduledId = await owner.evaluate(
      async ({ fx, customerId }) => {
        const { createAppointment } = await import('/src/utils/firestore/appointments.ts');
        const [y, m, d] = fx.monday.split('-').map(Number);
        const start = new Date(y, m - 1, d, 15, 0);
        const created = await createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId, customerName: 'Früh Test', status: 'scheduled', type: 'booked', startTime: start, endTime: new Date(start.getTime() + 30 * 60000) });
        return created.id;
      },
      { fx, customerId: customerUid },
    );
    ids.push(scheduledId);
    const cancelledId = await db(
      owner,
      async (fs, firestore, { fx, customerId }) => {
        const [y, m, d] = fx.monday.split('-').map(Number);
        const start = new Date(y, m - 1, d, 16, 0);
        const ref = fs.doc(fs.collection(firestore, 'appointments'));
        const now = fs.Timestamp.now();
        await fs.setDoc(ref, { id: ref.id, shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId, customerName: 'Früh Test', status: 'cancelled', type: 'booked', startTime: fs.Timestamp.fromDate(start), endTime: fs.Timestamp.fromDate(new Date(start.getTime() + 30 * 60000)), createdAt: now, updatedAt: now });
        return ref.id;
      },
      { fx, customerId: customerUid },
    );
    ids.push(cancelledId);

    // ---------- 1. Einschalten ----------
    await kunde.goto(`${BASE}/my-bookings`, { waitUntil: 'domcontentloaded' });
    const toggle = kunde.getByRole('switch', SWITCH);
    const shown = await toggle.first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    const switchCount = await kunde.getByRole('switch', SWITCH).count();
    const startsOff = shown && (await toggle.first().getAttribute('aria-checked')) === 'false';
    await shot(kunde, 'frueher-dran-aus', false);
    rows.push(
      { name: 'Schalter beim eingetragenen Termin', pass: shown && startsOff, detail: shown ? '' : 'nicht gefunden' },
      { name: 'Kein Schalter beim abgesagten Termin', pass: switchCount === 1, detail: `${switchCount} Schalter` },
    );
    if (!shown) return;

    await toggle.click();
    const toastOn = await kunde.getByText('Früher dran ist an').waitFor({ timeout: 15000 }).then(() => true, () => false);
    const checkedOn = (await toggle.getAttribute('aria-checked')) === 'true';
    const savedOn = await appt(owner, scheduledId);
    rows.push({
      name: 'Einschalten speichert Haken und Zeitpunkt',
      pass: toastOn && checkedOn && savedOn?.checkEarlierOptions === true && !!savedOn?.checkEarlierOptionsCreatedAt,
      detail: `Meldung ${toastOn}, Schalter ${checkedOn}, DB ${savedOn?.checkEarlierOptions}`,
    });

    // Das Backend sucht sofort: Vor Montag 15:00 ist bei Robin viel frei, also kommt ein Angebot
    const offered = await until(async () => (await openOffers(owner, { shopId: fx.shopId, appointmentId: scheduledId })) > 0, 30000);
    await kunde.reload({ waitUntil: 'domcontentloaded' });
    const offerShown = await kunde.getByRole('button', { name: 'Früheren Platz nehmen' }).waitFor({ timeout: 20000 }).then(() => true, () => false);
    const stillOn = (await kunde.getByRole('switch', SWITCH).getAttribute('aria-checked')) === 'true';
    await shot(kunde, 'frueher-dran-an', false);
    rows.push(
      { name: 'Danach kommt ein früherer Platz', pass: offered && offerShown, detail: `DB ${offered}, angezeigt ${offerShown}` },
      { name: 'Nach Neuladen weiter an', pass: stillOn },
    );

    // ---------- Ausschalten ----------
    await kunde.getByRole('switch', SWITCH).click();
    const toastOff = await kunde.getByText('Früher dran ist aus').waitFor({ timeout: 15000 }).then(() => true, () => false);
    const offerHidden = await kunde.getByRole('button', { name: 'Früheren Platz nehmen' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
    const savedOff = await appt(owner, scheduledId);
    const offerGone = await until(async () => (await openOffers(owner, { shopId: fx.shopId, appointmentId: scheduledId })) === 0, 30000);
    rows.push({
      name: 'Ausschalten nimmt Haken und Angebot weg',
      pass: toastOff && offerHidden && savedOff?.checkEarlierOptions === false && !('checkEarlierOptionsCreatedAt' in (savedOff || {})) && offerGone,
      detail: `Meldung ${toastOff}, Anzeige weg ${offerHidden}, DB ${savedOff?.checkEarlierOptions}, Angebot weg ${offerGone}`,
    });

    // ---------- 2. Gratis-Tarif (Testphase vorbei) ----------
    await db(owner, async (fs, firestore, shopId) => fs.updateDoc(fs.doc(firestore, 'shops', shopId), { trialEndsAt: fs.Timestamp.fromMillis(Date.now() - 86400000) }), fx.shopId);
    await kunde.reload({ waitUntil: 'domcontentloaded' });
    await kunde.getByRole('heading', { name: 'Als Nächstes' }).waitFor({ timeout: 20000 }).catch(() => {});
    await kunde.waitForTimeout(1000);
    const gratisSwitches = await kunde.getByRole('switch', SWITCH).count();
    const gratisApi = await callApi(kunde, scheduledId, true);
    const gratisSaved = await appt(owner, scheduledId);
    rows.push({ name: 'Gratis-Tarif: kein Schalter, Backend lehnt ab', pass: gratisSwitches === 0 && gratisApi === 403 && gratisSaved?.checkEarlierOptions === false, detail: `${gratisSwitches} Schalter, Status ${gratisApi}` });
    await db(owner, async (fs, firestore, shopId) => fs.updateDoc(fs.doc(firestore, 'shops', shopId), { trialEndsAt: fs.deleteField() }), fx.shopId);

    // ---------- 3. Rechte ----------
    const foreignId = fx.docs.find((d) => d.startsWith('appointments/')).split('/')[1]; // Termin Montag 10:00 aus fixtures.py
    const foreignStatus = await callApi(kunde, foreignId, true);
    const foreign = await appt(owner, foreignId);
    const anonStatus = await callApi(kunde, scheduledId, true, false);
    rows.push(
      { name: 'Fremder Termin: abgelehnt', pass: foreignStatus === 403 && foreign?.checkEarlierOptions === undefined, detail: `Status ${foreignStatus}` },
      { name: 'Ohne Anmeldung: abgelehnt', pass: anonStatus === 401 || anonStatus === 403, detail: `Status ${anonStatus}` },
    );
  };
  try {
    await steps();
  } finally {
    await db(
      owner,
      async (fs, firestore, { shopId, ids }) => {
        const offers = await fs.getDocs(fs.query(fs.collection(firestore, 'earlier_slot_notifications'), fs.where('shopId', '==', shopId)));
        for (const d of offers.docs) if (ids.includes(d.data().appointmentId)) await fs.deleteDoc(d.ref);
        for (const id of ids) await fs.deleteDoc(fs.doc(firestore, 'appointments', id));
        await fs.updateDoc(fs.doc(firestore, 'shops', shopId), { trialEndsAt: fs.deleteField() });
      },
      { shopId: fx.shopId, ids },
    ).catch((e) => console.log('Aufräumen im Testladen unvollständig:', String(e).slice(0, 120)));
    if (customerUid) {
      // Testkonto der Kundin wieder löschen (Profil zuerst, dann das Konto)
      await kunde
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

  rows.push({ name: 'Keine JavaScript-Fehler (Kundin)', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
