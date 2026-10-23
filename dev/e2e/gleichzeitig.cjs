// Gleichzeitig buchen (Belegung je Person und Tag, frontend/src/utils/firestore/schedule.ts):
// Jedes "Gerät" ist ein eigener Browser mit eigener Datenbankverbindung, alle schreiben im selben Moment.
//  1. 10 ziehen dieselbe Nummer (gleicher Platz)        → genau einer bekommt ihn, die anderen "schon ein Termin"
//  2. 10 buchen verschiedene Plätze                     → alle klappen, 10 verschiedene Nummern
//  3. 2 Termine werden auf denselben Platz verschoben   → nur einer
//  4. Absage gibt den Platz frei                        → danach geht er wieder
//  5. Aufgerufen und fertig vor der geplanten Zeit      → Platz wieder frei
//  6. 10 ziehen über die Nummernseite (QueueBookingService) dieselbe angezeigte Nummer
//                                                       → alle eingereiht, wer zu spät war, gleich auf den nächsten Platz
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Bucht Donnerstag/Freitag der
// Testwoche und den Dienstag danach (6.) und sagt am Ende alles wieder ab.
// 1.–5. buchen wie der Tresen (als Inhaber des Testladens angemeldet – Termine ändern darf nur der Laden),
// 6. ohne Anmeldung wie die Nummernseite.
const { BASE, berlin, launch, newPage, collectErrors, fixture, report, run, signIn } = require('./lib.cjs');

const N = Number(process.env.QME_GERAETE || 10);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const devices = await Promise.all(Array.from({ length: N }, async () => {
    const page = await newPage(browser);
    const errors = collectErrors(page);
    await signIn(page, fx);
    await page.evaluate(async () => {
      window.__appts = await import('/src/utils/firestore/appointments.ts');
    });
    return { page, errors };
  }));
  const day = (offset) => { const [y, m, d] = fx.monday.split('-').map(Number); return [y, m - 1, d + offset]; };
  const [thu, fri] = [day(3), day(4)];
  const base = { shopId: fx.shopId, staffId: fx.staffId, serviceId: fx.serviceId, status: 'scheduled', type: 'queue', isAnonymous: true };

  /** Alle Geräte rufen im selben Moment fn(window.__appts, i) auf; Ergebnis je Gerät */
  const together = async (count, fn, arg) => {
    const t0 = Date.now() + 1500;
    // Warten über setTimeout statt Date.now(): läuft auch, wenn die Uhr der Seite verstellt ist (6.)
    return Promise.all(devices.slice(0, count).map(({ page }, i) => page.evaluate(async ({ wait, fn, arg, i }) => {
      await new Promise((r) => setTimeout(r, wait));
      try {
        // eslint-disable-next-line no-new-func
        const result = await new Function('appts', 'arg', 'i', `return (${fn})(appts, arg, i);`)(window.__appts, arg, i);
        return { ok: true, id: result?.id, code: result?.referenceCode, start: result?.start, end: result?.end, moved: result?.moved };
      } catch (e) {
        return { ok: false, name: e.name, message: e.message };
      }
    }, { wait: Math.max(0, t0 - Date.now()), fn: fn.toString(), arg, i })));
  };
  const at = (d, h, m) => new Date(d[0], d[1], d[2], h, m).getTime();
  const created = [];
  const rows = [];

  // 1. Ansturm auf einen Platz
  const rush = await together(N, (appts, a, i) => appts.createAppointment({ ...a.base, customerName: `Gleichzeitig ${i + 1}`, startTime: new Date(a.start), endTime: new Date(a.end) }),
    { base, start: at(thu, 9, 0), end: at(thu, 9, 30) });
  created.push(...rush.filter((r) => r.ok).map((r) => r.id));
  const wins = rush.filter((r) => r.ok);
  const refused = rush.filter((r) => !r.ok && r.name === 'SlotConflictError');
  rows.push({ name: `Ansturm: ${N} auf einen Platz, einer bekommt ihn`, pass: wins.length === 1 && refused.length === N - 1,
    detail: `${wins.length} gebucht, ${refused.length} abgewiesen${rush.some((r) => !r.ok && r.name !== 'SlotConflictError') ? `, andere Fehler: ${rush.filter((r) => !r.ok && r.name !== 'SlotConflictError').map((r) => r.message).join(' | ').slice(0, 200)}` : ''}` });
  rows.push({ name: 'Ansturm: Abgewiesene erfahren warum', pass: refused.every((r) => /schon ein Termin/.test(r.message)), detail: refused[0]?.message });

  // 2. Verschiedene Plätze gleichzeitig: alle klappen, jede Nummer nur einmal
  const many = await together(N, (appts, a, i) => appts.createAppointment({ ...a.base, customerName: `Nummer ${i + 1}`,
    startTime: new Date(a.start + i * 30 * 60000), endTime: new Date(a.start + (i + 1) * 30 * 60000) }), { base, start: at(fri, 9, 0) });
  created.push(...many.filter((r) => r.ok).map((r) => r.id));
  const codes = many.filter((r) => r.ok).map((r) => r.code);
  rows.push({ name: `Nummern: ${N} Plätze gleichzeitig, alle gebucht`, pass: many.every((r) => r.ok), detail: many.filter((r) => !r.ok).map((r) => r.message).join(' | ').slice(0, 200) || `${many.length} gebucht` });
  rows.push({ name: 'Nummern: jede nur einmal', pass: codes.length === N && new Set(codes).size === N && codes.every(Boolean), detail: codes.join(', ') });

  // 3. Zwei Termine gleichzeitig auf denselben Platz verschieben
  const movers = await together(2, (appts, a, i) => appts.createAppointment({ ...a.base, customerName: `Verschieben ${i + 1}`,
    startTime: new Date(a.start + i * 30 * 60000), endTime: new Date(a.start + (i + 1) * 30 * 60000) }), { base, start: at(thu, 14, 0) });
  created.push(...movers.filter((r) => r.ok).map((r) => r.id));
  const moved = await together(2, (appts, a, i) => appts.updateAppointment(a.ids[i], { startTime: new Date(a.start), endTime: new Date(a.end) }),
    { ids: movers.map((r) => r.id), start: at(thu, 11, 0), end: at(thu, 11, 30) });
  rows.push({ name: 'Verschieben: nur einer auf den Platz', pass: moved.filter((r) => r.ok).length === 1 && moved.some((r) => r.name === 'SlotConflictError'),
    detail: moved.map((r) => (r.ok ? 'verschoben' : r.message)).join(' | ') });

  // 4. Absage gibt den Platz frei
  const winner = wins[0]?.id;
  const [free] = await together(1, async (appts, a) => {
    await appts.cancelAppointment(a.winner);
    return appts.createAppointment({ ...a.base, customerName: 'Nach Absage', startTime: new Date(a.start), endTime: new Date(a.end) });
  }, { base, winner, start: at(thu, 9, 0), end: at(thu, 9, 30) });
  if (free.ok) created.push(free.id);
  rows.push({ name: 'Absage gibt den Platz frei', pass: !!winner && free.ok, detail: free.ok ? '' : free.message });

  // 5. Aufgerufen und fertig, bevor die geplante Zeit beginnt: Der Platz ist wieder frei (queue-lane.ts)
  const [early] = await together(1, async (appts, a) => {
    const x = await appts.createAppointment({ ...a.base, customerName: 'Früher fertig', startTime: new Date(a.start), endTime: new Date(a.end) });
    await appts.updateAppointment(x.id, { status: 'in-progress' });
    await appts.updateAppointment(x.id, { status: 'completed' });
    const y = await appts.createAppointment({ ...a.base, customerName: 'Danach', startTime: new Date(a.start), endTime: new Date(a.end) });
    return { id: `${x.id},${y.id}` };
  }, { base, start: at(thu, 15, 0), end: at(thu, 15, 30) });
  if (early.ok) created.push(...early.id.split(','));
  rows.push({ name: 'Früher fertig gibt den Platz frei', pass: early.ok, detail: early.ok ? '' : early.message });

  // 6. Nummer ziehen im Ansturm: Alle sehen denselben Platz (09:00) und bestätigen gleichzeitig über den Weg der
  //    Nummernseite. Früher bekam ihn einer und alle anderen mussten neu bestätigen; jetzt nimmt QueueBookingService
  //    für die Nachzügler gleich den nächsten freien Platz. Am Dienstag nach der Testwoche (ohne Pausen und Termine),
  //    Uhr der Geräte dort auf 08:00 gestellt – die Suche nach dem nächsten Platz rechnet ab "jetzt".
  const later = new Date(...day(8));
  const tue = [later.getFullYear(), later.getMonth(), later.getDate()];
  const tueText = `${tue[0]}-${String(tue[1] + 1).padStart(2, '0')}-${String(tue[2]).padStart(2, '0')}`;
  await Promise.all(devices.map(async ({ page }) => {
    await page.clock.setFixedTime(berlin(`${tueText}T08:00:00`));
    await page.evaluate(async () => {
      window.__queue = await import('/src/utils/QueueBookingService.ts');
      const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
      await firebaseAuth.signOut(); // Nummer ziehen ohne Konto
    });
  }));
  const queue = await together(N, async (appts, a, i) => {
    const r = await window.__queue.QueueBookingService.processBooking({
      selectedShop: a.shopId, selectedService: a.serviceId, selectedStaffForSlot: a.staffId,
      nextAvailableSlot: { start: new Date(a.start), end: new Date(a.end), isAvailable: true },
      checkEarlierOptions: false, user: null, contact: { name: `Ansturm ${i + 1}`, phone: '' },
    });
    if (!r.success) throw Object.assign(new Error(r.message || 'nicht eingereiht'), { name: r.error?.name || 'Error' });
    return { id: r.appointmentId, referenceCode: r.referenceCode, start: r.bookedSlot.start.getTime(), end: r.bookedSlot.end.getTime(), moved: r.moved };
  }, { ...base, start: at(tue, 9, 0), end: at(tue, 9, 30) });
  created.push(...queue.filter((r) => r.ok).map((r) => r.id));
  const placed = queue.filter((r) => r.ok).sort((a, b) => a.start - b.start);
  const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const clash = placed.filter((a, i) => placed.some((b, j) => j !== i && a.start < b.end && b.start < a.end));
  const queueCodes = placed.map((r) => r.code);
  rows.push({ name: `Nummer ziehen: ${N} gleichzeitig, alle eingereiht`, pass: placed.length === N,
    detail: queue.filter((r) => !r.ok).map((r) => `${r.name}: ${r.message}`).join(' | ').slice(0, 200) || `${placed.length} eingereiht` });
  rows.push({ name: 'Nummer ziehen: jeder eigener Platz', pass: placed.length === N && clash.length === 0 && new Set(placed.map((r) => r.start)).size === N,
    detail: placed.map((r) => hm(r.start)).join(', ') });
  rows.push({ name: 'Nummer ziehen: lückenlos ab 09:00', pass: placed.length === N && placed.every((r, i) => r.start === at(tue, 9, 0) + i * 30 * 60000),
    detail: `${hm(placed[0]?.start)}–${hm(placed[placed.length - 1]?.end)}` });
  rows.push({ name: 'Nummer ziehen: einer auf 09:00, Rest verschoben', pass: placed.filter((r) => !r.moved).length === 1 && placed.filter((r) => r.moved).length === N - 1,
    detail: `${placed.filter((r) => r.moved).length} verschoben` });
  rows.push({ name: 'Nummer ziehen: jede Nummer nur einmal', pass: queueCodes.every(Boolean) && new Set(queueCodes).size === placed.length, detail: queueCodes.join(', ') });

  // Aufräumen: alles absagen, was dieser Test gebucht hat (wieder als Inhaber)
  await devices[0].page.clock.setFixedTime(new Date());
  await signIn(devices[0].page, fx);
  await devices[0].page.evaluate(async () => { window.__appts = await import('/src/utils/firestore/appointments.ts'); });
  const [cleanup] = await together(1, async (appts, a) => { for (const id of a.ids) await appts.cancelAppointment(id); }, { ids: [...new Set(created)] });
  rows.push({ name: 'Aufräumen', pass: cleanup.ok, detail: cleanup.ok ? `${new Set(created).size} abgesagt` : cleanup.message });
  const errors = devices.flatMap((d) => d.errors);
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ').slice(0, 200) });
  await browser.close();
  return report(rows);
});
