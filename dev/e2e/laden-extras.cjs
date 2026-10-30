// Wartezimmer-Bildschirm, Auswertung und QR-Plakat im Testladen.
//  - Jede Nummer aus der Schlange bekommt eine Tagesnummer (auch vom Tresen)
//  - Bildschirm zeigt "Als Nächstes" und nach dem Aufruf "Jetzt dran"; der Aufruf setzt calledAt
//  - Auswertung zeigt Kennzahlen, Plakat einen QR-Code
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Löscht seine Nummern wieder.
const { BASE, berlin, launch, newPage, shot, collectErrors, fixture, report, run } = require('./lib.cjs');

const signIn = async (page, fx) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, fx.email, fx.pw);
  }, fx);
};

/** Nummer vom Tresen anlegen (wie "Nummer vergeben"), jetzt, bei der Testperson */
const createWalkIn = (page, fx) =>
  page.evaluate(async (fx) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { createAppointment } = await import('/src/utils/firestore/appointments.ts');
    const start = new Date();
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const a = await createAppointment({
      shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId: 'walk-in', customerName: 'Laufkundschaft',
      startTime: fs.Timestamp.fromDate(start), endTime: fs.Timestamp.fromDate(end), status: 'scheduled', type: 'queue',
    });
    return { id: a.id, code: a.referenceCode };
  }, fx);

const readAppointment = (page, id) =>
  page.evaluate(async (id) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const snap = await fs.getDoc(fs.doc(firestore, 'appointments', id));
    const d = snap.data() || {};
    return { status: d.status, calledAt: Boolean(d.calledAt) };
  }, id);

const callTicket = (page, id) =>
  page.evaluate(async (id) => {
    const { updateAppointment } = await import('/src/utils/firestore/appointments.ts');
    await updateAppointment(id, { status: 'in-progress' });
  }, id);

const removeWalkIns = (page, shopId) =>
  page.evaluate(async (shopId) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const docs = await fs.getDocs(fs.query(fs.collection(firestore, 'appointments'), fs.where('shopId', '==', shopId)));
    for (const d of docs.docs) if (d.data().customerName === 'Laufkundschaft') await fs.deleteDoc(d.ref);
  }, shopId);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  // "Jetzt" muss in den Öffnungszeiten des Testladens liegen (Mo–Fr 09–17), sonst lehnt das Anlegen ab
  const clock = berlin(`${fx.tuesday}T10:00:00`);
  await page.clock.setFixedTime(clock);
  await signIn(page, fx);
  try {
    const ticket = await createWalkIn(page, fx);
    rows.push({ name: 'Nummer vom Tresen hat eine Tagesnummer', pass: /^\d{2,3}$/.test(ticket.code || ''), detail: ticket.code });

    const tv = await newPage(browser, { viewport: { width: 1920, height: 1080 } });
    const tvErrors = collectErrors(tv);
    await tv.clock.setFixedTime(clock);
    await tv.goto(`${BASE}/bildschirm/${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    await tv.getByText('Nummer ziehen ohne App').waitFor({ timeout: 30000 });
    await tv.waitForTimeout(2000);
    let tvText = await tv.evaluate(() => document.body.innerText);
    // Überschriften stehen in Großbuchstaben (CSS), innerText liefert sie so
    const after = (text, label) => (text.split(new RegExp(label, 'i'))[1] || '').trim();
    rows.push({ name: 'Bildschirm: Nummer unter "Als Nächstes"', pass: after(tvText, 'Als Nächstes').startsWith(ticket.code), detail: tvText.slice(0, 160).replace(/\n/g, ' | ') });
    rows.push({ name: 'Bildschirm: QR-Code da', pass: (await tv.locator('svg').count()) > 0 });

    await callTicket(page, ticket.id);
    await tv.waitForTimeout(2500);
    tvText = await tv.evaluate(() => document.body.innerText);
    const jetzt = after(tvText, 'Jetzt dran');
    rows.push({ name: 'Bildschirm: nach Aufruf unter "Jetzt dran"', pass: jetzt.startsWith(ticket.code), detail: jetzt.slice(0, 40).replace(/\n/g, ' | ') });
    await shot(tv, 'bildschirm', false);
    const stored = await readAppointment(page, ticket.id);
    rows.push({ name: 'Aufruf speichert calledAt', pass: stored.status === 'in-progress' && stored.calledAt });
    rows.push({ name: 'Bildschirm: keine JavaScript-Fehler', pass: tvErrors.length === 0, detail: tvErrors.join(' | ') });
    await tv.close();

    await page.goto(`${BASE}/auswertung`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Kunden pro Tag').waitFor({ timeout: 30000 });
    const stats = await page.evaluate(() => document.body.innerText);
    rows.push({ name: 'Auswertung: Kennzahlen und Stoßzeiten', pass: /Kunden/i.test(stats) && /Stoßzeiten/i.test(stats) && /Wartezeit/i.test(stats) });
    await shot(page, 'auswertung');

    await page.goto(`${BASE}/plakat`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Drucken/ }).waitFor({ timeout: 30000 });
    rows.push({ name: 'Plakat: QR-Code und Text', pass: (await page.locator('article svg').count()) > 0 && /Ohne App/.test(await page.evaluate(() => document.body.innerText)) });
    await page.emulateMedia({ media: 'print' });
    rows.push({ name: 'Plakat: beim Drucken ohne Navigation', pass: !(await page.locator('header').first().isVisible()) });
    await shot(page, 'plakat-druck');
    await page.emulateMedia({ media: 'screen' });
  } finally {
    await removeWalkIns(page, fx.shopId).catch(() => {});
  }
  rows.push({ name: 'Betrieb: keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
