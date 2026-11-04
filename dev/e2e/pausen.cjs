// Pausen über das Backend (frontend/src/utils/firestore/breaks.ts und recurring-breaks.ts → /routes/team/pausen,
// /routes/team/feste-pausen, /routes/live/person/{id}/pausen; requirements/eigene-datenbank.md, Stufe 2).
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Geprüft: Lesen öffentlich und nach Tag bzw. Wochentag gefiltert, Pflegen mit Token und richtigem Körper,
// Überschneidungen erkannt (auch mit alten Einträgen, deren Zeiten Text sind).
// Braucht: Entwicklungsserver (npm run dev).
const { launch, newPage, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await mockAuth(page);

  const anfragen = [];
  const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/routes/{live,team}/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    anfragen.push({ method: req.method(), path: p, auth: req.headers()['authorization'] || '', body });
    if (p === '/routes/live/person/kim/pausen') {
      return json(route, 200, {
        einzeln: [
          { id: 'b1', shopId: 'laden-test', staffId: 'kim', date: zeit('2026-11-09T23:00:00.000000Z'), startTime: zeit('2026-11-10T11:00:00.000000Z'), endTime: zeit('2026-11-10T11:30:00.000000Z') },
          { id: 'b2', shopId: 'laden-test', staffId: 'kim', date: zeit('2026-11-11T23:00:00.000000Z'), startTime: zeit('2026-11-12T11:00:00.000000Z'), endTime: zeit('2026-11-12T11:30:00.000000Z') },
          { id: 'alt', shopId: 'laden-test', staffId: 'kim', date: zeit('2026-11-09T23:00:00.000000Z'), startTime: '15:00', endTime: '15:30' },
        ],
        fest: [
          { id: 'r1', shopId: 'laden-test', staffId: 'kim', dayOfWeek: 2, startTime: '12:00', endTime: '13:00', type: 'lunch', active: true },
          { id: 'r2', shopId: 'laden-test', staffId: 'kim', dayOfWeek: 2, startTime: '16:00', endTime: '16:15', type: 'coffee', active: false },
        ],
      });
    }
    if (p.endsWith('/loeschen')) return json(route, 200, { geloescht: p.split('/').at(-2) });
    if (p === '/routes/team/pausen' || p === '/routes/team/feste-pausen') return json(route, 200, { pause: { ...body.pause, id: 'neu1' } });
    if (p.startsWith('/routes/team/')) return json(route, 200, { pause: { id: p.split('/').at(-1), ...body.aenderung } });
    return json(route, 500, { detail: `unerwartet: ${p}` });
  });

  await signInFake(page);
  const r = await page.evaluate(async () => {
    const breaks = await import('/src/utils/firestore/breaks.ts');
    const fest = await import('/src/utils/firestore/recurring-breaks.ts');
    const tag = new Date('2026-11-10T12:00:00+01:00');
    const out = {};
    out.amTag = (await breaks.getBreaksByStaffAndDate('kim', tag)).map((b) => b.id).sort();
    out.konfliktJa = await breaks.checkBreakConflicts('kim', new Date('2026-11-10T12:15:00+01:00'), new Date('2026-11-10T12:45:00+01:00'));
    out.konfliktNein = await breaks.checkBreakConflicts('kim', new Date('2026-11-10T13:00:00+01:00'), new Date('2026-11-10T13:30:00+01:00'));
    out.konfliktSelbst = await breaks.checkBreakConflicts('kim', new Date('2026-11-10T12:15:00+01:00'), new Date('2026-11-10T12:45:00+01:00'), 'b1');
    out.neu = (await breaks.createBreak({ shopId: 'laden-test', staffId: 'kim', date: new Date('2026-11-10T00:00:00+01:00'), startTime: new Date('2026-11-10T09:00:00+01:00'), endTime: new Date('2026-11-10T09:15:00+01:00'), type: 'Kaffee' })).id;
    await breaks.updateBreak('b1', { type: 'Termin' });
    await breaks.deleteBreak('b1');
    out.festAlle = (await fest.getRecurringBreaksByStaff('kim')).map((b) => b.id);
    out.festDienstag = (await fest.getRecurringBreaksByStaffAndDay('kim', 2)).map((b) => b.id);
    out.festKonflikt = await fest.checkRecurringBreakConflicts('kim', 2, '12:30', '12:45');
    out.festFrei = await fest.checkRecurringBreakConflicts('kim', 2, '16:00', '16:15'); // r2 ist aus
    out.festNeu = (await fest.createRecurringBreak({ shopId: 'laden-test', staffId: 'kim', dayOfWeek: 3, startTime: '10:00', endTime: '10:15', type: 'coffee', active: true })).id;
    await fest.updateRecurringBreak('r1', { active: false });
    await fest.deleteRecurringBreak('r1');
    return out;
  });

  const posts = anfragen.filter((a) => a.method === 'POST');
  // Die Startseite (signInFake) lädt nebenbei die Ladenliste – die gehört nicht zu den Pausen
  const lesen = anfragen.filter((a) => a.method === 'GET' && a.path !== '/routes/live/laeden');
  const post = (path) => posts.find((a) => a.path === path);
  const fremd = lesen.filter((a) => a.path !== '/routes/live/person/kim/pausen' || a.auth);
  rows.push({ name: 'Lesen öffentlich, ohne Token', pass: lesen.length > 0 && fremd.length === 0, detail: `${lesen.length} Abrufe ${fremd.map((a) => `${a.path}${a.auth ? ' (Token)' : ''}`).join(', ')}` });
  rows.push({ name: 'Einzelne Pausen nach Tag (auch alte)', pass: r.amTag.join() === 'alt,b1', detail: r.amTag.join() });
  rows.push({ name: 'Überschneidung erkannt, alte übergangen', pass: r.konfliktJa === true && r.konfliktNein === false && r.konfliktSelbst === false, detail: JSON.stringify([r.konfliktJa, r.konfliktNein, r.konfliktSelbst]) });
  const anlegen = post('/routes/team/pausen');
  rows.push({ name: 'Einzelne anlegen: Zeitpunkte als {"__zeit"}', pass: r.neu === 'neu1' && anlegen?.body.pause.startTime.__zeit === '2026-11-10T08:00:00.000Z' && anlegen.auth.startsWith('Bearer ') });
  rows.push({ name: 'Einzelne ändern und löschen', pass: post('/routes/team/pausen/b1')?.body.aenderung.type === 'Termin' && Boolean(post('/routes/team/pausen/b1/loeschen')) });
  rows.push({ name: 'Feste: Wochentag und nur aktive', pass: r.festAlle.join() === 'r1,r2' && r.festDienstag.join() === 'r1' && r.festKonflikt === true && r.festFrei === false });
  rows.push({ name: 'Feste anlegen, abschalten, löschen', pass: r.festNeu === 'neu1' && post('/routes/team/feste-pausen')?.body.pause.dayOfWeek === 3 && post('/routes/team/feste-pausen/r1')?.body.aenderung.active === false && Boolean(post('/routes/team/feste-pausen/r1/loeschen')) });
  rows.push({ name: 'Alle POSTs mit Token', pass: posts.length === 6 && posts.every((a) => a.auth.startsWith('Bearer ')), detail: `${posts.length} POSTs` });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  await browser.close();
  return report(rows);
});
