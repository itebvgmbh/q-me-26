// Terminregeln (booking-rules): Pausen (Person und Laden), Öffnungs-/Arbeitszeiten, Doppelbuchung, Verschieben, Absage.
// Braucht: Entwicklungsserver (npm run dev im frontend) und Testdaten (python dev/fixtures.py anlegen).
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async (fx) => {
    const rules = await import('/src/utils/booking-rules.ts');
    const { getAvailableTimeslotsDirect } = await import('/src/utils/firestore/timeslots.ts');
    const appts = await import('/src/utils/firestore/appointments.ts');
    const at = (day, h, m) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };
    const res = {};
    const check = async (label, day, h1, m1, h2, m2) => {
      const ctx = await rules.loadStaffDayContext(fx.shopId, fx.staffId, at(day, 0, 0));
      res[label] = rules.findConflict(ctx, at(day, h1, m1).getTime(), at(day, h2, m2).getTime());
    };
    await check('mittagspause', fx.monday, 12, 15, 12, 45);
    await check('ragtInPause', fx.monday, 11, 45, 12, 15);
    await check('bestehenderTermin', fx.monday, 10, 15, 10, 45);
    await check('vorOeffnung', fx.monday, 8, 30, 9, 0);
    await check('nachSchluss', fx.monday, 16, 45, 17, 15);
    await check('frei0930', fx.monday, 9, 30, 10, 0);
    await check('frei1300', fx.monday, 13, 0, 13, 30);
    await check('einmaligePause', fx.tuesday, 14, 45, 15, 15);
    await check('frei1530', fx.tuesday, 15, 30, 16, 0);
    const sat = at(fx.monday, 0, 0); sat.setDate(sat.getDate() + 5);
    const satStr = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
    await check('samstagZu', satStr, 10, 0, 10, 30);
    const wed = at(fx.monday, 0, 0); wed.setDate(wed.getDate() + 2);
    const wedStr = `${wed.getFullYear()}-${String(wed.getMonth() + 1).padStart(2, '0')}-${String(wed.getDate()).padStart(2, '0')}`;
    await check('ladenpause', wedStr, 12, 45, 13, 15);
    await check('nachLadenpause', wedStr, 13, 30, 14, 0);
    const ohnePerson = await rules.loadStaffDayContext(fx.shopId, null, at(wedStr, 0, 0));
    res.ladenpauseOhnePerson = rules.findConflict(ohnePerson, at(wedStr, 12, 30).getTime(), at(wedStr, 13, 0).getTime());
    res.slotsMittwoch = (await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, wedStr)).map((s) => s.start.toTimeString().slice(0, 5));
    res.slotsMontag = (await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, fx.monday)).map((s) => s.start.toTimeString().slice(0, 5));
    res.slotsSamstag = (await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, satStr)).length;
    const base = { shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, customerName: 'Regeltest', status: 'scheduled', type: 'booked', isAnonymous: false };
    const attempt = async (fn) => { try { await fn(); return 'gespeichert'; } catch (e) { return `abgelehnt: ${e.message}`; } };
    res.anlegenInPause = await attempt(() => appts.createAppointment({ ...base, startTime: at(fx.monday, 12, 0), endTime: at(fx.monday, 12, 30) }));
    let created;
    res.anlegen1300 = await attempt(async () => { created = await appts.createAppointment({ ...base, startTime: at(fx.monday, 13, 0), endTime: at(fx.monday, 13, 30) }); });
    res.doppelt1315 = await attempt(() => appts.createAppointment({ ...base, startTime: at(fx.monday, 13, 15), endTime: at(fx.monday, 13, 45) }));
    if (created) {
      res.verschiebenInPause = await attempt(() => appts.updateAppointment(created.id, { startTime: at(fx.monday, 12, 30), endTime: at(fx.monday, 13, 0) }));
      res.verschieben1400 = await attempt(() => appts.updateAppointment(created.id, { startTime: at(fx.monday, 14, 0), endTime: at(fx.monday, 14, 30) }));
      res.nurStatus = await attempt(() => appts.updateAppointment(created.id, { status: 'completed' }));
      await attempt(() => appts.updateAppointment(created.id, { status: 'cancelled' }));
      let again;
      res.abgesagtBlockiertNicht = await attempt(async () => { again = await appts.createAppointment({ ...base, startTime: at(fx.monday, 14, 0), endTime: at(fx.monday, 14, 30) }); });
      // Aufräumen, damit der Test wiederholbar ist
      if (again) await attempt(() => appts.updateAppointment(again.id, { status: 'cancelled' }));
    }
    return res;
  }, fx);
  await browser.close();

  const expectedMonday = '09:00 09:15 09:30 10:30 10:45 11:00 11:15 11:30 13:00 13:15 13:30 13:45 14:00 14:15 14:30 14:45 15:00 15:15 15:30 15:45 16:00 16:15 16:30';
  return report([
    { name: 'Mittagspause wird abgelehnt', pass: /Mittagspause von 12:00 bis 13:00/.test(out.mittagspause), detail: out.mittagspause },
    { name: 'Ragt in die Pause', pass: /Mittagspause/.test(out.ragtInPause), detail: out.ragtInPause },
    { name: 'Bestehender Termin', pass: /schon ein Termin \(10:00–10:30\)/.test(out.bestehenderTermin), detail: out.bestehenderTermin },
    { name: 'Vor Öffnung', pass: /Außerhalb der buchbaren Zeit \(09:00–17:00\)/.test(out.vorOeffnung), detail: out.vorOeffnung },
    { name: 'Nach Schluss', pass: /Außerhalb der buchbaren Zeit/.test(out.nachSchluss), detail: out.nachSchluss },
    { name: 'Montag 09:30 frei', pass: out.frei0930 === null },
    { name: 'Montag 13:00 frei (direkt nach Pause)', pass: out.frei1300 === null },
    { name: 'Einmalige Pause Dienstag', pass: /Pause von 15:00 bis 15:30/.test(out.einmaligePause), detail: out.einmaligePause },
    { name: 'Dienstag 15:30 frei', pass: out.frei1530 === null },
    { name: 'Samstag Laden zu', pass: /samstags geschlossen/.test(out.samstagZu), detail: out.samstagZu },
    { name: 'Freie Zeiten Montag', pass: out.slotsMontag.join(' ') === expectedMonday, detail: `${out.slotsMontag.length} Zeiten` },
    { name: 'Freie Zeiten Samstag', pass: out.slotsSamstag === 0 },
    { name: 'Pause des Ladens Mittwoch', pass: /Der Laden macht Pause von 12:30 bis 13:30/.test(out.ladenpause), detail: out.ladenpause },
    { name: 'Mittwoch 13:30 frei (nach Ladenpause)', pass: out.nachLadenpause === null, detail: out.nachLadenpause },
    { name: 'Ladenpause gilt auch ohne Person', pass: /Der Laden macht Pause/.test(out.ladenpauseOhnePerson || ''), detail: out.ladenpauseOhnePerson },
    { name: 'Freie Zeiten Mittwoch ohne 12:15–13:15', pass: out.slotsMittwoch.includes('12:00') && out.slotsMittwoch.includes('13:30') && !['12:15', '12:30', '12:45', '13:00', '13:15'].some((t) => out.slotsMittwoch.includes(t)), detail: `${out.slotsMittwoch.length} Zeiten` },
    { name: 'Anlegen in der Pause abgelehnt', pass: /abgelehnt: Mittagspause/.test(out.anlegenInPause), detail: out.anlegenInPause },
    { name: 'Anlegen 13:00', pass: out.anlegen1300 === 'gespeichert' },
    { name: 'Doppelbuchung 13:15 abgelehnt', pass: /abgelehnt: Da ist schon ein Termin/.test(out.doppelt1315), detail: out.doppelt1315 },
    { name: 'Verschieben in die Pause abgelehnt', pass: /abgelehnt: Mittagspause/.test(out.verschiebenInPause || '') },
    { name: 'Verschieben auf 14:00', pass: out.verschieben1400 === 'gespeichert' },
    { name: 'Nur Status ändern', pass: out.nurStatus === 'gespeichert' },
    { name: 'Abgesagter Termin blockiert nicht', pass: out.abgesagtBlockiertNicht === 'gespeichert' },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
