// Laden einrichten (/shop-setup): Assistent zweimal komplett durchklicken –
//  A) mit Google-Treffer und Preisliste von der Webseite (Antworten des Backends hier nachgebildet,
//     Google- und Claude-Schlüssel braucht es dafür nicht),
//  B) ganz ohne Google und KI (selbst eintragen, Vorlagen der Branche).
// Prüft danach, was in der Datenbank steht, und dass die Mittagspause des Ladens Buchungen sperrt.
// Handygröße; meldet waagrechtes Überlaufen. Fotos jeder Frage in dev/out/einrichten-*.png.
// Braucht: Entwicklungsserver und Testdaten (nur das Testkonto). Räumt die angelegten Läden selbst weg.
// Die Einladungslinks am Ende kommen vom Backend (/routes/staff-invitation): QME_BACKEND=https://q-me.spielmacherei.de
const { BASE, launch, newPage, shot, collectErrors, fixture, report, run } = require('./lib.cjs');

const PLACE = {
  googlePlaceId: 'ChIJtest-laden-einrichten',
  name: 'Salon Testschnitt (Test)',
  street: 'Hauptstraße 1',
  postalCode: '04109',
  city: 'Leipzig',
  formattedAddress: 'Hauptstraße 1, 04109 Leipzig',
  phone: '0341 000000',
  website: 'https://salon.example',
  googleMapsUri: '',
  coordinates: { latitude: 51.34, longitude: 12.37 },
  industry: 'barbershop',
  businessHoursByDay: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    isOpen: d >= 2,
    openTime: '09:00',
    closeTime: d === 6 ? '14:00' : '18:00',
    breaks: d >= 2 && d <= 5 ? [{ startTime: '12:30', endTime: '13:30' }] : [],
  })),
  hoursText: [],
  closedPermanently: false,
};
const WEBSITE = {
  services: [
    { name: 'Herrenschnitt Test', category: 'Herren', duration: 30, durationGuessed: false, price: 27, priceFrom: false },
    { name: 'Färben Test', category: 'Farbe', duration: 90, durationGuessed: true, price: 60, priceFrom: true },
  ],
  pages: ['https://salon.example/', 'https://salon.example/preise'],
};

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  const overflow = [];
  let mode = 'google';
  const backendCalls = [];
  await page.route('**/routes/shop-setup/**', (route) => {
    const url = route.request().url();
    backendCalls.push(url.split('/routes/')[1]);
    if (url.endsWith('/status')) return route.fulfill(json(mode === 'google' ? { google: true, ai: true } : { google: false, ai: false }));
    if (url.endsWith('/places-search')) return route.fulfill(json({ suggestions: [{ place_id: PLACE.googlePlaceId, title: 'Salon Testschnitt', subtitle: 'Hauptstraße 1, Leipzig' }] }));
    if (url.endsWith('/place-details')) return route.fulfill(json(PLACE));
    if (url.endsWith('/website-services')) return new Promise((r) => setTimeout(r, 800)).then(() => route.fulfill(json(WEBSITE)));
    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, fx.email, fx.pw);
    localStorage.removeItem(`qme-laden-einrichten-${fx.uid}`);
  }, fx);

  const heading = (name) => page.getByRole('heading', { name, exact: false }).first().waitFor({ timeout: 15000 });
  const click = (name, exact = false) => page.getByRole('button', { name, exact }).first().click();
  let n = 0;
  const step = async (name) => {
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) overflow.push(`${name} (+${wide}px)`);
    await shot(page, `einrichten-${mode}-${String(++n).padStart(2, '0')}-${name}`);
  };

  // --- A) mit Google und Preisliste --------------------------------------------------------------
  await page.goto(`${BASE}/shop-setup`, { waitUntil: 'domcontentloaded' });
  await heading('Wie heißt dein Laden?');
  await page.getByPlaceholder('z. B. Salon Schnittig Leipzig').fill('Salon Test');
  await page.getByRole('button', { name: /Salon Testschnitt/ }).waitFor({ timeout: 10000 });
  await step('suche');
  await page.getByRole('button', { name: /Salon Testschnitt/ }).click();
  await heading('Stimmt das so?');
  const a = { nameField: await page.getByLabel('Name des Ladens').inputValue(), ortField: await page.getByLabel('Ort', { exact: true }).inputValue() };
  await step('pruefen');
  await click('Ja, weiter');
  await heading('Was für ein Laden ist das?');
  a.industryHint = await page.getByText('Laut Google:').first().textContent();
  await step('branche');
  await click('Friseure/Barbiere');
  await heading('Wann hast du geöffnet?');
  a.pausenFelder = await page.getByLabel('Pause von').count();
  await step('zeiten');
  await click('Weiter', true);
  await heading('Was bietest du an?');
  await page.getByText(/2 Leistungen von salon\.example übernommen/).waitFor({ timeout: 15000 });
  a.vorlagenAngehakt = await page.locator('section[aria-label^="Typisch für"] button[role="checkbox"][aria-checked="true"]').count();
  await step('leistungen');
  await click('Weiter', true);
  await heading('Nimmst du selbst Kundschaft an?');
  await step('selbst');
  await click('Ja, ich arbeite selbst mit');
  await heading('Wer arbeitet noch mit?');
  await page.getByLabel('Du – so sehen Kunden dich').fill('Stefan');
  await click('Person hinzufügen');
  await page.getByLabel('Name', { exact: true }).last().fill('Kim');
  await page.getByLabel('E-Mail (freiwillig)').last().fill('kim-test@example.com');
  await step('team');
  await click('Weiter', true);
  await heading('Kann jeder alles?');
  await click('Nein, das ist verteilt');
  await page.locator('fieldset', { hasText: 'Kim' }).getByRole('button', { name: 'Färben Test' }).click();
  await step('wer-macht-was');
  await click('Weiter', true);
  await heading('Arbeiten alle, wenn offen ist?');
  await click('Nein, an unterschiedlichen Tagen');
  await page.getByRole('button', { name: 'Kim arbeitet Sa' }).click();
  await step('arbeitstage');
  await click('Weiter', true);
  await heading('Alles bereit?');
  a.zusammenfassung = await page.locator('section').filter({ hasText: 'Öffnungszeiten' }).last().textContent();
  a.teamHinweis = await page.getByText('Beim Eröffnen geht eine Einladung per E-Mail an').textContent().catch(() => '');
  await step('zusammenfassung');
  await click('Laden eröffnen');
  await heading('ist startklar.');
  a.einladungen = await page.locator('section[aria-labelledby="einladungen"]').getByRole('button', { name: 'Link kopieren' }).count();
  a.einladungText = await page.locator('section[aria-labelledby="einladungen"]').textContent();
  await step('fertig');

  // --- B) ohne Google und KI ---------------------------------------------------------------------
  mode = 'manuell';
  n = 0;
  await page.goto(`${BASE}/shop-setup`, { waitUntil: 'domcontentloaded' });
  await heading('Wie heißt dein Laden?');
  await page.getByLabel('Name des Ladens').fill('Nagelstudio ohne Google (Test)');
  await step('name');
  await click('Weiter', true);
  await heading('Stimmt das so?');
  await page.getByLabel('Ort', { exact: true }).fill('Leipzig');
  await click('Ja, weiter');
  await heading('Was für ein Laden ist das?');
  await click('Nagelstudios');
  await heading('Wann hast du geöffnet?');
  await click('Mo–Fr 9–18', true);
  await page.getByRole('button', { name: 'Mittagspause' }).first().click(); // Montag
  await step('zeiten');
  await click('Weiter', true);
  await heading('Was bietest du an?');
  const b = { websiteBox: await page.getByText('Preisliste von deiner Webseite holen').count() };
  await step('leistungen');
  await click('Weiter', true);
  await heading('Nimmst du selbst Kundschaft an?');
  await click('Ja, ich arbeite selbst mit');
  await heading('Wer arbeitet noch mit?');
  await page.getByLabel('Du – so sehen Kunden dich').fill('Sam');
  await click('Nur ich, weiter');
  await heading('Alles bereit?'); // "Kann jeder alles?" und Arbeitstage entfallen bei einer Person
  await step('zusammenfassung');
  await click('Laden eröffnen');
  await heading('ist startklar.');
  await step('fertig');

  // --- C) Abbruch beim Anlegen: Laden steht schon, Rest fehlt → "Weiter anlegen" ohne zweiten Laden ----
  n = 0;
  await page.evaluate(async (fx) => {
    const setup = await import('/src/utils/shop-setup.ts');
    const { createShop } = await import('/src/utils/firestore/shops.ts');
    const shop = await createShop(fx.uid, { name: 'Wiederaufnahme (Test)', phone: '', email: fx.email });
    const draft = {
      ...setup.emptyDraft(fx.email, 'Alex'),
      step: 'summary', source: 'manual', name: 'Wiederaufnahme (Test)', industryConfirmed: true, templateIndustry: '', ownerWorks: true,
      services: [{ key: 's1', name: 'Schnitt C', category: '', duration: 30, price: 20, selected: true, source: 'own' }],
      team: [{ key: 'p1', name: 'Jo', email: 'jo-test@example.com' }],
      progress: { shopId: shop.id, serviceIds: {}, staffKeys: [], invitations: [] },
    };
    localStorage.setItem(`qme-laden-einrichten-${fx.uid}`, JSON.stringify(draft));
  }, fx);
  await page.goto(`${BASE}/shop-setup`, { waitUntil: 'domcontentloaded' });
  await heading('Alles bereit?');
  const c = { hinweis: await page.getByText('Ein Teil ist schon gespeichert').count() };
  mode = 'wiederaufnahme';
  await step('zusammenfassung');
  // Hier geht die E-Mail "raus" (nachgebildet): An example.com verschickt das echte Backend nichts
  const inviteBodies = [];
  await page.route('**/routes/staff-invitation', (route) => {
    inviteBodies.push(route.request().postDataJSON());
    return route.fulfill(json({ link: `${BASE}/staff-registration?token=test`, expires: new Date().toISOString(), email_sent: true, email_problem: '' }));
  });
  await click('Weiter anlegen');
  await heading('ist startklar.');
  c.einladungText = await page.locator('section[aria-labelledby="einladungen"]').textContent();
  await page.unroute('**/routes/staff-invitation');
  await step('fertig');

  // --- Datenbank prüfen, Regel prüfen, aufräumen ---------------------------------------------------
  const db = await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const rules = await import('/src/utils/booking-rules.ts');
    const byField = async (coll, field, value) => (await fs.getDocs(fs.query(fs.collection(firestore, coll), fs.where(field, '==', value)))).docs;
    const shops = (await byField('shops', 'owner', fx.uid)).filter((d) => d.id !== fx.shopId);
    const out = { shops: {}, wiederaufnahme: shops.filter((d) => d.data().name === 'Wiederaufnahme (Test)').length };
    for (const s of shops) {
      const services = await byField('services', 'shopId', s.id);
      const staff = await byField('staff', 'shopId', s.id);
      const data = s.data();
      const entry = { id: s.id, data, services: services.map((d) => d.data()), staff: staff.map((d) => ({ id: d.id, ...d.data() })) };
      // Einladung hängt am Eintrag (Hash des Links, gesetzt vom Backend), nicht mehr in staff-invitations
      entry.invitations = entry.staff.filter((p) => p.inviteTokenHash).map((p) => p.email);
      if (data.name === 'Salon Testschnitt (Test)') {
        const kim = entry.staff.find((p) => p.name === 'Kim');
        const t = new Date(); t.setDate(t.getDate() + ((9 - t.getDay()) % 7 || 7)); // nächster Dienstag
        const at = (h, m) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), h, m).getTime();
        const ctx = await rules.loadStaffDayContext(s.id, kim?.id, t);
        entry.regelPause = rules.findConflict(ctx, at(12, 45), at(13, 15));
        entry.regelFrei = rules.findConflict(ctx, at(13, 30), at(14, 0));
      }
      out.shops[data.name] = entry;
      for (const d of [...services, ...staff]) {
        try {
          await fs.deleteDoc(d.ref);
        } catch (e) {
          out.notDeleted = (out.notDeleted || 0) + 1; // räumt dann python dev/fixtures.py loeschen weg
        }
      }
      try {
        // Laden löschen nur zusammen mit dem Vermerk in deleted_shops (firestore.rules)
        const batch = fs.writeBatch(firestore);
        batch.set(fs.doc(firestore, 'deleted_shops', s.id), { owner: fx.uid, deletedAt: fs.Timestamp.now() });
        batch.delete(s.ref);
        await batch.commit();
      } catch (e) {
        out.notDeleted = (out.notDeleted || 0) + 1;
      }
    }
    out.left = (await byField('shops', 'owner', fx.uid)).filter((d) => d.id !== fx.shopId).length;
    out.draftLeft = localStorage.getItem(`qme-laden-einrichten-${fx.uid}`);
    return out;
  }, fx);
  await browser.close();

  const A = db.shops['Salon Testschnitt (Test)'];
  const B = db.shops['Nagelstudio ohne Google (Test)'];
  const stefan = A?.staff.find((p) => p.name === 'Stefan');
  const kim = A?.staff.find((p) => p.name === 'Kim');
  const herren = A?.services.find((s) => s.name === 'Herrenschnitt Test');
  const kimSamstag = kim?.workingHours.find((h) => h.dayOfWeek === 6);
  return report([
    { name: 'A: Google-Daten im Formular', pass: a.nameField === PLACE.name && a.ortField === 'Leipzig', detail: `${a.nameField} / ${a.ortField}` },
    { name: 'A: Branche von Google vorgeschlagen', pass: /Friseure\/Barbiere/.test(a.industryHint || ''), detail: a.industryHint },
    { name: 'A: Mittagspausen von Google (Di–Fr)', pass: a.pausenFelder === 4, detail: `${a.pausenFelder} Pausen` },
    { name: 'A: Vorlagen nach Webseite nicht angehakt', pass: a.vorlagenAngehakt === 0, detail: `${a.vorlagenAngehakt}` },
    { name: 'A: Zusammenfassung zeigt Pause', pass: /09:00–12:30 · 13:30–18:00/.test(a.zusammenfassung || ''), detail: (a.zusammenfassung || '').slice(0, 80) },
    { name: 'A: Laden gespeichert', pass: !!A && A.data.industry === 'barbershop' && A.data.website === PLACE.website && A.data.googlePlaceId === PLACE.googlePlaceId && A.data.coordinates?.latitude === 51.34 },
    { name: 'A: Ladenpause in Firestore', pass: A?.data.businessHoursByDay?.[2]?.breaks?.[0]?.startTime === '12:30' && A?.data.businessHoursByDay?.[1]?.isOpen === false },
    { name: 'A: genau die 2 Leistungen der Webseite', pass: A?.services.length === 2 && !!herren && herren.price === 27, detail: A?.services.map((s) => s.name).join(', ') },
    { name: 'A: "ab"-Preis als Hinweis', pass: /Preis ab 60/.test(A?.services.find((s) => s.name === 'Färben Test')?.description || '') },
    { name: 'A: Inhaber mit eigenem Konto im Team', pass: stefan?.userId === fx.uid && stefan?.serviceIds.length === 2 && stefan?.role === 'Inhaber' },
    { name: 'A: Kim nur Herrenschnitt', pass: kim?.serviceIds.length === 1 && kim?.serviceIds[0] === herren?.id, detail: `${kim?.serviceIds.length}` },
    { name: 'A: Kim samstags frei, dienstags da', pass: kimSamstag?.isWorking === false && kim?.workingHours.find((h) => h.dayOfWeek === 2)?.isWorking === true },
    { name: 'A: Einladung für Kim', pass: a.einladungen === 1 && A?.invitations.includes('kim-test@example.com') },
    { name: 'A: Zusammenfassung kündigt E-Mail an Kim an', pass: /an Kim\./.test(a.teamHinweis || ''), detail: a.teamHinweis },
    // Versand wird angestoßen; an example.com schickt das Backend nichts und sagt das – dann Link zum selbst Schicken
    { name: 'A: Einladung per E-Mail angestoßen', pass: /An Testadressen wie example\.com verschickt Dranzeit keine E-Mails\. Schick den Link selbst\./.test(a.einladungText || ''), detail: (a.einladungText || '').slice(0, 160) },
    { name: 'A: Buchung in der Ladenpause gesperrt', pass: /Der Laden macht Pause von 12:30 bis 13:30/.test(A?.regelPause || ''), detail: A?.regelPause },
    { name: 'A: 13:30 nach der Pause frei', pass: A?.regelFrei === null, detail: A?.regelFrei },
    { name: 'B: ohne Google kein Webseiten-Kasten', pass: b.websiteBox === 0 },
    { name: 'B: Nagelstudio mit Vorlagen', pass: B?.data.industry === 'nailstudio' && B?.services.length === 5, detail: B?.services.map((s) => s.name).join(', ') },
    { name: 'B: Montag Mittagspause gespeichert', pass: B?.data.businessHoursByDay?.[1]?.breaks?.length === 1 && B?.data.businessHoursByDay?.[6]?.isOpen === false },
    { name: 'B: nur Inhaber im Team', pass: B?.staff.length === 1 && B?.staff[0].userId === fx.uid && B?.staff[0].name === 'Sam' },
    { name: 'B: Google/KI nicht aufgerufen', pass: !backendCalls.slice(backendCalls.lastIndexOf('shop-setup/status')).some((c) => c !== 'shop-setup/status') },
    { name: 'C: nach Abbruch "Weiter anlegen" angeboten', pass: c.hinweis === 1 },
    { name: 'C: Einladung mit send_email angefragt', pass: inviteBodies.length === 1 && inviteBodies[0].send_email === true, detail: JSON.stringify(inviteBodies) },
    { name: 'C: Fertig-Seite meldet "E-Mail verschickt"', pass: /per E-Mail bekommen.*Jo.*E-Mail verschickt/.test(c.einladungText || ''), detail: (c.einladungText || '').slice(0, 160) },
    { name: 'C: kein zweiter Laden, Rest ergänzt', pass: db.wiederaufnahme === 1 && db.shops['Wiederaufnahme (Test)']?.services.length === 1 && db.shops['Wiederaufnahme (Test)']?.staff.length === 2, detail: `${db.wiederaufnahme} Läden` },
    { name: 'Entwurf nach dem Anlegen gelöscht', pass: db.draftLeft === null },
    { name: 'Aufgeräumt', pass: db.left === 0, detail: db.notDeleted ? `${db.notDeleted} Dokumente nicht löschbar` : '' },
    { name: 'Kein waagrechtes Überlaufen (Handy)', pass: overflow.length === 0, detail: overflow.join(', ') },
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
