// Ladezeit "Nummer ziehen": QR-Link öffnen → Leistungen sichtbar; "Egal wer" tippen → Uhrzeit sichtbar.
//   node dev/e2e/ladezeit.cjs           normales Netz
//   node dev/e2e/ladezeit.cjs handy     langsames Handynetz (150 ms, 1,6 MBit/s, 4× langsamere CPU)
// Für echte Werte gegen den Build messen: npm run build && npm run preview, dann QME_URL=http://localhost:4173
const { BASE, SHOP_ID, launch, newPage, run } = require('./lib.cjs');

run(async () => {
  const mobile = process.argv[2] === 'handy';
  const browser = await launch();
  const page = await newPage(browser);
  let requests = 0;
  page.on('request', (r) => { if (/firestore\.googleapis\.com/.test(r.url())) requests++; });
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const t0 = Date.now();
  await page.goto(`${BASE}/public-join-queue?shopId=${SHOP_ID}`, { waitUntil: 'commit' });
  const firstService = page.locator('section button[aria-pressed]').first();
  await firstService.waitFor({ timeout: 90000 });
  const servicesMs = Date.now() - t0;
  await firstService.click();
  const any = page.getByRole('button', { name: /Egal wer/ });
  await any.waitFor();
  const before = requests;
  const t1 = Date.now();
  await any.click();
  await page.waitForFunction(() => /\d{2}:\d{2}|kein Platz/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 90000 });
  console.log(`Netz: ${mobile ? 'langsames Handynetz' : 'normal'}`);
  console.log(`Seite öffnen → Leistungen sichtbar: ${servicesMs} ms`);
  console.log(`"Egal wer" → Uhrzeit sichtbar:      ${Date.now() - t1} ms (${requests - before} Datenbank-Anfragen)`);
  await browser.close();
});
