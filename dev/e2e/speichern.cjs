// Bearbeiten-Dialog am Tresen: Speichern mit leeren Feldern (keine Kunden-ID, leerer Preis) darf nicht scheitern.
// Früher: "Function setDoc() called with invalid data. Unsupported field value: undefined".
// Braucht: Entwicklungsserver und Testdaten.
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async (fx) => {
    const appts = await import('/src/utils/firestore/appointments.ts');
    const at = (day, h, m) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };
    const created = await appts.createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerName: 'Nummer ohne Konto', status: 'scheduled', type: 'queue', isAnonymous: true, startTime: at(fx.monday, 15, 0), endTime: at(fx.monday, 15, 30) });
    let saved;
    let after = null;
    try {
      after = await appts.updateAppointment(created.id, { customerId: undefined, customerName: 'geändert', price: undefined, checkEarlierOptions: true, status: 'scheduled' });
      saved = 'ok';
    } catch (e) { saved = e.message; }
    await appts.updateAppointment(created.id, { status: 'cancelled' });
    return { saved, name: after?.customerName ?? null, earlier: after?.checkEarlierOptions ?? null };
  }, fx);
  await browser.close();
  return report([
    { name: 'Speichern ohne Kunden-ID und mit leerem Preis', pass: out.saved === 'ok', detail: out.saved },
    { name: 'Änderungen sind gespeichert', pass: out.name === 'geändert' && out.earlier === true, detail: `${out.name} / früher=${out.earlier}` },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
