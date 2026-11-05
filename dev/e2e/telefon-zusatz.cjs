// Telefon-Assistent als Zusatz: Testen, Zubuchen, Verbrauch, Deckel und Kündigen auf /telefon-assistent, Hinweis unter „Laden“,
// Kasten unter „Tarif“, Preis auf /preise. Anmeldung, Inhaber und Backend nachgebildet: kein Testkonto nötig, es ändert sich nichts.
// Braucht den Entwicklungsserver (npm run dev). Regeln und Stripe im Backend: backend/tests/test_telefon_abrechnung.py.
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const LADEN = { id: 'laden-test', name: 'Studio Kamm', phone: '030 555 555', owner: 'betreiber-test', billing: { plan: 'solo', status: 'active' } };
const BASIS = {
  sichtbar: true, offen: true, freigegeben: false, gesperrt: false, tarif: true, abo: true, kannTesten: true, kannBuchen: true, testmodus: false,
  zusatz: null, grund: 'nicht_frei', verbrauch: { art: 'test', minuten: 0, grenze: 30, anteil: 0 }, warnung: 0, deckel: 59, aktiv: false,
  weitersagen: false, status: 'aus', anschluss: '', vorschlag: '+4930555555', zielnummer: '+493082694105', eigeneNummer: false, minuten: 0, freiminuten: 30,
};
const TEST = { ...BASIS, freigegeben: true, kannTesten: false, grund: null, aktiv: true, status: 'aktiv', anschluss: '+4930555555' };
const ENDE = '2026-12-05T09:00:00+00:00';
const GEBUCHT = {
  ...TEST, kannBuchen: false, zusatz: { status: 'active', kuendigtZum: null, periodeEnde: ENDE },
  verbrauch: { art: 'zusatz', minuten: 210, grenze: 250, anteil: 0.84, kostenCent: 5100, deckel: 59 }, warnung: 80,
};

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const page = await newPage(browser, { viewport: { width: 1100, height: 1400 } });
  const fehler = collectErrors(page);
  await mockAuth(page);

  let stand = BASIS;
  let offen = false;
  const anfragen = [];
  const json = (route, status, daten) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(daten) });
  await page.route('**/routes/{konto,team,telefon-einrichtung,telefon-hinweis,billing,invoices}/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() === 'POST') anfragen.push({ path: p, body });
    const telefon = `/routes/telefon-einrichtung/${LADEN.id}`;
    if (p === '/routes/konto/profil') return json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } });
    if (p === '/routes/team/ich/laeden') return json(route, 200, { laeden: [LADEN] });
    if (p === `/routes/team/laeden/${LADEN.id}`) return json(route, 200, { laden: LADEN, kanaele: [] });
    if (p === telefon) return json(route, 200, stand);
    if (p === `${telefon}/testen`) return json(route, 200, (stand = TEST));
    if (p === `${telefon}/deckel`) return json(route, 200, (stand = { ...stand, deckel: body.deckel, verbrauch: { ...stand.verbrauch, grenze: 100 + (body.deckel - 29) * 5 } }));
    if (p === `${telefon}/kuendigen`)
      return json(route, 200, (stand = { ...stand, zusatz: { ...stand.zusatz, kuendigtZum: body.zurueck ? null : ENDE } }));
    if (p === `${telefon}/buchen`) {
      stand = GEBUCHT; // so meldet der Webhook den Zusatz nach der Zahlung
      return json(route, 200, { url: `${BASE}/telefon-assistent?gebucht=1&sprache=de` });
    }
    if (p === '/routes/billing/modus') return json(route, 200, { test: false });
    if (p.startsWith('/routes/billing-public')) return json(route, 200, { left: 0 });
    if (p === '/routes/invoices/list' || p.startsWith('/routes/invoices')) return json(route, 200, { invoices: [] });
    return route.continue();
  });
  await page.route('**/routes/telefon-hinweis', (route) => json(route, 200, { laeden: [], offen }));
  await page.route('**/routes/billing-public/**', (route) => json(route, 200, { left: 0 }));
  await signInFake(page);

  const seite = async (zusatz = '') => {
    await page.goto(`${BASE}/telefon-assistent?sprache=de${zusatz}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Telefon-Assistent', level: 1 }).waitFor({ timeout: 60000 });
    await page.getByText('Wird geladen', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForTimeout(400);
  };
  const sichtbar = (text) => page.getByText(text, { exact: false }).first().isVisible();

  // --- Vor der Öffnung und ohne Freigabe ---
  stand = { ...BASIS, sichtbar: false, offen: false, kannTesten: false, kannBuchen: false };
  await seite();
  check('Nicht geöffnet: Hinweis auf Freischaltung', await sichtbar('noch nicht freigeschaltet'));
  check('Nicht geöffnet: kein Knopf zum Testen', !(await page.getByRole('button', { name: 'Kostenlos testen' }).isVisible()));

  // --- Gratis ---
  stand = { ...BASIS, tarif: false, abo: false, kannTesten: false, kannBuchen: false };
  await seite();
  check('Gratis: Hinweis auf Solo', await sichtbar('Den Telefon-Assistenten gibt es ab dem Tarif Solo.'));
  check('Gratis: führt zu den Tarifen', (await page.getByRole('link', { name: 'Tarife ansehen' }).getAttribute('href')) === '/tarif');

  // --- Testen ---
  stand = BASIS;
  await seite();
  check('Testen: Überschrift mit den Testminuten', await page.getByRole('heading', { name: '30 Minuten kostenlos testen' }).isVisible());
  check('Testen: nennt den Preis danach', await sichtbar('29 € netto im Monat mit 100 Minuten, danach 0,20 € je Minute'));
  check('Testen: noch keine Einrichtung', !(await page.getByRole('heading', { name: /Nummer deines Ladens/ }).isVisible()));
  await shot(page, 'telefon-zusatz-testen');
  await page.getByRole('button', { name: 'Kostenlos testen' }).click();
  await page.getByRole('heading', { name: /Nummer deines Ladens/ }).waitFor({ timeout: 10000 });
  check('Testen: Klick startet die Testminuten', anfragen.some((a) => a.path.endsWith('/testen')));
  check('Testen: danach Einrichtung und Verbrauch', await sichtbar('0 von 30 Testminuten verbraucht.'));

  // --- Testminuten fast aufgebraucht, Hinweis unter „Laden“ ---
  stand = { ...TEST, verbrauch: { art: 'test', minuten: 25, grenze: 30, anteil: 0.83 }, warnung: 80 };
  await seite();
  const balken = page.getByRole('progressbar', { name: 'Testminuten' });
  check('Test: Balken zeigt den Verbrauch', (await balken.getAttribute('aria-valuenow')) === '83');
  check('Test: Zubuchen möglich', await page.getByRole('button', { name: 'Zubuchen' }).isVisible());
  check('Test: AGB beim Zubuchen', (await page.getByRole('region', { name: 'Testminuten' }).getByRole('link', { name: 'AGB' }).getAttribute('href')) === '/agb');
  stand = { ...TEST, verbrauch: { art: 'test', minuten: 30, grenze: 30, anteil: 1 }, warnung: 100, grund: 'test_verbraucht' };
  await seite();
  check('Test vorbei: sagt, dass nur noch die Ansage kommt', await sichtbar('Die Testminuten sind aufgebraucht.'));
  stand = { ...TEST, abo: false, kannBuchen: false };
  await seite();
  check('Test ohne Abo: braucht erst ein Abo ab Solo', await sichtbar('Zum Zubuchen brauchst du ein Abo ab Solo.'));
  check('Test ohne Abo: führt zum Tarif', (await page.getByRole('link', { name: 'Tarif wählen' }).getAttribute('href')) === '/tarif');

  // --- Zubuchen über Stripe (nachgebildet: Rückkehr mit ?gebucht=1) ---
  stand = TEST;
  await seite();
  await page.getByRole('button', { name: 'Zubuchen' }).click();
  await page.waitForURL(/gebucht=1/, { timeout: 15000 });
  await page.getByRole('heading', { name: 'Gebucht' }).waitFor({ timeout: 30000 });
  check('Zubuchen: geht über die Schnittstelle zu Stripe', anfragen.some((a) => a.path.endsWith('/buchen')));
  check('Zubuchen: Dank nach der Rückkehr', await sichtbar('Der Telefon-Assistent ist gebucht.'));

  // --- Gebucht: Verbrauch, Deckel, Kündigen ---
  stand = GEBUCHT;
  await seite();
  check('Gebucht: Minuten und Kosten des Monats', await sichtbar('Diesen Monat: 210 Minuten, bisher 51 € netto.'));
  check('Gebucht: Monatsende genannt', await sichtbar('Der Monat läuft bis zum 5. Dezember 2026.'));
  check('Gebucht: Deckel erklärt', await sichtbar('Kostendeckel 59 € im Monat: Bei 250 Minuten hört er bis zum Monatsende auf'));
  await shot(page, 'telefon-zusatz-gebucht');
  const deckel = page.getByLabel('Kostendeckel je Monat in Euro, netto');
  await deckel.fill('99');
  await page.getByRole('button', { name: 'Deckel speichern' }).click();
  await page.getByText('Kostendeckel 99 € im Monat').waitFor({ timeout: 10000 });
  check('Deckel: wird gespeichert', anfragen.some((a) => a.path.endsWith('/deckel') && a.body.deckel === 99));
  await page.getByRole('button', { name: 'Zum Monatsende kündigen' }).click();
  check('Kündigen: fragt erst nach', await sichtbar('Bis zum Monatsende nimmt er weiter ab'));
  await page.getByRole('button', { name: 'Ja, zum Monatsende kündigen' }).click();
  await page.getByText('Gekündigt zum 5. Dezember 2026.').waitFor({ timeout: 10000 });
  check('Kündigen: zum Monatsende', anfragen.some((a) => a.path.endsWith('/kuendigen') && a.body.zurueck === false));
  await page.getByRole('button', { name: 'Kündigung zurücknehmen' }).click();
  await page.getByRole('button', { name: 'Zum Monatsende kündigen' }).waitFor({ timeout: 10000 });
  check('Kündigen: lässt sich zurücknehmen', anfragen.some((a) => a.path.endsWith('/kuendigen') && a.body.zurueck === true));

  // --- Ansage-Gründe ---
  stand = { ...GEBUCHT, grund: 'deckel', verbrauch: { ...GEBUCHT.verbrauch, minuten: 250, anteil: 1 }, warnung: 100 };
  await seite();
  check('Deckel erreicht: sagt es', await sichtbar('Dein Kostendeckel ist erreicht.'));
  stand = { ...GEBUCHT, grund: 'zahlung', zusatz: { ...GEBUCHT.zusatz, status: 'past_due' } };
  await seite();
  check('Zahlung offen: sagt es', await sichtbar('Die letzte Zahlung ist offen.'));
  check('Zahlung offen: Zahlungsart prüfen', await page.getByRole('button', { name: 'Zahlungsart prüfen' }).isVisible());
  stand = { ...TEST, grund: 'gekuendigt', zusatz: { status: 'canceled', kuendigtZum: null, periodeEnde: ENDE }, kannBuchen: true };
  await seite();
  check('Beendet: sagt es und bietet neu an', (await sichtbar('Der Zusatz ist beendet.')) && (await page.getByRole('button', { name: 'Zubuchen' }).isVisible()));
  stand = { ...BASIS, gesperrt: true, kannTesten: false, kannBuchen: false, grund: 'gesperrt' };
  await seite();
  check('Gesperrt: sagt es', await sichtbar('Der Telefon-Assistent ist für deinen Laden gesperrt.'));
  check('Gesperrt: kein Testen', !(await page.getByRole('button', { name: 'Kostenlos testen' }).isVisible()));

  // --- Handy ---
  stand = GEBUCHT;
  await page.setViewportSize({ width: 390, height: 844 });
  await seite();
  const ueber = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Handy: nichts ragt seitlich heraus', ueber <= 0, `${ueber} px`);
  await shot(page, 'telefon-zusatz-handy');
  await page.setViewportSize({ width: 1100, height: 1400 });

  // --- Andere Sprache ---
  await page.goto(`${BASE}/telefon-assistent?sprache=en`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Booked' }).waitFor({ timeout: 60000 });
  check('Englisch: Karte übersetzt', await page.getByText('This month: 210 minutes').first().isVisible());

  // --- Laden: Kachel und Hinweis bei 80 % ---
  await page.goto(`${BASE}/shop-profile?sprache=de`, { waitUntil: 'domcontentloaded' });
  const kachel = page.getByRole('link', { name: /Telefon-Assistent/ });
  await kachel.first().waitFor({ timeout: 60000 });
  check('Laden: Kachel zum Telefon-Assistenten', await kachel.first().isVisible());
  check('Laden: Hinweis bei 80 % des Deckels', await sichtbar('210 von 250 Minuten bis zu deinem Kostendeckel verbraucht.'));
  stand = { ...BASIS, sichtbar: false, offen: false };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Verwalten' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  check('Laden: ohne Öffnung und Freigabe keine Kachel', (await page.getByRole('link', { name: /Telefon-Assistent/ }).count()) === 0);
  stand = GEBUCHT;

  // --- Tarif: Kasten ---
  await page.goto(`${BASE}/tarif?sprache=de`, { waitUntil: 'domcontentloaded' });
  const kasten = page.getByRole('heading', { name: 'Zusatz: Telefon-Assistent' });
  await kasten.waitFor({ timeout: 60000 });
  check('Tarif: Kasten zum Telefon-Assistenten', await kasten.isVisible());
  check('Tarif: Kasten nennt das eigene Abo', await sichtbar('Er hat ein eigenes Monatsabo mit eigener Rechnung'));

  // --- Preise ---
  for (const wert of [false, true]) {
    offen = wert;
    const kunde = await newPage(browser);
    await kunde.route('**/routes/telefon-hinweis', (route) => json(route, 200, { laeden: [], offen }));
    await kunde.goto(`${BASE}/preise?sprache=de`, { waitUntil: 'domcontentloaded' });
    const preis = kunde.getByText('29 € netto im Monat mit 100 Minuten, danach 0,20 € pro Minute, sekundengenau gezählt.');
    await preis.waitFor({ timeout: 60000 });
    await kunde.waitForTimeout(500);
    check(`Preise (${wert ? 'offen' : 'Testbetrieb'}): Preis ohne „Geplant“`, (await preis.isVisible()) && !(await kunde.getByText('Geplant:').isVisible()));
    check(
      `Preise (${wert ? 'offen' : 'Testbetrieb'}): ${wert ? 'Weg zum Testen' : 'auf Anfrage'}`,
      wert ? await kunde.getByText('Testen und zubuchen kannst du nach der Anmeldung').isVisible() : await kunde.getByText('Im Testbetrieb auf Anfrage:').isVisible(),
    );
    await kunde.context().close();
  }

  // --- Betreiber: für alle öffnen, Buchungsstand, Sperre ---
  const betreiber = await newPage(browser, { viewport: { width: 1280, height: 1000 } });
  const betreiberFehler = collectErrors(betreiber);
  await mockAuth(betreiber, { email: 'chef@dranzeit.de' });
  const aufrufe = [];
  const jetzt = new Date().toISOString();
  const ladenZeile = {
    id: 'salon', nr: 'L1', name: 'Salon Schnitt', owner: 'ina', ownerLabel: '', email: 'ina@salon.de', city: 'Berlin', phone: '030 123', created: jetzt,
    founder: false, billing: 'active', plan: 'solo', interval: 'monat', cancelAtPeriodEnd: false, currentPeriodEnd: null, customerId: 'cus_1', subscriptionId: 'sub_1',
    effectivePlan: 'solo', source: 'abo', trialEnd: jetzt, grant: null, suspended: null, onboarding: [], services: 1, staff: 1, staffAccounts: [], customers: 0,
    appointments: 0, upcoming: 0, thisMonth: 0, last30: 0, lastAppointment: null, markers: [], kind: 'echt', stripeMode: 'live',
  };
  let telefonOffen = false;
  await betreiber.route('**/routes/betreiber/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^.*\/routes\/betreiber/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() === 'POST') aufrufe.push({ path: p, body });
    if (p === '/ich') return json(route, 200, { admin: true });
    if (p === '/uebersicht')
      return json(route, 200, {
        now: jetzt,
        stats: { shops: 1, shopsTest: 0, newShops7: 0, newShops30: 1, byPlan: { gratis: 0, solo: 1, laden: 0, team: 0 }, inTrial: 0, paying: 1, granted: 0, mrr: 19, pastDue: 0,
          cancelling: 0, trialEndingSoon: 0, suspended: 0, founders: { taken: 0, limit: 100 }, accounts: 1, accountsTest: 0, accountsByRole: { shopOwner: 1 }, accountsUnverified: 0, appointments30: 0 },
        shops: [ladenZeile], accounts: [], orphans: { staff: 0, customers: 0, appointmentsInMissingShops: 0 },
        system: { stripe: 'live', stripeWebhook: true, stripePortal: true, stripeSandbox: true, stripeSandboxWebhook: true, resend: true, mailFrom: 'Dranzeit <hallo@dranzeit.de>',
          publicUrl: 'https://dranzeit.de', scheduler: { running: true, lastRun: jetzt, intervalSeconds: 300 }, admins: 1 },
        telefon: { offen: telefonOffen, laeden: [{ id: 'salon', name: 'Salon Schnitt', aktiv: true, gesperrt: false, freigegeben: true, zusatz: 'active', modus: 'live', kuendigt: false,
          art: 'zusatz', minuten: 210, grenze: 250, gemeldet: 210, grund: '' }] },
      });
    if (p === '/telefon-offen') {
      telefonOffen = body.offen;
      return json(route, 200, { offen: body.offen });
    }
    if (p === '/protokoll') return json(route, 200, { entries: [] });
    if (p === '/laden/salon')
      return json(route, 200, { id: 'salon', shop: { name: 'Salon Schnitt' }, stripeMode: 'live', stripeUrl: '', effectivePlan: 'solo', trialEnd: jetzt, staff: [], owner: null,
        telefon: [], telefonLaden: GEBUCHT, protokoll: [] });
    if (p === '/laden/salon/telefon-sperre') return json(route, 200, { ...GEBUCHT, gesperrt: body.gesperrt, grund: 'gesperrt' });
    return json(route, 200, { changed: true });
  });
  await betreiber.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await betreiber.waitForTimeout(1500);
  await betreiber.evaluate(async () => {
    const { signInWithEmailAndPassword, anmeldung } = await import('/src/app/auth/konto.ts');
    await signInWithEmailAndPassword(anmeldung, 'chef@dranzeit.de', 'egal');
  });
  await betreiber.goto(`${BASE}/betreiber`, { waitUntil: 'domcontentloaded' });
  const bereiche = betreiber.getByRole('navigation', { name: 'Bereiche' });
  await bereiche.getByRole('button', { name: 'Betrieb' }).click();
  const oeffnen = betreiber.getByRole('button', { name: 'Für alle Läden öffnen' });
  await oeffnen.waitFor({ timeout: 30000 });
  check('Betreiber: Schalter steht zunächst auf „nur freigegebene“', await betreiber.getByText('Nur für freigegebene Läden.').isVisible());
  check('Betreiber: Buchungsstand in der Liste', (await betreiber.locator('table').innerText()).includes('gebucht'));
  await oeffnen.click();
  const bestaetigen = betreiber.getByRole('dialog').getByRole('button', { name: 'Für alle öffnen' });
  check('Betreiber: Öffnen nur mit Grund', await bestaetigen.isDisabled());
  await betreiber.getByRole('dialog').getByLabel(/Grund/).fill('AGB und AV-Vertrag stehen');
  await bestaetigen.click();
  await betreiber.getByRole('button', { name: 'Nicht mehr für alle' }).waitFor({ timeout: 10000 });
  check('Betreiber: Öffnen geht ans Backend', aufrufe.some((a) => a.path === '/telefon-offen' && a.body.offen === true && a.body.reason === 'AGB und AV-Vertrag stehen'));
  await shot(betreiber, 'telefon-zusatz-betrieb', false);
  await bereiche.getByRole('button', { name: /^Läden/ }).click();
  await betreiber.locator('table').getByText('Salon Schnitt').click();
  await betreiber.getByRole('heading', { name: 'Telefon-Assistent' }).waitFor({ timeout: 30000 });
  check('Betreiber: Zusatz am Laden', await betreiber.getByText('210 von 250 Min., 51,00 € netto, Deckel 59 €').isVisible());
  await betreiber.getByRole('button', { name: 'Telefon-Assistent sperren' }).click();
  await betreiber.getByRole('dialog').getByLabel(/Grund/).fill('Missbrauch gemeldet');
  await betreiber.getByRole('dialog').getByRole('button', { name: 'Sperren', exact: true }).click();
  await betreiber.getByText('Telefon-Assistent gesperrt.').first().waitFor({ timeout: 10000 });
  check('Betreiber: Sperre mit Grund ans Backend', aufrufe.some((a) => a.path === '/laden/salon/telefon-sperre' && a.body.gesperrt === true && a.body.reason === 'Missbrauch gemeldet'));
  check('Betreiber: keine JavaScript-Fehler', betreiberFehler.length === 0, betreiberFehler.join(' | '));

  check('Keine JavaScript-Fehler', fehler.length === 0, fehler.join(' | '));
  await browser.close();
  return report(rows);
});
