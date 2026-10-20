// Gesperrter Laden (Betreiber-Bereich → Laden sperren) im Testladen: nicht auffindbar, nichts buchbar, Hinweis am Tresen.
// Setzt am Testladen kurz das Feld suspended (wie das Backend beim Sperren) und nimmt es am Ende wieder weg.
// Konten sperrt dieser Test nicht – das prüft backend/tests/test_betreiber.py.
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen).
const { BASE, launch, newPage, collectErrors, fixture, signIn, report, run } = require('./lib.cjs');

const setSuspended = (page, shopId, on) =>
  page.evaluate(
    async ({ shopId, on }) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      await fs.updateDoc(fs.doc(firestore, 'shops', shopId), { suspended: on ? { at: fs.Timestamp.now(), accounts: [] } : null });
    },
    { shopId, on },
  );

/** Termin im Testladen anlegen wie die App; Rückgabe: Fehlermeldung oder "angelegt" (dann gleich wieder gelöscht) */
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
  await signIn(owner, fx);

  try {
    await setSuspended(owner, fx.shopId, true);

    const guest = await newPage(browser);
    await guest.goto(`${BASE}/shop-details?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'Laden-Seite: nicht erreichbar', pass: await guest.getByText('Dieser Laden ist gerade nicht erreichbar.').waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
    await guest.goto(`${BASE}/public-join-queue?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'QR-Link: keine Nummern', pass: await guest.getByText('Dieser Laden nimmt gerade keine Nummern an.').waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
    await guest.goto(`${BASE}/shop-map`, { waitUntil: 'domcontentloaded' });
    await guest.waitForTimeout(6000);
    const map = await guest.evaluate(() => document.body.innerText);
    rows.push({ name: 'Läden finden: Testladen fehlt', pass: !map.includes('Testladen (wird gleich gelöscht)') });

    const booking = await tryBooking(owner, fx);
    rows.push({ name: 'Buchen abgelehnt', pass: booking.includes('keine Buchungen'), detail: booking.slice(0, 90) });
    await owner.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    rows.push({ name: 'Tresen: Hinweis gesperrt', pass: await owner.getByText(/Dein Laden ist gesperrt/).waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
  } finally {
    await setSuspended(owner, fx.shopId, false);
  }

  const guest = await newPage(browser);
  await guest.goto(`${BASE}/shop-details?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
  rows.push({ name: 'Nach Freigabe: Laden-Seite wieder da', pass: await guest.getByRole('heading', { name: 'Testladen (wird gleich gelöscht)' }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false) });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
