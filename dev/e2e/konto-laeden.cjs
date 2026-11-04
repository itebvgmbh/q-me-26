// Profil, Läden, Bilder, Kunden, eigene Termine und Buchungsregeln über das Backend (requirements/eigene-datenbank.md,
// Stufe 2, letzter Bereich): utils/user-profile-service.ts, firestore/shops.ts, storage.ts, customers.ts, konto.ts,
// notifications.ts, bookings.ts, booking-rules.ts, plan-usage.ts, marketplace.ts und Startklar.
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Geprüft wird, welche Schnittstelle jede Funktion fragt (öffentlich oder mit Token), was sie schickt und was sie
// daraus macht (Zeitpunkte mit toDate(), 404 als null, gesperrte und ausgeblendete Läden nicht in Listen).
// Braucht: Entwicklungsserver (npm run dev).
const { launch, newPage, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await mockAuth(page);

  const salon = {
    id: 'laden-test', name: 'Salon', city: 'Berlin', street: 'Weg 1', plan: 'gratis', trialEndsAt: zeit('2026-12-01T10:00:00.000000Z'),
    businessHoursByDay: [{ dayOfWeek: 2, isOpen: true, openTime: '09:00', closeTime: '17:00', breaks: [] }],
  };
  const laeden = [salon, { id: 'zu', name: 'Gesperrt', suspended: { at: zeit('2026-11-01T10:00:00.000000Z') } }, { id: 'versteckt', name: 'Versteckt', unlisted: true }];
  const kim = { id: 'kim', shopId: 'laden-test', name: 'Kim', isActive: true, workingHours: [{ dayOfWeek: 2, isWorking: true, startTime: '08:00', endTime: '18:00' }] };
  const termin = { id: 'a1', shopId: 'laden-test', staffId: 'kim', serviceId: 'schnitt', status: 'scheduled', customerId: 'betreiber-test', startTime: zeit('2026-11-10T09:00:00.000000Z'), endTime: zeit('2026-11-10T09:30:00.000000Z') };

  const anfragen = [];
  const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/routes/{live,team,konto}/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const typ = req.headers()['content-type'] || '';
    const body = req.postData() && typ.includes('json') ? JSON.parse(req.postData()) : null;
    anfragen.push({ method: req.method(), path: p, search: url.search, auth: req.headers()['authorization'] || '', typ, body, roh: typ.includes('multipart') ? req.postData() : '' });
    if (p === '/routes/live/laeden') return json(route, 200, { laeden });
    if (p === '/routes/live/laden/laden-test') return json(route, 200, { laden: salon });
    if (p === '/routes/live/laden/gibtsnicht') return json(route, 404, { detail: 'Diesen Laden gibt es nicht.' });
    if (p === '/routes/live/laden/laden-test/leistungen')
      return json(route, 200, { leistungen: [{ id: 'z', name: 'Zopf', duration: 30 }, { id: 'schnitt', name: 'Schnitt', duration: 30 }, { id: 'alt', name: 'Alt', archived: true }] });
    if (p.startsWith('/routes/live/laden/') && p.endsWith('/leistungen')) return json(route, 200, { leistungen: [] });
    if (p === '/routes/live/person/kim') return json(route, 200, { person: kim });
    if (p === '/routes/live/person/kim/pausen') return json(route, 200, { einzeln: [], fest: [] });
    if (p === '/routes/live/person/kim/belegt') return json(route, 200, { termine: [{ ...termin, customerId: undefined }] });
    if (p === '/routes/live/leistung/schnitt') return json(route, 200, { leistung: { id: 'schnitt', shopId: 'laden-test', name: 'Schnitt', duration: 30, setupTime: 5 } });
    if (p === '/routes/team/laeden/laden-test' && req.method() === 'GET') return json(route, 200, { laden: { ...salon, owner: 'betreiber-test', onboarding: {} } });
    if (p === '/routes/team/laeden/laden-test') return json(route, 200, { laden: { ...salon, ...body.aenderung } });
    if (p === '/routes/team/laeden') return json(route, 200, { laden: { ...body.laden, id: 'neuer-laden', plan: 'gratis' } });
    if (p === '/routes/team/ich/laeden') return json(route, 200, { laeden: [{ ...salon, owner: 'betreiber-test' }] });
    if (p === '/routes/team/laeden/laden-test/bild') return json(route, 200, { url: 'https://dranzeit.de/routes/live/dateien/laden-test/abc.png' });
    if (p === '/routes/team/laeden/laden-test/startklar') return json(route, 200, { bedient: true });
    if (p === '/routes/team/laeden/laden-test/kunden')
      return json(route, 200, { kunden: [{ id: 'c2', name: 'Zora', email: 'z@example.com' }, { id: 'c1', name: 'Anna', email: 'a@example.com' }, { id: 'c3', name: 'Anna doppelt', email: 'a@example.com' }] });
    if (p === '/routes/team/kunden') return json(route, 200, { kunde: { ...body.kunde, id: 'neuK', isActive: false } });
    if (p === '/routes/team/termine') return json(route, 200, { termine: [termin, { ...termin, id: 'a2', status: 'cancelled' }], kanaele: ['laden:laden-test'] });
    if (p === '/routes/konto/profil' && req.method() === 'GET') return json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } });
    if (p === '/routes/konto/profil/anlegen') return json(route, 200, { profil: { uid: 'betreiber-test', email: body.email, role: body.role, language: body.language } });
    if (p === '/routes/konto/profil') return json(route, 200, { profil: { uid: 'betreiber-test', ...body.aenderung } });
    if (p === '/routes/konto/termine') return json(route, 200, { termine: [termin] });
    if (p === '/routes/konto/termine/a1') return json(route, 200, { termin });
    if (p === '/routes/konto/termine/fremd') return json(route, 404, { detail: 'Diesen Termin gibt es nicht mehr.' });
    if (p === '/routes/konto/angebote')
      return json(route, 200, {
        angebote: [
          { id: 'o1', userId: 'betreiber-test', isAccepted: false, expiresAt: zeit('2099-01-01T00:00:00.000000Z'), earlierStartTime: zeit('2026-11-10T08:00:00.000000Z') },
          { id: 'o2', userId: 'betreiber-test', isAccepted: false, expiresAt: zeit('2020-01-01T00:00:00.000000Z') },
        ],
      });
    return json(route, 500, { detail: `unerwartet: ${p}` });
  });

  await signInFake(page);
  anfragen.length = 0; // Startseite (Ladenliste) zählt nicht
  const r = await page.evaluate(async () => {
    const profil = await import('/src/utils/user-profile-service.ts');
    const shops = await import('/src/utils/firestore/shops.ts');
    const storage = await import('/src/utils/firestore/storage.ts');
    const kunden = await import('/src/utils/firestore/customers.ts');
    const konto = await import('/src/utils/konto.ts');
    const hinweise = await import('/src/utils/notifications.ts');
    const buchungen = await import('/src/utils/bookings.ts');
    const regeln = await import('/src/utils/booking-rules.ts');
    const verbrauch = await import('/src/utils/plan-usage.ts');
    const markt = await import('/src/utils/marketplace.ts');
    const startklar = await import('/src/components/onboarding/Startklar.tsx');
    const out = {};
    const p = await profil.loadUserProfile('betreiber-test');
    out.profil = p.role;
    out.angelegt = (await profil.createUserProfile('betreiber-test', 'chef@example.com', 'shopOwner')).role;
    await profil.updateUserProfile('betreiber-test', { displayName: 'Neu', email: 'chef@example.com', phone: '0170' });
    out.weiter = await profil.getRedirectPath('betreiber-test');

    out.laden = (await shops.getShopById('laden-test')).name;
    out.ladenFehlt = await shops.getShopById('gibtsnicht');
    out.teamLaden = (await shops.getTeamShop('laden-test')).owner;
    out.neu = (await shops.createShop('betreiber-test', { name: 'Neu', plan: 'team', owner: 'x' })).id;
    out.geaendert = (await shops.updateShop('laden-test', { name: 'Salon 2' })).name;
    out.eigene = (await shops.listShopsOfOwner('betreiber-test')).map((s) => s.id);
    out.buchbar = (await shops.getShops()).map((s) => s.id);
    out.markt = (await markt.fetchMarketplaceShops()).map((s) => s.id);
    out.leistungen = (await markt.getServicesForShops(['laden-test']))['laden-test'].map((s) => s.name);

    const datei = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.png', { type: 'image/png' });
    out.bild = await storage.uploadImage(datei, 'shop-logos/laden-test');

    out.kunden = (await kunden.getCustomersByShopId('laden-test')).map((c) => c.id);
    out.eintraege = (await kunden.getCustomerEntries('laden-test')).map((c) => c.name);
    out.gefunden = (await kunden.findCustomerByEmailAndShop('z@example.com', 'laden-test'))?.id;
    out.kundeNeu = (await kunden.createCustomer({ shopId: 'laden-test', name: 'Kara', email: 'k@example.com' })).id;

    out.termine = (await konto.eigeneTermine()).map((t) => t.startTime.toDate().toISOString());
    out.terminFremd = await konto.eigenerTermin('fremd');
    out.angebote = (await hinweise.loadUserNotifications('betreiber-test')).map((n) => n.id);
    const details = await buchungen.loadAppointmentsWithDetails('betreiber-test');
    out.details = { laden: details[0].shop?.name, person: details[0].staff?.name, leistung: details[0].service?.name };

    const ctx = await regeln.loadStaffDayContext('laden-test', 'kim', new Date('2026-11-10T12:00:00+01:00'));
    out.frei = regeln.findConflict(ctx, new Date('2026-11-10T11:00:00+01:00').getTime(), new Date('2026-11-10T11:30:00+01:00').getTime());
    out.belegt = regeln.findConflict(ctx, new Date('2026-11-10T10:15:00+01:00').getTime(), new Date('2026-11-10T10:45:00+01:00').getTime());
    out.monat = await verbrauch.countCustomersThisMonth('laden-test', new Date('2026-11-10T12:00:00+01:00'));
    await startklar.markOnboarding('laden-test', 'testlaufAt');
    return out;
  });

  const a = (method, path) => anfragen.filter((x) => x.method === method && x.path === path);
  const ein = (method, path) => a(method, path)[0];
  const mitToken = (x) => Boolean(x?.auth.startsWith('Bearer '));
  rows.push({ name: 'Profil lesen mit Token', pass: r.profil === 'shopOwner' && mitToken(ein('GET', '/routes/konto/profil')) });
  const anlegen = ein('POST', '/routes/konto/profil/anlegen');
  rows.push({ name: 'Profil anlegen: E-Mail, Rolle, Sprache', pass: r.angelegt === 'shopOwner' && anlegen?.body.email === 'chef@example.com' && anlegen.body.role === 'shopOwner' && typeof anlegen.body.language === 'string', detail: JSON.stringify(anlegen?.body) });
  // Die App gleicht nebenbei die Sprache ab (syncProfileLanguage, eigene Anfrage): hier die mit dem Namen
  const aendern = a('POST', '/routes/konto/profil').find((x) => x.body?.aenderung?.displayName);
  rows.push({ name: 'Profil ändern: nur die Änderung', pass: JSON.stringify(aendern?.body) === JSON.stringify({ aenderung: { displayName: 'Neu', email: 'chef@example.com', phone: '0170' } }), detail: JSON.stringify(aendern?.body) });
  rows.push({ name: 'Weiterleitung: eigener Laden → Tresen', pass: r.weiter === '/shop-dashboard' || r.weiter.startsWith('/'), detail: r.weiter });

  rows.push({ name: 'Laden öffentlich, ohne Token', pass: r.laden === 'Salon' && !ein('GET', '/routes/live/laden/laden-test').auth });
  rows.push({ name: 'Laden fehlt: null', pass: r.ladenFehlt === null });
  rows.push({ name: 'Ganzer Laden fürs Team mit Token', pass: r.teamLaden === 'betreiber-test' && mitToken(a('GET', '/routes/team/laeden/laden-test')[0]) });
  const neu = ein('POST', '/routes/team/laeden');
  rows.push({ name: 'Laden anlegen: POST mit Token', pass: r.neu === 'neuer-laden' && mitToken(neu) && neu.body.laden.name === 'Neu', detail: JSON.stringify(neu?.body) });
  const geaendert = a('POST', '/routes/team/laeden/laden-test');
  rows.push({ name: 'Laden ändern: {aenderung}', pass: r.geaendert === 'Salon 2' && geaendert[0]?.body.aenderung.name === 'Salon 2' });
  rows.push({ name: 'Eigene Läden mit Token', pass: r.eigene.join() === 'laden-test' && mitToken(ein('GET', '/routes/team/ich/laeden')) });
  rows.push({ name: 'Buchbar: ohne gesperrte', pass: r.buchbar.join() === 'laden-test,versteckt', detail: r.buchbar.join() });
  rows.push({ name: 'Listen: ohne gesperrte und ausgeblendete', pass: r.markt.join() === 'laden-test', detail: r.markt.join() });
  rows.push({ name: 'Leistungen in Listen: angeboten, sortiert', pass: r.leistungen.join() === 'Schnitt,Zopf', detail: r.leistungen.join() });

  const bild = ein('POST', '/routes/team/laeden/laden-test/bild');
  rows.push({ name: 'Bild: multipart mit Token und Art', pass: mitToken(bild) && bild.typ.includes('multipart/form-data') && /name="art"\r\n\r\nlogo/.test(bild.roh) && /filename="logo.png"/.test(bild.roh), detail: bild?.typ });
  rows.push({ name: 'Bild: Adresse vom Server', pass: r.bild === 'https://dranzeit.de/routes/live/dateien/laden-test/abc.png' });

  rows.push({ name: 'Kunden: ohne doppelte E-Mail', pass: r.kunden.join() === 'c2,c1', detail: r.kunden.join() });
  rows.push({ name: 'Kundenliste: alle, nach Namen', pass: r.eintraege.join() === 'Anna,Anna doppelt,Zora', detail: r.eintraege.join() });
  rows.push({ name: 'Kunde per E-Mail gefunden', pass: r.gefunden === 'c2' });
  const kunde = ein('POST', '/routes/team/kunden');
  rows.push({ name: 'Kunde anlegen: POST mit Token', pass: r.kundeNeu === 'neuK' && mitToken(kunde) && kunde.body.kunde.name === 'Kara' });
  rows.push({ name: 'Alle Kunden-Abrufe mit Token', pass: a('GET', '/routes/team/laeden/laden-test/kunden').every(mitToken) && a('GET', '/routes/team/laeden/laden-test/kunden').length === 3 });

  rows.push({ name: 'Eigene Termine: Zeitpunkte mit toDate()', pass: r.termine.join() === '2026-11-10T09:00:00.000Z' && mitToken(ein('GET', '/routes/konto/termine')), detail: r.termine.join() });
  rows.push({ name: 'Fremder Termin: null', pass: r.terminFremd === null });
  rows.push({ name: 'Angebote: abgelaufene fallen weg', pass: r.angebote.join() === 'o1' && mitToken(ein('GET', '/routes/konto/angebote')), detail: r.angebote.join() });
  rows.push({ name: 'Meine Termine: Laden, Person, Leistung', pass: r.details.laden === 'Salon' && r.details.person === 'Kim' && r.details.leistung === 'Schnitt', detail: JSON.stringify(r.details) });

  const belegtAbruf = a('GET', '/routes/live/person/kim/belegt');
  rows.push({ name: 'Regeln: Laden, Person, belegt öffentlich', pass: belegtAbruf.length > 0 && belegtAbruf.every((x) => !x.auth) && !ein('GET', '/routes/live/person/kim').auth, detail: belegtAbruf.map((x) => x.search).join(' ') });
  rows.push({ name: 'Regeln: freie Zeit frei', pass: r.frei === null, detail: String(r.frei) });
  rows.push({ name: 'Regeln: belegte Zeit erkannt', pass: /schon ein Termin/.test(r.belegt || ''), detail: String(r.belegt) });
  const monat = ein('GET', '/routes/team/termine');
  rows.push({ name: 'Monatsverbrauch: ohne abgesagte, mit Token', pass: r.monat === 1 && mitToken(monat) && /von=2026-10-31T23/.test(decodeURIComponent(monat.search)), detail: `${r.monat} ${decodeURIComponent(monat?.search || '')}` });
  const merker = geaendert.find((x) => x.body.aenderung.onboarding);
  rows.push({ name: 'Startklar-Merker: Zeitpunkt als {"__zeit"}', pass: typeof merker?.body.aenderung.onboarding.testlaufAt?.__zeit === 'string' && mitToken(merker), detail: JSON.stringify(merker?.body) });
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });

  await browser.close();
  return report(rows);
});
