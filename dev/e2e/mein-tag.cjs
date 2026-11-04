// Mein Tag liest seine Termine vom Backend (frontend/src/utils/hooks/useAppointments.ts → GET /routes/team/termine;
// requirements/eigene-datenbank.md, Stufe 2). Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/
// signInFake) und Backend (page.route) nachgestellt, der Baustein useAppointments direkt im Browser gerendert.
// Geprüft: nur Termine der Person, ohne abgesagte; ein Ereignis „aenderung“ bringt den neuen Stand (aufgerufen, zu ihr
// verschoben) ohne Neuladen; ohne Berechtigung (403) fragt die Seite nicht alle paar Sekunden neu.
// Braucht: Entwicklungsserver (npm run dev).
const { BASE, launch, newPage, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });
const termin = (id, staffId, status, h) => ({
  id, shopId: 'laden-test', staffId, status, type: 'booked', customerName: 'Kunde',
  startTime: zeit(`2026-11-09T${h}:00:00.000000Z`), endTime: zeit(`2026-11-09T${h}:30:00.000000Z`),
});

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await mockAuth(page);

  let geaendert = false;
  const abrufe = { 'laden-test': 0, verboten: 0 };
  const tokens = [];
  await page.route('**/routes/team/termine?**', (route) => {
    const url = new URL(route.request().url());
    const shop = url.searchParams.get('shopId');
    abrufe[shop] = (abrufe[shop] || 0) + 1;
    tokens.push(route.request().headers()['authorization'] || '');
    if (shop === 'verboten') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Das ist nicht dein Laden."}' });
    const termine = geaendert
      ? [termin('a', 'kim', 'in-progress', '09'), termin('c', 'ali', 'scheduled', '10'), termin('d', 'kim', 'scheduled', '11')]
      : [termin('a', 'kim', 'scheduled', '09'), termin('b', 'kim', 'cancelled', '10'), termin('c', 'ali', 'scheduled', '10')];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ termine, kanaele: ['laden:laden-test'] }) });
  });
  let verbindungen = 0;
  await page.route('**/routes/live/ereignisse**', (route) => {
    verbindungen++;
    const body = verbindungen === 1
      ? 'retry: 500\n\nevent: bereit\ndata: {}\n\n'
      : verbindungen === 2
        ? 'retry: 600000\n\nevent: aenderung\ndata: {"kanal": "laden:laden-test"}\n\n'
        : 'retry: 600000\n\n: ruhe\n\n';
    if (verbindungen === 2) geaendert = true;
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body });
  });

  await signInFake(page);
  // useAppointments direkt rendern: React aus denselben Modulen wie die App (Pfade so, wie Vite sie ausliefert)
  await page.evaluate(async () => {
    const main = await (await fetch('/src/main.tsx')).text();
    // Vite liefert React als CommonJS-Paket mit default-Export aus
    const React = (await import(main.match(/from "([^"]*\/react\.js[^"]*)"/)[1])).default;
    const { createRoot } = (await import(main.match(/from "([^"]*react-dom_client[^"]*)"/)[1])).default;
    const { useAppointments } = await import('/src/utils/hooks/useAppointments.ts');
    const start = new Date('2026-11-09T00:00:00+01:00');
    const Probe = ({ shopId, ablage }) => {
      const employee = React.useMemo(() => ({ id: 'kim', shopId, name: 'Kim' }), [shopId]);
      const { appointments } = useAppointments(employee, start, 1);
      React.useEffect(() => {
        window[ablage] = appointments.map((a) => `${a.id}:${a.status}:${a.startTime.toDate().toISOString().slice(11, 16)}`);
      }, [appointments]);
      return null;
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    createRoot(el).render(React.createElement(React.Fragment, null,
      React.createElement(Probe, { shopId: 'laden-test', ablage: '__meinTag' }),
      React.createElement(Probe, { shopId: 'verboten', ablage: '__verboten' }),
    ));
  });

  const warte = async (pruefen, ms = 8000) => {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
      if (await page.evaluate(pruefen)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  const zuerst = await warte(() => (window.__meinTag || []).join() === 'a:scheduled:09:00');
  const erst = await page.evaluate(() => window.__meinTag);
  const danach = await warte(() => (window.__meinTag || []).join() === 'a:in-progress:09:00,d:scheduled:11:00');
  const zweit = await page.evaluate(() => window.__meinTag);
  await page.waitForTimeout(7000); // länger als der schnelle Wiederholversuch nach Fehlern (5 s)

  rows.push({ name: 'Nur die Person, ohne abgesagte', pass: zuerst, detail: JSON.stringify(erst) });
  rows.push({ name: '„aenderung“: neuer Stand ohne Neuladen', pass: danach, detail: JSON.stringify(zweit) });
  rows.push({ name: 'Mit Anmelde-Token gefragt', pass: tokens.length >= 2 && tokens.every((t) => t.startsWith('Bearer ')), detail: `${tokens.length} Abrufe` });
  rows.push({ name: '403: kein schneller Wiederholversuch', pass: abrufe.verboten === 1, detail: `${abrufe.verboten} Abrufe in ~10 s` });
  rows.push({ name: '403: keine Termine', pass: (await page.evaluate(() => window.__verboten || [])).length === 0 });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  await browser.close();
  return report(rows);
});
