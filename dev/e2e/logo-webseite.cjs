// „Logo von der Webseite holen“ beim Einrichten (pages/ShopSetup.tsx, components/setup/LogoVonWebseite.tsx).
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt.
// Geprüft: Häkchen holt die Logos, SVG wird im Browser zu PNG gerastert und im Entwurf gespeichert, die Zusammenfassung
// zeigt es, „Laden eröffnen“ lädt es als PNG hoch und setzt logoUrl; Haken weg nimmt das Logo aus dem Entwurf.
// Braucht: Entwicklungsserver (npm run dev). Bilder: dev/out/logo-webseite-*.png
const zlib = require('zlib');
const { BASE, launch, newPage, collectErrors, mockAuth, signInFake, shot, report, run } = require('./lib.cjs');

/** Kleines PNG (w×h, eine Farbe) – genug, damit es wie ein echtes Bild aussieht */
const png = (w, h, [r, g, b]) => {
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // Bit
  ihdr[9] = 2; // RGB
  const zeile = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const roh = Buffer.concat(Array.from({ length: h }, () => zeile));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh)), chunk('IEND', Buffer.alloc(0))]);
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><rect width="200" height="50" rx="8" fill="#111"/><text x="100" y="33" font-size="24" text-anchor="middle" fill="#fc3">SONNE</text></svg>';

run(async () => {
  const browser = await launch();
  const rows = [];
  const page = await newPage(browser, { viewport: { width: 1000, height: 900 } });
  const errors = collectErrors(page);
  await mockAuth(page);

  const anfragen = [];
  const json = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/routes/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.startsWith('/routes/anmeldung/')) return route.fallback();
    const typ = req.headers()['content-type'] || '';
    const body = req.postData() && typ.includes('json') ? JSON.parse(req.postData()) : null;
    anfragen.push({ method: req.method(), path: p, typ, body, groesse: (req.postDataBuffer() || Buffer.alloc(0)).length, roh: typ.includes('multipart') ? req.postDataBuffer() : null });
    if (p === '/routes/konto/profil' && req.method() === 'GET') return json(route, 200, { profil: { uid: 'betreiber-test', email: 'chef@example.com', role: 'shopOwner', displayName: 'Chef' } });
    if (p === '/routes/konto/profil') return json(route, 200, { profil: { uid: 'betreiber-test', role: 'shopOwner' } });
    if (p === '/routes/shop-setup/status') return json(route, 200, { google: false, ai: false });
    if (p === '/routes/shop-setup/website-logo')
      return json(route, 200, {
        seite: 'https://salon-sonne.de/',
        logos: [
          { dataUrl: `data:image/png;base64,${png(120, 120, [220, 40, 40]).toString('base64')}`, quelle: 'https://salon-sonne.de/icon.png', art: 'png' },
          { dataUrl: `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`, quelle: 'https://salon-sonne.de/logo.svg', art: 'svg' },
        ],
      });
    if (p === '/routes/team/laeden' && req.method() === 'POST') return json(route, 200, { laden: { ...body.laden, id: 'neu', owner: 'betreiber-test', plan: 'gratis' } });
    if (p === '/routes/team/laeden/neu/bild') return json(route, 200, { url: 'https://dranzeit.de/routes/live/dateien/neu/abc.png' });
    if (p === '/routes/team/laeden/neu' && req.method() === 'POST') return json(route, 200, { laden: { id: 'neu', name: 'Salon Sonne', ...body.aenderung } });
    if (p === '/routes/team/leistungen') return json(route, 200, { leistung: { ...body.leistung, id: 'l1' } });
    if (p === '/routes/team/personen') return json(route, 200, { person: { ...body.person, id: 'p1' } });
    return json(route, 200, {});
  });

  await signInFake(page);
  // Entwurf direkt bei „Stimmt das so?“ – die Fragen davor prüft der Test nicht
  const entwurf = {
    step: 'check', source: 'manual', googlePlaceId: '', name: 'Salon Sonne', street: 'Hauptstr. 1', postalCode: '10115', city: 'Berlin', phone: '',
    email: 'chef@example.com', website: 'salon-sonne.de', coordinates: null, industry: 'barbershop', industryGuessed: false, industryConfirmed: true,
    templateIndustry: 'barbershop', hoursFromGoogle: false, websiteRead: 'salon-sonne.de',
    services: [{ key: 's1', name: 'Haarschnitt', category: '', duration: 30, price: 25, priceFrom: false, selected: true, source: 'template' }],
    ownerWorks: true, ownerName: 'Chef', team: [], assignments: {}, everyoneDoesAll: null, sameHours: null,
  };
  await page.evaluate((d) => localStorage.setItem('qme-laden-einrichten-betreiber-test', JSON.stringify(d)), entwurf);
  await page.goto(`${BASE}/shop-setup`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Stimmt das so?' }).waitFor({ timeout: 15000 });

  const haken = page.getByRole('checkbox', { name: 'Logo von der Webseite holen' });
  rows.push({ name: 'Häkchen da, ohne KI', pass: (await haken.count()) === 1 && !(await haken.isChecked()) });
  await haken.check();
  await page.getByRole('button', { name: 'Dieses Logo speichern' }).waitFor({ timeout: 10000 });
  const abruf = anfragen.find((a) => a.path === '/routes/shop-setup/website-logo');
  rows.push({ name: 'Logo-Abruf mit der Webseite', pass: abruf?.body?.url === 'salon-sonne.de', detail: JSON.stringify(abruf?.body) });
  const kacheln = page.getByRole('group', { name: /Logos von/ }).getByRole('button');
  rows.push({ name: 'Zwei Vorschläge zur Auswahl', pass: (await kacheln.count()) === 2 });
  await kacheln.nth(1).click(); // das SVG
  await page.waitForTimeout(300);
  await shot(page, 'logo-webseite-auswahl', false);
  await page.getByRole('button', { name: 'Dieses Logo speichern' }).click();
  await page.getByText('Logo gespeichert').first().waitFor({ timeout: 5000 });
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem('qme-laden-einrichten-betreiber-test') || '{}').logo);
  const masse = gespeichert?.dataUrl
    ? await page.evaluate(
        (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => ok(null); i.src = u; }),
        gespeichert.dataUrl,
      )
    : null;
  rows.push({
    name: 'SVG als PNG im Entwurf (≤ 400 px)',
    pass: Boolean(gespeichert?.dataUrl?.startsWith('data:image/png;base64,')) && gespeichert.quelle === 'https://salon-sonne.de/logo.svg' && masse && Math.max(...masse) <= 400 && masse[0] > masse[1],
    detail: `${gespeichert?.quelle} ${JSON.stringify(masse)}`,
  });

  // Haken weg → Logo raus, wieder an → aus dem Zwischenspeicher, ohne zweiten Abruf
  await haken.uncheck();
  const ohne = await page.evaluate(() => JSON.parse(localStorage.getItem('qme-laden-einrichten-betreiber-test') || '{}').logo);
  rows.push({ name: 'Haken weg: Logo aus dem Entwurf', pass: ohne === undefined });
  await haken.check();
  await page.getByRole('button', { name: 'Dieses Logo speichern' }).waitFor({ timeout: 10000 });
  await page.getByRole('group', { name: /Logos von/ }).getByRole('button').nth(1).click();
  await page.getByRole('button', { name: 'Dieses Logo speichern' }).click();
  await page.getByText('Logo gespeichert').first().waitFor({ timeout: 5000 });

  // Zur Zusammenfassung springen (Entwurf mit Schritt summary) und eröffnen
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('qme-laden-einrichten-betreiber-test'));
    localStorage.setItem('qme-laden-einrichten-betreiber-test', JSON.stringify({ ...d, step: 'summary' }));
  });
  await page.goto(`${BASE}/shop-setup`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Alles bereit?' }).waitFor({ timeout: 15000 });
  rows.push({ name: 'Zusammenfassung zeigt das Logo', pass: (await page.getByRole('img', { name: 'Logo des Ladens' }).count()) === 1 });
  await shot(page, 'logo-webseite-zusammenfassung');
  await page.getByRole('button', { name: 'Laden eröffnen' }).click();
  await page.getByText('Salon Sonne ist startklar.').waitFor({ timeout: 15000 });
  const bild = anfragen.find((a) => a.path === '/routes/team/laeden/neu/bild');
  const pngImUpload = Boolean(bild?.roh) && bild.roh.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  rows.push({ name: 'Eröffnen: Logo als PNG hochgeladen', pass: Boolean(bild) && bild.typ.includes('multipart/form-data') && pngImUpload, detail: `${bild?.groesse} Bytes` });
  const aenderung = anfragen.find((a) => a.path === '/routes/team/laeden/neu' && a.body?.aenderung?.logoUrl);
  rows.push({ name: 'Eröffnen: logoUrl am Laden gesetzt', pass: aenderung?.body.aenderung.logoUrl === 'https://dranzeit.de/routes/live/dateien/neu/abc.png' });
  const textFertig = await page.locator('body').innerText();
  rows.push({ name: 'Kein Logo-Fehlerhinweis', pass: !textFertig.includes('Das Logo ließ sich nicht speichern') });

  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
