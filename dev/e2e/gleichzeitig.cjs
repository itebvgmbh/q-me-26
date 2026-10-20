// Gleichzeitig buchen (Belegung je Person und Tag, frontend/src/utils/firestore/schedule.ts):
// Jedes "Gerät" ist ein eigener Browser mit eigener Datenbankverbindung, alle schreiben im selben Moment.
//  1. 10 ziehen dieselbe Nummer (gleicher Platz)        → genau einer bekommt ihn, die anderen "schon ein Termin"
//  2. 10 buchen verschiedene Plätze                     → alle klappen, 10 verschiedene Nummern
//  3. 2 Termine werden auf denselben Platz verschoben   → nur einer
//  4. Absage gibt den Platz frei                        → danach geht er wieder
// Braucht: Entwicklungsserver und Testdaten (python dev/fixtures.py anlegen). Bucht Donnerstag/Freitag der
// Testwoche und sagt am Ende alles wieder ab.
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

const N = Number(process.env.QME_GERAETE || 10);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const devices = await Promise.all(Array.from({ length: N }, async () => {
    const page = await newPage(browser);
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
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
    return Promise.all(devices.slice(0, count).map(({ page }, i) => page.evaluate(async ({ t0, fn, arg, i }) => {
      while (Date.now() < t0) await new Promise((r) => setTimeout(r, 5));
      try {
        // eslint-disable-next-line no-new-func
        const result = await new Function('appts', 'arg', 'i', `return (${fn})(appts, arg, i);`)(window.__appts, arg, i);
        return { ok: true, id: result?.id, code: result?.referenceCode };
      } catch (e) {
        return { ok: false, name: e.name, message: e.message };
      }
    }, { t0, fn: fn.toString(), arg, i })));
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

  // Aufräumen: alles absagen, was dieser Test gebucht hat
  const [cleanup] = await together(1, async (appts, a) => { for (const id of a.ids) await appts.cancelAppointment(id); }, { ids: [...new Set(created)] });
  rows.push({ name: 'Aufräumen', pass: cleanup.ok, detail: cleanup.ok ? `${new Set(created).size} abgesagt` : cleanup.message });
  const errors = devices.flatMap((d) => d.errors);
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ').slice(0, 200) });
  await browser.close();
  return report(rows);
});
