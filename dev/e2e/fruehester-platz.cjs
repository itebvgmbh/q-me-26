// Frühester Platz (Nummer ziehen): Sammel-Suche findEarliestSlots muss dasselbe liefern wie die
// Tag-für-Tag-Rechnung getAvailableTimeslotsDirect – bei verschiedenen Uhrzeiten (Browser-Uhr verstellt).
// Braucht: Entwicklungsserver und Testdaten.
const { BASE, berlin, launch, collectErrors, fixture, report, run } = require('./lib.cjs');

const plusDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

run(async () => {
  const fx = fixture();
  const mo = fx.monday;
  const sa = plusDays(mo, -2);
  const fr = plusDays(mo, -3);
  // [Uhrzeit, erwarteter Platz, Grund]
  const scenarios = [
    [`${mo}T11:50:00`, `${mo} 13:00`, 'vor der Mittagspause → nach der Pause'],
    [`${mo}T09:50:00`, `${mo} 10:30`, 'bestehender Termin 10:00–10:30'],
    [`${sa}T10:00:00`, `${mo} 09:00`, 'Wochenende zu → Montag'],
    [`${fx.tuesday}T14:40:00`, `${fx.tuesday} 15:30`, 'einmalige Pause 15:00–15:30'],
    [`${fr}T16:40:00`, `${mo} 09:00`, 'kurz vor Feierabend → Montag'],
  ];
  const browser = await launch();
  const rows = [];
  for (const [clock, expected, why] of scenarios) {
    const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.clock.setFixedTime(berlin(clock));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const out = await page.evaluate(async (fx) => {
      const { getAvailableTimeslotsDirect, findEarliestSlots } = await import('/src/utils/firestore/timeslots.ts');
      const fmt = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}` : 'nichts');
      const batch = await findEarliestSlots(fx.shopId, fx.serviceId, [fx.staffId]);
      let ref = null;
      for (let i = 0; i < 14 && !ref; i++) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        ref = (await getAvailableTimeslotsDirect(fx.shopId, fx.serviceId, fx.staffId, ds)).find((s) => s.start.getTime() > Date.now()) || null;
      }
      return { batch: fmt(batch[fx.staffId]?.start), ref: fmt(ref?.start) };
    }, fx);
    rows.push({ name: `${clock.replace('T', ' ').slice(0, 16)} (${why})`, pass: out.batch === expected && out.ref === expected && errors.length === 0, detail: `Sammel ${out.batch} / Tag für Tag ${out.ref} / erwartet ${expected}` });
    await context.close();
  }
  await browser.close();
  return report(rows);
});
