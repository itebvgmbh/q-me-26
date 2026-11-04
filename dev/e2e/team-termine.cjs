// Termine des Teams über das Backend (requirements/eigene-datenbank.md, Stufe 2, Bereich Tresen und Kalender):
// createAppointment und updateAppointment (frontend/src/utils/firestore/appointments.ts) schicken an
// /routes/team/termine statt selbst in Firestore zu schreiben. Ohne Testkonto und ohne echte Daten:
//  - Anmeldung nachgebildet (lib.cjs mockAuth/signInFake), Firestore abgeschaltet,
//  - Backend nachgestellt (page.route), Regelprüfung (utils/booking-rules.ts) durch eine Attrappe ersetzt.
// Geprüft wird, was der Browser schickt (Zeitpunkte als {"__zeit"}, Anmelde-Token, Benachrichtigung) und wie er die
// Antwort zurückverwandelt (Zeitpunkte mit toDate(), 409 als SlotConflictError), dazu das Lesen der Tagesliste.
// Braucht: Entwicklungsserver (npm run dev).
const { BASE, launch, newPage, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await mockAuth(page);

  // Regelprüfung: erlaubt alles, merkt sich die Aufrufe (die echte liest aus Firestore)
  await page.route('**/src/utils/booking-rules.ts*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.__regeln = [];
        export class SlotConflictError extends Error { constructor(m) { super(m); this.name = 'SlotConflictError'; } }
        export const isSlotConflict = (e) => e instanceof SlotConflictError || e?.name === 'SlotConflictError';
        export const bookableOf = async (shopId, slots) => { window.__regeln.push(['bookableOf', shopId, slots.length]); return slots; };
        export const assertBookable = async (p) => { window.__regeln.push(['assertBookable', p.staffId, p.start.toISOString()]); };
      `,
    }),
  );

  const anfragen = [];
  const original = {
    id: 't1', shopId: 'laden-test', staffId: 'kim', serviceId: 'schnitt', status: 'scheduled', type: 'booked',
    startTime: zeit('2026-11-09T09:00:00.000000Z'), endTime: zeit('2026-11-09T09:30:00.000000Z'), customerName: 'Robin',
  };
  await page.route('**/routes/team/termine**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    anfragen.push({ method: req.method(), path: url.pathname, search: url.search, auth: req.headers()['authorization'] || '', body });
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.method() === 'GET' && url.pathname.endsWith('/team/termine')) return json(200, { termine: [original], kanaele: ['laden:laden-test'] });
    if (req.method() === 'GET') return json(200, { termin: original });
    if (url.pathname.endsWith('/team/termine')) {
      if (body.termin.customerName === 'Doppelt') return json(409, { detail: 'Da ist schon ein Termin (10:00–10:30).' });
      return json(200, { termin: { ...body.termin, id: 'neu1', referenceCode: '23', createdAt: zeit('2026-11-04T12:00:00.000000Z') } });
    }
    return json(200, { termin: { ...original, ...body.aenderung, calledAt: zeit('2026-11-09T08:55:00.000000Z') } });
  });
  // Ereignisse für die Tagesliste: nur „bereit“, dann Ruhe
  await page.route('**/routes/live/ereignisse**', (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: 'retry: 600000\n\nevent: bereit\ndata: {}\n\n' }),
  );

  await signInFake(page);
  const ergebnis = await page.evaluate(async () => {
    // Firestore-Timestamp wie in den Komponenten (Vite liefert das Paket unter einem eigenen Pfad aus)
    const quelle = await (await fetch('/src/utils/firestore/appointments.ts')).text();
    const { Timestamp } = await import(quelle.match(/from "([^"]*firebase[_/]firestore[^"]*)"/)[1]);
    const dl = await import('/src/utils/firestore/appointments.ts');
    const live = await import('/src/utils/live.ts');
    const r = {};
    const neu = await dl.createAppointment({
      shopId: 'laden-test', staffId: 'kim', serviceId: 'schnitt', status: 'scheduled', type: 'queue', customerName: 'Kara',
      customerPhone: undefined, startTime: Timestamp.fromDate(new Date('2026-11-09T10:00:00Z')), endTime: new Date('2026-11-09T10:30:00Z'),
    });
    r.neu = { id: neu.id, code: neu.referenceCode, start: neu.startTime.toDate().toISOString(), seconds: neu.startTime.seconds };
    try {
      await dl.createAppointment({ shopId: 'laden-test', staffId: 'kim', status: 'scheduled', customerName: 'Doppelt', startTime: new Date('2026-11-09T10:15:00Z'), endTime: new Date('2026-11-09T10:45:00Z') });
      r.konflikt = 'kein Fehler';
    } catch (e) {
      r.konflikt = { name: e.name, message: e.message, status: e.status };
    }
    const status = await dl.updateAppointment('t1', { status: 'in-progress' }, { notifyCustomer: true });
    r.status = { status: status.status, called: status.calledAt.toDate().toISOString() };
    const verschoben = await dl.updateAppointment('t1', { startTime: Timestamp.fromDate(new Date('2026-11-09T11:00:00Z')), endTime: Timestamp.fromDate(new Date('2026-11-09T11:30:00Z')) });
    r.verschoben = verschoben.startTime.toDate().toISOString();
    const liste = await live.liveLesen(live.teamTerminePfad('laden-test', new Date('2026-11-09T00:00:00+01:00'), new Date('2026-11-10T00:00:00+01:00')), true);
    r.liste = { anzahl: liste.termine.length, start: liste.termine[0].startTime.toDate().toISOString(), kanaele: liste.kanaele };
    r.regeln = window.__regeln;
    return r;
  });

  const [anlegen, doppelt, lesen1, aufrufen, lesen2, verschieben, liste] = anfragen;
  rows.push({ name: 'Anlegen: POST /team/termine mit Token', pass: anlegen?.method === 'POST' && anlegen.path === '/routes/team/termine' && anlegen.auth.startsWith('Bearer '), detail: anlegen?.auth.slice(0, 12) });
  rows.push({ name: 'Anlegen: Zeitpunkte als {"__zeit"}', pass: anlegen?.body.termin.startTime.__zeit === '2026-11-09T10:00:00.000Z' && anlegen.body.termin.endTime.__zeit === '2026-11-09T10:30:00.000Z', detail: JSON.stringify(anlegen?.body.termin.startTime) });
  rows.push({ name: 'Anlegen: undefined fällt weg', pass: anlegen && !('customerPhone' in anlegen.body.termin) });
  rows.push({ name: 'Anlegen: Antwort mit Zeitpunkt zurück', pass: ergebnis.neu.id === 'neu1' && ergebnis.neu.code === '23' && ergebnis.neu.start === '2026-11-09T10:00:00.000Z' && ergebnis.neu.seconds === Date.parse('2026-11-09T10:00:00Z') / 1000, detail: JSON.stringify(ergebnis.neu) });
  rows.push({ name: 'Anlegen: Regeln vorher geprüft', pass: ergebnis.regeln.filter((x) => x[0] === 'bookableOf').length === 2 });
  rows.push({ name: 'Konflikt: 409 als SlotConflictError', pass: doppelt?.method === 'POST' && ergebnis.konflikt.name === 'SlotConflictError' && ergebnis.konflikt.message === 'Da ist schon ein Termin (10:00–10:30).' && ergebnis.konflikt.status === 409, detail: JSON.stringify(ergebnis.konflikt) });
  rows.push({ name: 'Ändern: erst den Termin lesen', pass: lesen1?.method === 'GET' && lesen1.path === '/routes/team/termine/t1' && lesen1.auth.startsWith('Bearer ') });
  rows.push({ name: 'Aufrufen: Status und Benachrichtigung', pass: aufrufen?.body.aenderung.status === 'in-progress' && aufrufen.body.kundeBenachrichtigen === true && ergebnis.status.status === 'in-progress' && ergebnis.status.called === '2026-11-09T08:55:00.000Z', detail: JSON.stringify(aufrufen?.body) });
  rows.push({ name: 'Aufrufen: ohne Regelprüfung', pass: !ergebnis.regeln.some((x) => x[0] === 'assertBookable' && x[2] === '2026-11-09T09:00:00.000Z') });
  rows.push({ name: 'Verschieben: Regeln für die neue Zeit', pass: ergebnis.regeln.some((x) => x[0] === 'assertBookable' && x[1] === 'kim' && x[2] === '2026-11-09T11:00:00.000Z') && lesen2?.method === 'GET', detail: JSON.stringify(ergebnis.regeln) });
  rows.push({ name: 'Verschieben: neue Zeit geschickt', pass: verschieben?.body.aenderung.startTime.__zeit === '2026-11-09T11:00:00.000Z' && verschieben.body.kundeBenachrichtigen === false && ergebnis.verschoben === '2026-11-09T11:00:00.000Z' });
  rows.push({ name: 'Tagesliste: mit Token und Zeitraum', pass: liste?.method === 'GET' && liste.auth.startsWith('Bearer ') && liste.search.includes('shopId=laden-test') && liste.search.includes('von=2026-11-08T23%3A00%3A00.000Z') && ergebnis.liste.anzahl === 1 && ergebnis.liste.kanaele[0] === 'laden:laden-test', detail: liste?.search });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  await browser.close();
  return report(rows);
});
