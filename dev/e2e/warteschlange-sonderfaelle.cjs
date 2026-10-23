// Nummer ziehen – Sonderfälle in der Oberfläche (Testladen, verstellte Uhr):
//  1. Personen-Schritt zeigt den nächsten Platz je Person
//  2. Platz wird kurz vor dem Bestätigen weggeschnappt → Nummer bekommt gleich den nächsten Platz,
//     die Nummernseite sagt „verschoben“ (kein zweites Bestätigen)
//  3. Seite stand offen, Platz liegt inzwischen in der Vergangenheit → Hinweis und neuer Platz
//  4. Letzter Platz des Tages weggeschnappt → kein Umbuchen auf morgen, Hinweis und neues Angebot
// Braucht: Entwicklungsserver und Testdaten.
const { BASE, berlin, launch, newPage, collectErrors, fixture, report, run, shot } = require('./lib.cjs');

run(async () => {
  const fx = fixture();
  const mo = fx.monday;
  const browser = await launch();
  const rows = [];
  const box = (page) => page.locator('[aria-live="polite"]').first().innerText().then((t) => t.replace(/\n+/g, ' | '));
  const toast = async (page) => (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' / ');
  const open = async (clock) => {
    const page = await newPage(browser);
    const errors = collectErrors(page);
    await page.clock.setFixedTime(berlin(clock));
    await page.goto(`${BASE}/public-join-queue?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Schnitt/ }).first().click({ timeout: 60000 });
    await page.getByText(/Nächster Platz/).first().waitFor({ timeout: 30000 });
    return { page, errors };
  };
  const waitFor = (page, time) => page.waitForFunction((t) => (document.querySelector('[aria-live="polite"]')?.textContent || '').includes(t), time, { timeout: 30000 });

  // 1 + 2: weggeschnappt
  {
    const { page, errors } = await open(`${mo}T08:40:00`);
    const staffStep = (await page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
    rows.push({ name: 'Personen-Schritt zeigt Zeiten', pass: /Robin \| Nächster Platz 09:00/.test(staffStep), detail: staffStep.slice(0, 120) });
    await page.getByRole('button', { name: /^Robin/ }).click();
    await page.locator('#queue-name').fill('Test Sonderfall');
    const before = await box(page);
    const blockerId = await page.evaluate(async (fx) => {
      const appts = await import('/src/utils/firestore/appointments.ts');
      const [y, m, d] = fx.monday.split('-').map(Number);
      const a = await appts.createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerName: 'war schneller', status: 'scheduled', type: 'queue', isAnonymous: true, startTime: new Date(y, m - 1, d, 9, 0), endTime: new Date(y, m - 1, d, 9, 30) });
      return a.id;
    }, fx);
    await page.getByRole('button', { name: 'Nummer ziehen' }).click();
    // Kein Hinweis „noch mal bestätigen“ mehr: gleich eingereiht, auf dem nächsten freien Platz
    const landed = await page.waitForURL(/\/nummer\//, { timeout: 30000 }).then(() => true, () => false);
    const ownId = landed ? new URL(page.url()).pathname.split('/').pop() : null;
    if (landed) await page.getByText('Du bist eingereiht.').waitFor({ timeout: 30000 }).catch(() => {});
    const text = landed ? (await page.locator('main, body').first().innerText()).replace(/\n+/g, ' | ') : await toast(page);
    rows.push({ name: 'Weggeschnappt: gleich eingereiht', pass: landed && /verschoben=1/.test(page.url()) && /Du bist eingereiht\./.test(text), detail: landed ? page.url().split('/').pop() : `kein Wechsel zur Nummer: ${text}` });
    rows.push({ name: 'Weggeschnappt: Hinweis 09:30', pass: /09:00/.test(before) && /Dein Platz hat sich auf 09:30 verschoben/.test(text), detail: `${before} → ${(text.match(/Dein Platz[^|]*/) || [text.slice(0, 120)])[0]}` });
    const saved = ownId ? await page.evaluate(async (id) => {
      // Firestore-Funktionen der App (gleicher Weg wie frueher-dran-schalter.cjs)
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const a = (await fs.getDoc(fs.doc(firestore, 'appointments', id))).data();
      return a ? `${a.startTime.toDate().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${a.referenceCode || ''}` : '';
    }, ownId).catch((e) => `nicht lesbar: ${String(e).slice(0, 80)}`) : '';
    rows.push({ name: 'Weggeschnappt: gespeichert 09:30', pass: /^09:30 \d+/.test(saved), detail: saved });
    await shot(page, 'sonderfall-weggeschnappt', false);
    await page.evaluate(async (ids) => {
      const appts = await import('/src/utils/firestore/appointments.ts');
      for (const id of ids) await appts.updateAppointment(id, { status: 'cancelled' });
    }, [blockerId, ownId].filter(Boolean));
    rows.push({ name: 'Keine JavaScript-Fehler (1)', pass: errors.length === 0, detail: errors.join(' | ') });
    await page.context().close();
  }

  // 3: vorbei
  {
    const { page, errors } = await open(`${mo}T08:50:00`);
    await page.getByRole('button', { name: /Egal wer/ }).click();
    await page.locator('#queue-name').fill('Test Sonderfall');
    const before = await box(page);
    await page.clock.setFixedTime(berlin(`${mo}T09:05:00`));
    await page.getByRole('button', { name: 'Nummer ziehen' }).click();
    await waitFor(page, '09:15');
    const hint = await toast(page);
    rows.push({ name: 'Vorbei: Hinweis', pass: /schon vorbei/.test(hint), detail: hint });
    rows.push({ name: 'Vorbei: neuer Platz 09:15', pass: /09:00/.test(before) && /09:15/.test(await box(page)), detail: `${before} → ${await box(page)}` });
    rows.push({ name: 'Keine JavaScript-Fehler (2)', pass: errors.length === 0, detail: errors.join(' | ') });
    await page.context().close();
  }

  // 4: letzter Platz des Tages weggeschnappt → nicht von selbst auf morgen, der Kunde entscheidet
  {
    const { page, errors } = await open(`${mo}T16:10:00`);
    await page.getByRole('button', { name: /^Robin/ }).click();
    await page.locator('#queue-name').fill('Test Sonderfall');
    const before = await box(page);
    const blockerId = await page.evaluate(async (fx) => {
      const appts = await import('/src/utils/firestore/appointments.ts');
      const [y, m, d] = fx.monday.split('-').map(Number);
      const a = await appts.createAppointment({ shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerName: 'war schneller', status: 'scheduled', type: 'queue', isAnonymous: true, startTime: new Date(y, m - 1, d, 16, 15), endTime: new Date(y, m - 1, d, 16, 45) });
      return a.id;
    }, fx);
    await page.getByRole('button', { name: 'Nummer ziehen' }).click();
    await waitFor(page, '09:00');
    const hint = await toast(page);
    rows.push({ name: 'Tag voll: Hinweis statt morgen', pass: /gerade weggegangen/.test(hint) && !/\/nummer\//.test(page.url()), detail: hint });
    rows.push({ name: 'Tag voll: neues Angebot morgen 09:00', pass: /16:15/.test(before) && /09:00/.test(await box(page)), detail: `${before} → ${await box(page)}` });
    await page.evaluate(async (id) => (await import('/src/utils/firestore/appointments.ts')).updateAppointment(id, { status: 'cancelled' }), blockerId);
    rows.push({ name: 'Keine JavaScript-Fehler (3)', pass: errors.length === 0, detail: errors.join(' | ') });
    await page.context().close();
  }
  await browser.close();
  return report(rows);
});
