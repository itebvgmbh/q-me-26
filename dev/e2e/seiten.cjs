// Alle wichtigen Seiten auf Handy und Desktop: JavaScript-Fehler, horizontaler Überlauf, Bildschirmfotos
// nach dev/out/. Eigene Seiten als Argumente: node dev/e2e/seiten.cjs /login /shop-map
const { BASE, SHOP_ID, launch, collectErrors, shot, report, run } = require('./lib.cjs');

const DEFAULT_PAGES = ['/', '/shop-map', `/shop-details?shopId=${SHOP_ID}`, `/public-join-queue?shopId=${SHOP_ID}`, `/book-appointment?shopId=${SHOP_ID}&fromMarketplace=true`, '/features', '/impressum', '/datenschutz', '/agb', '/preise', `/bildschirm/${SHOP_ID}`, '/login', '/register-options', '/my-bookings', '/email-bestaetigen', '/gibts-nicht'];

run(async () => {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;
  const browser = await launch();
  const rows = [];
  for (const [label, viewport] of [['handy', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const context = await browser.newContext({ viewport, timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const page = await context.newPage();
    const errors = collectErrors(page);
    for (const path of pages) {
      const before = errors.length;
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot(page, `seite-${label}${path.replace(/[/?=&]/g, '_')}`);
      rows.push({ name: `${label} ${path}`.slice(0, 40), pass: overflow <= 0 && errors.length === before, detail: [overflow > 0 && `Überlauf ${overflow}px`, ...errors.slice(before)].filter(Boolean).join(' | ') });
    }
    await context.close();
  }
  await browser.close();
  return report(rows);
});
