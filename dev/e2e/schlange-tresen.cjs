// Schlange am Tresen (frontend/src/utils/queue-lane.ts) im Testladen, Uhr auf Dienstag vormittag verstellt:
//  - "Nächste Nummer aufrufen" fragt nach, wenn der Nächste erst später eingeplant ist
//  - Verzug: Wartende bleiben am Tresen, auf dem Bildschirm und in "Vor dir", auch wenn ihre Zeit vorbei ist;
//    "ca."-Zeiten wandern mit, neue Nummern kommen hinter die Wartenden
//  - "Zurück auf Wartet" löscht notifiedCalledAt (zweites "Du bist dran"), Aufruf setzt lastCalledAt
//  - Früher fertig gibt den Rest der Zeit frei
//  - Absage/Verschieben durch den Laden merkt eine Nachricht an den Kunden vor (customerNotice)
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Löscht seine Termine wieder.
const { BASE, berlin, launch, newPage, collectErrors, fixture, report, run, shot, signIn } = require('./lib.cjs');

const PREFIX = 'Schlangentest';

run(async () => {
  const fx = fixture();
  const day = fx.tuesday; // Montag hat den Termin aus fixtures.py, der sonst als Erster in der Schlange stünde
  const browser = await launch();
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  const rows = [];
  const clock = (hhmm) => page.clock.setFixedTime(berlin(`${day}T${hhmm}:00`));
  const check = (name, pass, detail = '') => rows.push({ name, pass: Boolean(pass), detail });

  /** Termin im Browser lesen, Zeitpunkte als HH:MM */
  const readDoc = (id) =>
    page.evaluate(async (id) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const data = (await fs.getDoc(fs.doc(firestore, 'appointments', id))).data() || {};
      const out = {};
      for (const [k, v] of Object.entries(data)) out[k] = v && typeof v.toDate === 'function' ? v.toDate().toTimeString().slice(0, 5) : v;
      return out;
    }, id);
  const update = (id, data, options) =>
    page.evaluate(
      async ({ id, data, options }) => {
        const { updateAppointment } = await import('/src/utils/firestore/appointments.ts');
        const [y, m, d] = (data.day || '').split('-').map(Number);
        const fix = { ...data };
        delete fix.day;
        if (data.start) {
          const [h, mi] = data.start.split(':').map(Number);
          fix.startTime = new Date(y, m - 1, d, h, mi);
          fix.endTime = new Date(y, m - 1, d, h, mi + 30);
          delete fix.start;
        }
        await updateAppointment(id, fix, options);
      },
      { id, data, options },
    );
  const slots = () =>
    page.evaluate(async (fx) => {
      const { findEarliestSlots, getAvailableTimeslotsDirect } = await import('/src/utils/firestore/timeslots.ts');
      const hm = (d) => (d ? d.toTimeString().slice(0, 5) : 'nichts');
      const earliest = await findEarliestSlots(fx.shopId, fx.serviceId, [fx.staffId]);
      const direct = await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, fx.tuesday);
      return { number: hm(earliest[fx.staffId]?.start), direct: direct.filter((s) => s.start.getTime() > Date.now()).map((s) => hm(s.start)) };
    }, fx);

  await clock('08:30');
  await signIn(page, fx);
  let ids = {};
  try {
    ids = await page.evaluate(
      async ({ fx, PREFIX }) => {
        const { createAppointment } = await import('/src/utils/firestore/appointments.ts');
        const [y, m, d] = fx.tuesday.split('-').map(Number);
        const make = async (name, h, mi, type = 'queue') =>
          (
            await createAppointment({
              shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId: 'walk-in', customerName: `${PREFIX} ${name}`,
              startTime: new Date(y, m - 1, d, h, mi), endTime: new Date(y, m - 1, d, h, mi + 30), status: 'scheduled', type, price: 20,
            })
          ).id;
        return { a: await make('A', 9, 0), b: await make('B', 9, 30), c: await make('C', 10, 0), e: await make('E', 12, 0, 'booked') };
      },
      { fx, PREFIX },
    );

    // 1. 08:30: A ist erst um 09:00 eingeplant -> Rückfrage statt sofortigem Aufruf
    await page.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    let lane = page.locator('section[aria-label^="Schlange von"]').first();
    await lane.getByText(`${PREFIX} A`).first().waitFor({ timeout: 30000 });
    await lane.getByRole('button', { name: 'Nächste Nummer aufrufen' }).click();
    const ask = await lane.getByRole('alertdialog').innerText().catch(() => '');
    check('Nicht fällig: Rückfrage vor dem Aufruf', /erst um 09:00 eingeplant/.test(ask), ask.replace(/\s+/g, ' ').slice(0, 90));
    await lane.getByRole('button', { name: 'Abbrechen' }).click();
    check('Abbrechen ruft niemanden auf', (await readDoc(ids.a)).status === 'scheduled');

    // 2. 09:10: A aufgerufen
    await clock('09:10');
    await update(ids.a, { status: 'in-progress' });
    const a1 = await readDoc(ids.a);
    check('Aufruf setzt calledAt und lastCalledAt', a1.calledAt === '09:10' && a1.lastCalledAt === '09:10', JSON.stringify({ calledAt: a1.calledAt, lastCalledAt: a1.lastCalledAt }));

    // 3. 10:05: A braucht länger, B (09:30–10:00) ist überfällig
    await clock('10:05');
    const s1 = await slots();
    check('Neue Nummer kommt hinter die Wartenden', s1.number === '11:15', `Nummer ${s1.number}, ohne Prognose ${s1.direct[0]}`);
    check('Feste Zeiten ohne Prognose', s1.direct[0] === '10:30' && !s1.direct.includes('12:00'), s1.direct.slice(0, 4).join(' '));

    await page.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    lane = page.locator('section[aria-label^="Schlange von"]').first();
    await lane.getByText(`${PREFIX} B`).first().waitFor({ timeout: 30000 }).catch(() => {});
    const laneText = (await lane.innerText()).replace(/\s+/g, ' ');
    check('Tresen: Überfälliger wartet weiter', laneText.includes(`${PREFIX} B`) && /3 wartet/i.test(laneText), laneText.slice(0, 120));
    check('Tresen: Verzug angezeigt', /ca\. 35 Min\. Verzug/.test(laneText) && /ca\. 10:35/.test(laneText), (laneText.match(/ca\.[^·]{0,20}/g) || []).join(' | '));
    check('Tresen: Fertig – nächste Nummer', (await lane.getByRole('button', { name: 'Fertig – nächste Nummer' }).count()) === 1);
    const waitingStat = await page.getByText('Wartet noch').locator('..').innerText().catch(() => '');
    check('Tresen: Wartet noch zählt Überfällige', /3/.test(waitingStat), waitingStat.replace(/\s+/g, ' '));
    await shot(page, 'schlange-tresen-verzug');

    const codes = { b: (await readDoc(ids.b)).referenceCode, c: (await readDoc(ids.c)).referenceCode };
    await page.goto(`${BASE}/bildschirm/${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Als Nächstes').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const screen = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    check('Bildschirm: Überfälliger steht da', screen.includes(codes.b) && /ca\. 10:35/.test(screen), screen.slice(0, 140));
    await shot(page, 'schlange-bildschirm-verzug', false);

    await page.goto(`${BASE}/nummer/${ids.c}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Vor dir').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const ticket = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('Nummernseite: Vor dir zählt den Überfälligen', /Vor dir 2/i.test(ticket), (ticket.match(/Vor dir.{0,40}/i) || [''])[0]);
    check('Nummernseite: ca.-Zeit wandert mit', /10:35/.test(ticket) && /etwa 35 Minuten später/.test(ticket), (ticket.match(/Heute dauert.{0,80}/) || [''])[0]);
    await shot(page, 'schlange-nummer-verzug');

    // 4. Zurück auf "Wartet" und erneut aufrufen: "Du bist dran" darf noch einmal kommen
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await clock('10:06');
    await page.evaluate(async (id) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      await fs.updateDoc(fs.doc(firestore, 'appointments', id), { notifiedCalledAt: fs.Timestamp.now() }); // wie der Benachrichtigungsdienst
    }, ids.a);
    await update(ids.a, { status: 'scheduled' });
    const a2 = await readDoc(ids.a);
    check('Zurück auf Wartet löscht notifiedCalledAt', a2.status === 'scheduled' && !('notifiedCalledAt' in a2), JSON.stringify({ status: a2.status, notifiedCalledAt: a2.notifiedCalledAt }));
    await clock('10:07');
    await update(ids.a, { status: 'in-progress' });
    const a3 = await readDoc(ids.a);
    check('Erneuter Aufruf: lastCalledAt neu, calledAt bleibt', a3.lastCalledAt === '10:07' && a3.calledAt === '09:10', JSON.stringify({ calledAt: a3.calledAt, lastCalledAt: a3.lastCalledAt }));

    // 5. Früher fertig: E (12:00) schon um 10:08 aufgerufen, um 10:20 fertig -> 12:00 wieder frei
    await clock('10:08');
    await update(ids.a, { status: 'completed' });
    await update(ids.e, { status: 'in-progress' });
    await clock('10:20');
    await update(ids.e, { status: 'completed' });
    const s2 = await slots();
    check('Früher fertig gibt den Rest frei', s2.direct.includes('12:00'), s2.direct.join(' '));

    // 6. Laden verschiebt C und sagt B ab: Nachricht vorgemerkt
    await clock('10:21');
    await update(ids.c, { start: '13:00', day }, { notifyCustomer: true });
    const c1 = await readDoc(ids.c);
    check('Verschieben merkt Nachricht vor', c1.customerNotice === 'moved' && c1.customerNoticePreviousStart === '10:00' && c1.startTime === '13:00', JSON.stringify({ n: c1.customerNotice, prev: c1.customerNoticePreviousStart }));
    await update(ids.b, { status: 'cancelled', noShow: true }, { notifyCustomer: true });
    const b1 = await readDoc(ids.b);
    check('Absage merkt Nachricht vor', b1.customerNotice === 'cancelled' && b1.noShow === true, JSON.stringify({ n: b1.customerNotice }));
    check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  } finally {
    // Aufräumen: alle Termine dieses Tests löschen (die Regeltests erwarten die Zeiten frei)
    await page.evaluate(
      async ({ shopId, PREFIX }) => {
        const src = await (await fetch('/src/utils/firestore-client.ts')).text();
        const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
        const { firestore } = await import('/src/utils/firestore-client.ts');
        const docs = await fs.getDocs(fs.query(fs.collection(firestore, 'appointments'), fs.where('shopId', '==', shopId)));
        for (const d of docs.docs) if (String(d.data().customerName || '').startsWith(PREFIX)) await fs.deleteDoc(d.ref);
      },
      { shopId: fx.shopId, PREFIX },
    ).catch((e) => console.error('Aufräumen fehlgeschlagen:', e));
    await browser.close();
  }
  return report(rows);
});
