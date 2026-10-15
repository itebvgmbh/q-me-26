// "Früher dran": Absage, Verschieben und Häkchen stoßen sofort die Prüfung an (POST /routes/slot-freed,
// angemeldet) – eine bloße Namensänderung nicht. Das Backend muss dafür nicht laufen: geprüft wird der Aufruf.
// Braucht: Entwicklungsserver und Testdaten.
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/routes/slot-freed')) calls.push({ body: JSON.parse(r.postData() || '{}'), auth: !!r.headers().authorization }); });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, fx.email, fx.pw);
    const appts = await import('/src/utils/firestore/appointments.ts');
    const [y, m, d] = fx.monday.split('-').map(Number);
    const a = await appts.createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerName: 'Absagetest', status: 'scheduled', type: 'queue', isAnonymous: false, startTime: new Date(y, m - 1, d, 16, 0), endTime: new Date(y, m - 1, d, 16, 30) });
    const pause = () => new Promise((r) => setTimeout(r, 1500));
    await pause();
    await appts.updateAppointment(a.id, { customerName: 'nur der Name' });
    await pause();
    await appts.updateAppointment(a.id, { startTime: new Date(y, m - 1, d, 16, 15), endTime: new Date(y, m - 1, d, 16, 45) });
    await pause();
    await appts.updateAppointment(a.id, { status: 'cancelled' });
    await pause();
  }, fx);
  await page.waitForTimeout(1000);
  await browser.close();
  // Erwartet: Verschieben 1×, Absage 1× – Anlegen ohne Häkchen und Namensänderung 0×
  return report([
    { name: 'Genau zwei Prüfungen (Verschieben, Absage)', pass: calls.length === 2, detail: `${calls.length} Aufrufe` },
    { name: 'Mit Anmeldung', pass: calls.length > 0 && calls.every((c) => c.auth) },
    { name: 'Laden und Person stimmen', pass: calls.every((c) => c.body.shop_id === fx.shopId && c.body.staff_id === fx.staffId) },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
