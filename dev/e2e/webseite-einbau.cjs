// "Mein Laden" → Auf deiner Webseite: Kasten, Knopf und QR-Code (Wegwerf-Laden, räumt sich selbst weg).
//  - Code zeigt auf dranzeit.de, Ladenname und Beschriftung sind maskiert, Kopieren klappt
//  - Backend liefert Kasten und QR-Bilder (braucht QME_BACKEND mit diesem Stand, z. B. https://dranzeit.de nach dem Ausrollen)
//  - Mit QME_EINBAU_LIVE=1: Fremde Seiten dürfen auf dranzeit.de nur den Kasten einbetten, nicht z. B. die Anmeldung
// Handy: kein waagrechtes Überlaufen. Fotos: dev/out/einbau-*.png
const path = require('path');
const { BASE, OUT, launch, newPage, collectErrors, tempShop, removeTempShop, report, run } = require('./lib.cjs');

const LIVE = 'https://dranzeit.de';

run(async () => {
  const browser = await launch();
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = collectErrors(page);
  const shop = await tempShop(page, 'Einbau <Test> & Co');
  const rows = [];
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  try {
    await page.goto(`${BASE}/shop-profile`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('section[aria-labelledby="webseite-titel"]');
    await section.waitFor({ timeout: 20000 });
    await section.scrollIntoViewIfNeeded();

    // --- Kasten ----------------------------------------------------------------------------------------
    const kasten = await section.locator('#code-kasten').inputValue();
    rows.push({
      name: 'Kasten: Code zeigt auf dranzeit.de/einbau',
      pass: kasten.includes(`src="${LIVE}/einbau/${shop.shopId}"`) && kasten.includes('height="300"'),
      detail: kasten.slice(0, 90),
    });
    rows.push({ name: 'Kasten: Ladenname maskiert', pass: kasten.includes('Einbau &lt;Test&gt; &amp; Co') && !kasten.includes('<Test>') });
    await section.getByRole('button', { name: 'Code kopieren' }).click();
    rows.push({ name: 'Kasten: Code kopieren', pass: (await clipboard()) === kasten });
    await section.getByRole('button', { name: 'Text kopieren' }).click();
    rows.push({ name: 'Kasten: Satz für Datenschutzerklärung', pass: /Dranzeit \(ITEBV GmbH\).*Cookies werden dabei nicht gesetzt/.test(await clipboard()) });
    const box = await page.evaluate(async (id) => {
      const r = await fetch(`/routes/seo/einbau/${id}`);
      return { status: r.status, text: await r.text() };
    }, shop.shopId);
    rows.push({
      name: 'Kasten: Backend liefert ihn',
      pass: box.status === 200 && box.text.includes('Einbau &lt;Test&gt; &amp; Co') && box.text.includes('Termin buchen') && box.text.includes('<svg'),
      detail: `${box.status}`,
    });
    await page.waitForTimeout(1500);
    await section.screenshot({ path: path.join(OUT, 'einbau-kasten.png') });

    // --- Knopf -----------------------------------------------------------------------------------------
    await section.getByRole('tab', { name: 'Knopf' }).click();
    await page.getByRole('combobox', { name: 'Der Knopf führt zu' }).click();
    await page.getByRole('option', { name: 'Termin buchen' }).click();
    await page.getByLabel('Beschriftung').fill('Jetzt <buchen> & "los"');
    const knopf = await section.locator('#code-knopf').inputValue();
    const a = section.getByTestId('knopf-vorschau').locator('a');
    rows.push({ name: 'Knopf: führt zum Buchen', pass: (await a.getAttribute('href')) === `${LIVE}/book-appointment?shopId=${shop.shopId}&fromMarketplace=true` });
    rows.push({
      name: 'Knopf: Beschriftung maskiert',
      pass: (await a.textContent()) === 'Jetzt <buchen> & "los"' && knopf.includes('Jetzt &lt;buchen&gt; &amp; &quot;los&quot;'),
      detail: knopf.slice(-60),
    });
    rows.push({ name: 'Knopf: öffnet neuen Tab', pass: (await a.getAttribute('target')) === '_blank' });
    await page.getByRole('combobox', { name: 'Der Knopf führt zu' }).click();
    await page.getByRole('option', { name: /Deine Seite bei Dranzeit/ }).click();
    rows.push({
      name: 'Knopf: Ladenseite, Text passt sich an',
      pass: (await a.getAttribute('href')) === `${LIVE}/shop-details?shopId=${shop.shopId}` && (await a.textContent()) === 'Nummer ziehen oder Termin buchen',
    });
    await section.getByRole('button', { name: 'Link kopieren' }).first().click();
    rows.push({ name: 'Knopf: Link kopieren', pass: (await clipboard()) === `${LIVE}/shop-details?shopId=${shop.shopId}` });
    await section.screenshot({ path: path.join(OUT, 'einbau-knopf.png') });

    // --- QR-Code ---------------------------------------------------------------------------------------
    await section.getByRole('tab', { name: 'QR-Code' }).click();
    const png = section.getByRole('link', { name: 'PNG herunterladen' });
    const svg = section.getByRole('link', { name: 'SVG herunterladen' });
    rows.push({
      name: 'QR: Links zu PNG und SVG',
      pass: (await png.getAttribute('href')) === `/routes/seo/einbau/${shop.shopId}/qr.png` && (await svg.getAttribute('href')) === `/routes/seo/einbau/${shop.shopId}/qr.svg`,
    });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), png.click()]);
    rows.push({ name: 'QR: PNG lädt herunter', pass: download?.suggestedFilename() === 'dranzeit-qr-einbau-test-co.png', detail: download?.suggestedFilename() || 'kein Download' });
    const img = await section.locator('img').evaluate((el) => el.complete && el.naturalWidth > 0);
    rows.push({ name: 'QR: Vorschau-Bild geladen', pass: img });
    await section.screenshot({ path: path.join(OUT, 'einbau-qr.png') });

    // --- Tipp Google-Profil ----------------------------------------------------------------------------
    await section.getByRole('button', { name: 'Link kopieren' }).last().click();
    rows.push({ name: 'Tipp: Link zur Ladenseite kopieren', pass: (await clipboard()) === `${LIVE}/shop-details?shopId=${shop.shopId}` });

    // --- Handy -----------------------------------------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await section.getByRole('tab', { name: 'Kasten' }).click();
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    rows.push({ name: 'Handy: kein waagrechtes Überlaufen', pass: overflow <= 0, detail: `${overflow}px` });
    await section.screenshot({ path: path.join(OUT, 'einbau-handy.png') });

    // --- Einbetten auf fremden Seiten (live) -----------------------------------------------------------
    if (process.env.QME_EINBAU_LIVE) {
      const ext = await browser.newPage();
      await ext.setContent(
        `<iframe src="${LIVE}/einbau/${shop.shopId}" width="560" height="300"></iframe><iframe src="${LIVE}/login" width="560" height="300"></iframe>`,
      );
      await ext.waitForTimeout(6000);
      const urls = ext.frames().map((f) => f.url());
      const kastenFrame = ext.frames().find((f) => f.url().includes('/einbau/'));
      const name = kastenFrame ? await kastenFrame.locator('h1').textContent().catch(() => '') : '';
      rows.push({ name: 'Fremde Seite: Kasten lässt sich einbetten', pass: name === 'Einbau <Test> & Co', detail: name });
      rows.push({ name: 'Fremde Seite: Anmeldung gesperrt', pass: !urls.some((u) => u.startsWith(`${LIVE}/login`)), detail: urls.join(' ') });
      await ext.screenshot({ path: path.join(OUT, 'einbau-fremde-seite.png') });
      await ext.close();
    }

    rows.push({ name: 'keine JS-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
    await removeTempShop(page, shop);
    await browser.close();
  }
  return report(rows);
});
