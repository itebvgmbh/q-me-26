// Team und Leistungen über das Backend (frontend/src/utils/firestore/staff.ts und services.ts → /routes/team/…,
// /routes/live/laden/…; requirements/eigene-datenbank.md, Stufe 2). Ohne Testkonto und ohne echte Daten: Anmeldung
// (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Geprüft wird, welche Schnittstelle jede Funktion fragt (öffentlich oder mit Anmeldung), was sie schickt und was
// sie zurückgibt (Zeitpunkte mit toDate(), 404 als null).
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
  const kim = { id: 'kim', shopId: 'laden-test', name: 'Kim', isActive: true, serviceIds: ['schnitt'], workingHours: [], createdAt: zeit('2026-10-01T10:00:00.000000Z') };
  const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/routes/{live,team}/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    anfragen.push({ method: req.method(), path: url.pathname, auth: req.headers()['authorization'] || '', body });
    const p = url.pathname;
    if (p === '/routes/live/laden/laden-test/personen') return json(route, 200, { personen: [kim] });
    if (p === '/routes/team/laden/laden-test/personen')
      return json(route, 200, { personen: [{ ...kim, userId: 'kim-konto', email: 'kim@example.com', inviteExpires: zeit('2026-11-10T10:00:00.000000Z') }] });
    if (p === '/routes/team/ich/personen') return json(route, 200, { personen: [{ ...kim, userId: 'betreiber-test' }] });
    if (p === '/routes/team/personen') return json(route, 200, { person: { ...body.person, id: 'neu1' } });
    if (p.endsWith('/aktiv')) return json(route, 200, { person: { ...kim, isActive: body.aktiv } });
    if (p.startsWith('/routes/team/personen/')) return json(route, 200, { person: { ...kim, ...body.aenderung } });
    if (p === '/routes/live/laden/laden-test/leistungen') return json(route, 200, { leistungen: [{ id: 'schnitt', shopId: 'laden-test', name: 'Schnitt', duration: 30, price: 20 }] });
    if (p === '/routes/live/leistung/schnitt') return json(route, 200, { leistung: { id: 'schnitt', shopId: 'laden-test', name: 'Schnitt', duration: 30, price: 20 } });
    if (p === '/routes/live/leistung/weg') return json(route, 404, { detail: 'Diese Leistung gibt es nicht mehr.' });
    if (p === '/routes/team/leistungen') return json(route, 200, { leistung: { ...body.leistung, id: 'neuL' } });
    if (p.endsWith('/kommende')) return json(route, 200, { anzahl: 3 });
    if (p.startsWith('/routes/team/leistungen/')) return json(route, 200, { leistung: { id: 'schnitt', shopId: 'laden-test', name: 'Schnitt', ...body.aenderung } });
    return json(route, 500, { detail: `unerwartet: ${p}` });
  });

  await signInFake(page);
  const r = await page.evaluate(async () => {
    const staff = await import('/src/utils/firestore/staff.ts');
    const services = await import('/src/utils/firestore/services.ts');
    const out = {};
    out.oeffentlich = await staff.getShopStaff('laden-test');
    out.oeffentlichAngelegt = out.oeffentlich[0].createdAt.toDate().toISOString();
    out.team = await staff.getTeamStaff('laden-test');
    out.teamAblauf = out.team[0].inviteExpires.toDate().toISOString();
    out.erstellt = await staff.createStaff({ shopId: 'laden-test', name: 'Ali', email: 'ali@example.com', phone: undefined, isActive: true, serviceIds: [] });
    out.geaendert = await staff.updateStaff('kim', { name: 'Kimmy', email: 'neu@example.com' });
    await staff.updateStaffWorkingHours('kim', [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isWorking: true }]);
    await staff.deleteStaff('kim');
    await staff.reactivateStaff('kim');
    out.doppelt = (await staff.findTeamMemberByEmail('laden-test', ' KIM@example.com '))?.id ?? null;
    out.eigene = (await staff.getStaffEntriesByUserId('egal')).map((s) => s.id);
    out.leistungen = (await services.getServicesByShopId('laden-test')).map((s) => s.name);
    out.eine = (await services.getServiceById('laden-test', 'schnitt'))?.name ?? null;
    out.fremd = await services.getServiceById('anderer-laden', 'schnitt');
    out.weg = await services.getServiceByIdLegacy('weg');
    out.neueLeistung = (await services.createService({ shopId: 'laden-test', name: 'Bart', duration: 15, price: 12 })).id;
    await services.updateService('schnitt', { price: 25 });
    await services.archiveService('schnitt');
    await services.restoreService('schnitt');
    out.kommende = await services.countUpcomingAppointmentsWithService('laden-test', 'schnitt');
    return out;
  });

  const finde = (method, path) => anfragen.filter((a) => a.method === method && a.path === path);
  const oeff = finde('GET', '/routes/live/laden/laden-test/personen')[0];
  const team = finde('GET', '/routes/team/laden/laden-test/personen');
  const posts = anfragen.filter((a) => a.method === 'POST');
  rows.push({ name: 'Öffentlich: ohne Token', pass: Boolean(oeff) && !oeff.auth && r.oeffentlich[0].name === 'Kim' && r.oeffentlichAngelegt === '2026-10-01T10:00:00.000Z', detail: oeff?.auth || 'ohne' });
  rows.push({ name: 'Team: mit Token, Zeitpunkte zurück', pass: team.length >= 1 && team.every((a) => a.auth.startsWith('Bearer ')) && r.teamAblauf === '2026-11-10T10:00:00.000Z', detail: r.teamAblauf });
  const anlegen = finde('POST', '/routes/team/personen')[0];
  rows.push({ name: 'Person anlegen: Daten ohne undefined', pass: anlegen?.body.person.name === 'Ali' && anlegen.body.person.email === 'ali@example.com' && !('phone' in anlegen.body.person) && r.erstellt.id === 'neu1' });
  const aendern = finde('POST', '/routes/team/personen/kim');
  rows.push({ name: 'Person ändern und Arbeitszeiten', pass: aendern.length === 2 && aendern[0].body.aenderung.name === 'Kimmy' && Array.isArray(aendern[1].body.aenderung.workingHours) && r.geaendert.name === 'Kimmy' });
  const aktiv = finde('POST', '/routes/team/personen/kim/aktiv').map((a) => a.body.aktiv);
  rows.push({ name: 'Deaktivieren und zurückholen', pass: aktiv.join() === 'false,true', detail: aktiv.join() });
  rows.push({ name: '„E-Mail schon im Team?“ über das Team', pass: r.doppelt === 'kim' && team.length >= 2 });
  rows.push({ name: 'Eigene Einträge mit Token', pass: r.eigene.join() === 'kim' && finde('GET', '/routes/team/ich/personen')[0]?.auth.startsWith('Bearer ') });
  rows.push({ name: 'Leistungen öffentlich lesen', pass: r.leistungen.join() === 'Schnitt' && r.eine === 'Schnitt' && r.fremd === null && r.weg === null });
  const lPosts = posts.filter((a) => a.path.startsWith('/routes/team/leistungen'));
  rows.push({ name: 'Leistung anlegen, ändern, aus-/einblenden', pass: r.neueLeistung === 'neuL' && lPosts.length === 4 && lPosts[1].body.aenderung.price === 25 && lPosts[2].body.aenderung.archived === true && lPosts[3].body.aenderung.archived === false, detail: JSON.stringify(lPosts.map((a) => a.body)) });
  rows.push({ name: 'Kommende Termine mit Token', pass: r.kommende === 3 && finde('GET', '/routes/team/leistungen/schnitt/kommende')[0]?.auth.startsWith('Bearer ') });
  rows.push({ name: 'Alle POSTs mit Token', pass: posts.length > 0 && posts.every((a) => a.auth.startsWith('Bearer ')), detail: `${posts.length} POSTs` });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  await browser.close();
  return report(rows);
});
