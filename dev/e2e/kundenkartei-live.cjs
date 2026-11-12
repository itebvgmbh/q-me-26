// Kundenkartei gegen das echte Backend (Gegenstück zu kundenkartei.cjs, das alles nachstellt): Wegwerf-Laden, Kunde
// über die Termin-API, Nummer ohne Konto mit Name und Handynummer, am Tresen „Jetzt dran“ → „Kunde zuordnen“, dann
// Seite „Kunden“ (Suche, Kundenseite, Notiz fürs Team bleibt nach Neuladen, Verlauf, Notiz zum Besuch) am Rechner
// und am Handy (kein Überlauf). Läuft nur, solange der Wegwerf-Laden geöffnet hat (Mo–Fr 9–17 Uhr).
// Braucht: Entwicklungsserver mit echtem Backend (QME_BACKEND=https://dranzeit.de), API unter QME_API.
const crypto = require('crypto');
const { BASE, launch, newPage, tempShop, removeTempShop, collectErrors, shot, report, run } = require('./lib.cjs');

const API = (process.env.QME_API || 'https://dranzeit.de/api/v1').replace(/\/$/, '');
const NAME = 'Jürgen Probe';
const HANDY = '0170 5550123';

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

run(async () => {
  const browser = await launch();
  const rows = [];
  const pruefe = (name, pass, detail = '') => rows.push({ name, pass: Boolean(pass), detail: String(detail ?? '') });
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  const laden = await tempShop(page, 'Kartei-Test');
  let schluesselId = '';
  try {
    const { schluessel, eintrag } = await page.evaluate(async (shopId) => {
      const { schluesselAnlegen } = await import('/src/utils/api-schluessel.ts');
      return schluesselAnlegen(shopId, 'Kartei-Livetest');
    }, laden.shopId);
    schluesselId = eintrag.id;
    const api = async (methode, pfad, body) => {
      const res = await fetch(`${API}${pfad}`, { method: methode, headers: { Authorization: `Bearer ${schluessel}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    // Kunde in der Kartei, mit kommendem Termin
    const kunde = await api('POST', '/kunden', { name: NAME, telefon: HANDY, email: `kartei-${Date.now()}@example.com` });
    pruefe('Kunde über die API angelegt', kunde.status === 201, kunde.status);
    const frei = await api('GET', `/freie-zeiten?leistung_id=${laden.serviceId}&ab=${encodeURIComponent(`${laden.monday}T08:00:00+01:00`)}&anzahl=1`);
    const termin = await api('POST', '/termine', { leistung_id: laden.serviceId, start: frei.json[0].start, kunde_id: kunde.json.id });
    pruefe('Kommender Termin über die API', termin.status === 201, termin.json?.start);

    // Nummer ohne Konto (wie am QR-Code), dann am Tresen aufrufen
    const zieh = await fetch(`${BASE}/routes/nummer/ziehen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: laden.shopId, service_id: laden.serviceId, staff_ids: [laden.staffId], name: 'Juergen', phone: HANDY,
        key_hash: crypto.createHash('sha256').update(crypto.randomBytes(24).toString('hex')).digest('hex') }),
    });
    const nummer = await zieh.json().catch(() => ({}));
    const nummerId = nummer.appointment_id || nummer.appointmentId || nummer.id || nummer.termin?.id;
    pruefe('Nummer ohne Konto gezogen', zieh.ok && nummerId, `${zieh.status} ${nummer.detail || ''}`);
    if (nummerId) {
      const aufruf = await page.evaluate(async (id) => {
        const { backendSenden } = await import('/src/utils/live.ts');
        return backendSenden(`team/termine/${id}`, { aenderung: { status: 'in-progress' } }).then((r) => r.termin, (e) => ({ fehler: String(e) }));
      }, nummerId);
      pruefe('Nummer über die Handynummer gleich dem Kunden zugeordnet', aufruf?.kundeId === kunde.json.id, aufruf?.kundeId || aufruf?.fehler);
      await page.goto(`${BASE}/shop-dashboard?shopId=${laden.shopId}`, { waitUntil: 'domcontentloaded' });
      const karte = page.getByRole('link', { name: `Kundenkartei: ${NAME}` }).first();
      const knopf = page.getByRole('button', { name: 'Kunde zuordnen' }).first();
      const da = await Promise.race([karte.waitFor({ timeout: 30000 }).then(() => 'karte'), knopf.waitFor({ timeout: 30000 }).then(() => 'knopf')]).catch(() => '');
      pruefe('Tresen: „Jetzt dran“ zeigt den Kunden aus der Kartei', da === 'karte', da || 'weder Kartei noch Knopf');
      if (!da) await shot(page, 'kartei-live-tresen-fehlt');
      // Zuordnung ändern: lösen, dann wieder über den Vorschlag (Handynummer) zuordnen
      const aendern = page.getByRole('button', { name: 'Ändern' }).first();
      if (da === 'karte' && (await aendern.count())) {
        await aendern.click();
        const dialog = page.getByRole('dialog', { name: 'Kunde zuordnen' });
        await dialog.waitFor({ timeout: 10000 });
        await dialog.getByRole('button', { name: `Zuordnung zu ${NAME} lösen` }).click();
        const zuordnen = page.getByRole('button', { name: 'Kunde zuordnen' }).first();
        const geloest = await zuordnen.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
        pruefe('Tresen: Zuordnung gelöst, Knopf „Kunde zuordnen“', geloest);
        if (geloest) {
          await zuordnen.click();
          await dialog.waitFor({ timeout: 10000 });
          await page.waitForTimeout(500);
          await shot(page, 'kartei-live-zuordnen');
          pruefe('Tresen: Vorschlag über die Handynummer', (await dialog.getByText('Passt vielleicht').count()) === 1 && (await dialog.getByText(NAME).count()) >= 1);
          await dialog.getByRole('button', { name: 'Zuordnen' }).first().click();
          const ok = await page.getByText(`${NAME} zugeordnet.`).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
          pruefe('Tresen: wieder zugeordnet', ok);
        }
      }
      const fertig = await page.evaluate(async (id) => {
        const { backendSenden } = await import('/src/utils/live.ts');
        return backendSenden(`team/termine/${id}`, { aenderung: { status: 'completed' } }).then((r) => r.termin?.status, (e) => String(e));
      }, nummerId);
      pruefe('Besuch fertig gemacht', fertig === 'completed', fertig);
    }

    // Seite „Kunden“ am Rechner
    await page.goto(`${BASE}/kunden`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Kunden', level: 1 }).waitFor({ timeout: 30000 });
    const inListe = await page.getByText(NAME).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    pruefe('Liste zeigt den Kunden', inListe);
    await page.getByPlaceholder('Name, Telefon oder E-Mail').fill('5550123');
    await page.waitForTimeout(500);
    pruefe('Suche nach Handynummer', await page.getByText(NAME).first().isVisible());
    await shot(page, 'kartei-live-liste');
    await page.getByText(NAME).first().click();
    await page.getByRole('heading', { name: NAME, level: 1 }).waitFor({ timeout: 15000 });
    const kundenUrl = page.url();
    pruefe('Kundenseite: kommender Termin', await page.getByRole('heading', { name: 'Kommende Termine' }).isVisible());
    await page.locator('textarea').first().fill('Livetest: mag es kurz');
    await page.getByRole('button', { name: 'Notiz speichern' }).click();
    pruefe('Notiz fürs Team gespeichert', await page.getByText('Notiz gespeichert.').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: NAME, level: 1 }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);
    pruefe('Notiz bleibt nach Neuladen', (await page.locator('textarea').first().inputValue()) === 'Livetest: mag es kurz');
    const besuch = page.locator('section[aria-labelledby="verlauf"] li').first();
    if (await besuch.count()) {
      await besuch.getByRole('button', { name: 'Notiz zum Besuch' }).click();
      await page.getByRole('textbox', { name: 'Notiz zu diesem Besuch' }).fill('Livetest 7/1');
      await besuch.getByRole('button', { name: 'Speichern' }).click();
      pruefe('Notiz zum Besuch gespeichert', await besuch.getByText('Livetest 7/1').waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    } else {
      pruefe('Verlauf zeigt den Besuch vom Tresen', false, 'kein Eintrag im Verlauf');
    }
    await shot(page, 'kartei-live-kunde');

    // Handy: dieselben Seiten ohne Überlauf
    const handy = await newPage(browser);
    await handy.context().addCookies(await page.context().cookies());
    await handy.goto(`${BASE}/kunden`, { waitUntil: 'domcontentloaded' });
    await handy.getByText(NAME).first().waitFor({ timeout: 30000 });
    pruefe('Handy: Liste ohne Überlauf', !(await ueberlauf(handy)));
    await shot(handy, 'kartei-live-handy-liste');
    await handy.goto(kundenUrl, { waitUntil: 'domcontentloaded' });
    await handy.getByRole('heading', { name: NAME, level: 1 }).waitFor({ timeout: 15000 });
    pruefe('Handy: Kundenseite ohne Überlauf', !(await ueberlauf(handy)));
    await shot(handy, 'kartei-live-handy-kunde');

    const echteFehler = errors.filter((e) => !/401|403|Failed to load resource|EventSource|push|billing|telefon/i.test(e));
    pruefe('Keine JavaScript-Fehler', echteFehler.length === 0, echteFehler.join(' | '));
  } finally {
    if (schluesselId) {
      await page.evaluate(async ({ shopId, id }) => {
        const { schluesselWiderrufen } = await import('/src/utils/api-schluessel.ts');
        return schluesselWiderrufen(shopId, id);
      }, { shopId: laden.shopId, id: schluesselId }).catch(() => {});
    }
    await removeTempShop(page, laden);
    await browser.close();
  }
  return report(rows);
});
