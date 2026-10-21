// Gesperrter Laden (Betreiber-Bereich → Laden sperren): nicht auffindbar, nichts buchbar, Hinweis am Tresen.
// Sperren darf nur das Backend (firestore.rules). Der Test legt deshalb einen Wegwerf-Laden an, der schon beim Anlegen
// gesperrt ist (lib.cjs tempShop), und löscht ihn samt Konto am Ende. Gegenprobe: der Testladen aus fixtures.py.
// Konten sperrt dieser Test nicht – das prüft backend/tests/test_betreiber.py.
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen).
const { BASE, launch, newPage, collectErrors, fixture, tempShop, removeTempShop, report, run } = require('./lib.cjs');

const SUSPENDED_NAME = 'Testladen gesperrt (wird gleich gelöscht)';

/** Termin anlegen wie die App; Rückgabe: Fehlermeldung oder "angelegt" (dann gleich wieder gelöscht) */
const tryBooking = (page, fx) =>
  page.evaluate(async (fx) => {
    const { createAppointment } = await import('/src/utils/firestore/appointments.ts');
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const start = new Date(`${fx.monday}T11:00:00`);
    try {
      const appt = await createAppointment({
        shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerId: 'walk-in', customerName: 'Sperrtest',
        startTime: start, endTime: new Date(start.getTime() + 30 * 60000), status: 'scheduled', type: 'appointment',
      });
      await fs.deleteDoc(fs.doc(firestore, 'appointments', appt.id)); // sollte nicht passieren: wieder weg damit
      return 'angelegt';
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  }, fx);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const owner = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(owner);
  const shop = await tempShop(owner, SUSPENDED_NAME, { suspended: true });

  try {
    const guest = await newPage(browser);
    await guest.goto(`${BASE}/shop-details?shopId=${shop.shopId}`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'Laden-Seite: nicht erreichbar', pass: await guest.getByText('Dieser Laden ist gerade nicht erreichbar.').waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
    await guest.goto(`${BASE}/public-join-queue?shopId=${shop.shopId}`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'QR-Link: keine Nummern', pass: await guest.getByText('Dieser Laden nimmt gerade keine Nummern an.').waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
    await guest.goto(`${BASE}/shop-map`, { waitUntil: 'domcontentloaded' });
    await guest.waitForTimeout(6000);
    const map = await guest.evaluate(() => document.body.innerText);
    rows.push({ name: 'Läden finden: gesperrter Laden fehlt', pass: !map.includes(SUSPENDED_NAME) });

    const booking = await tryBooking(owner, shop);
    rows.push({ name: 'Buchen abgelehnt', pass: booking.includes('keine Buchungen'), detail: booking.slice(0, 90) });
    await owner.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'Tresen: Hinweis gesperrt', pass: await owner.getByText(/Dein Laden ist gesperrt/).waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
  } finally {
    await removeTempShop(owner, shop).catch((e) => console.log('Wegwerf-Laden nicht gelöscht:', shop.shopId, String(e).slice(0, 120)));
  }

  // Gegenprobe: ein nicht gesperrter Laden ist erreichbar
  const guest = await newPage(browser);
  await guest.goto(`${BASE}/shop-details?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  rows.push({ name: 'Nicht gesperrt: Laden-Seite da', pass: await guest.getByRole('heading', { name: 'Testladen (wird gleich gelöscht)' }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
