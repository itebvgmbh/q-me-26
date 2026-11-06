// Logo für die E-Mails (frontend/public/img/mail/logo.png) aus Zeichen und Schrift der App erzeugen.
// Weiß auf durchsichtig, für den dunklen Kopf der Mails (backend/app/libs/mail.py, LOGO_SIZE dort anpassen).
//   node dev/mail-logo.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'frontend/node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2');
const OUT = path.join(ROOT, 'frontend/public/img/mail/logo.png');
// Wartemarke wie in frontend/src/components/brand/Logo.tsx (BrandMark, inverted)
const TICKET = 'M4 6h16a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V8a2 2 0 0 1 2-2z';

const html = `<!doctype html><html><head><style>
@font-face{font-family:Bricolage;src:url(data:font/woff2;base64,${fs.readFileSync(FONT).toString('base64')}) format('woff2');font-weight:200 800}
html,body{margin:0;background:transparent}
#logo{display:inline-flex;align-items:center;gap:10px}
#mark{width:30px;height:30px;border-radius:8px;background:#FFC93C;display:flex;align-items:center;justify-content:center}
#word{font-family:Bricolage;font-weight:800;font-size:25px;letter-spacing:-0.03em;line-height:30px;color:#fff;padding-right:1px}
</style></head><body><div id="logo"><span id="mark"><svg viewBox="0 0 24 24" width="21" height="21">
<path fill="#141414" d="${TICKET}"/><path d="M6.5 12h11" stroke="#FFC93C" stroke-width="1.6" stroke-dasharray="2 1.6"/>
</svg></span><span id="word">Dranzeit</span></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ deviceScaleFactor: 3 })).newPage();
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const logo = page.locator('#logo');
  const box = await logo.boundingBox();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await logo.screenshot({ path: OUT, omitBackground: true });
  await browser.close();
  console.log(`${path.relative(ROOT, OUT)}: ${Math.round(box.width)} x ${Math.round(box.height)} (angezeigt), dreifach aufgelöst`);
})();
