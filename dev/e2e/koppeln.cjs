// Tablet am Tresen per QR-Code koppeln: Tablet zeigt Code und Prüfzahl, Handy des Inhabers bestätigt, Tablet landet am
// Tresen und darf nur den Tresen (Navigation, Seiten, Backend), Inhaber sieht es unter „Laden“ und meldet es ab.
// Seiten: frontend/src/pages/Koppeln.tsx, KoppelnBestaetigen.tsx, components/GekoppelteTablets.tsx;
// Backend: backend/app/apis/geraete, backend/app/libs/geraete.py. Braucht das Backend ab diesem Stand
// (QME_BACKEND=https://dranzeit.de nach dem Ausrollen). Legt einen Wegwerf-Laden an (lib.cjs, tempShop).
const { BASE, launch, newPage, tempShop, removeTempShop, collectErrors, shot } = require('./lib.cjs');

(async () => {
  const browser = await launch();
  const fehler = [];
  const pruefe = (ok, text) => {
    console.log(`${ok ? 'ok    ' : 'FEHLER'} ${text}`);
    if (!ok) fehler.push(text);
  };

  try {
    // Handy des Inhabers: Wegwerf-Laden, angemeldet
    const handy = await newPage(browser);
    const laden = await tempShop(handy, 'Koppeln-Test');

    // Tablet: eigener Browser, quer, ohne Anmeldung
    const tablet = await newPage(browser, { viewport: { width: 1280, height: 800 } });
    const jsFehler = collectErrors(tablet);
    const startAntwort = tablet.waitForResponse((r) => r.url().includes('/routes/geraete/koppeln/start'));
    await tablet.goto(`${BASE}/koppeln`, { waitUntil: 'domcontentloaded' });
    const start = await (await startAntwort).json();
    await tablet.getByText(start.pruefzahl, { exact: true }).waitFor();
    pruefe(await tablet.locator('svg[role="img"] title, svg title').first().count() > 0, `Tablet zeigt QR-Code und Prüfzahl ${start.pruefzahl}`);
    await shot(tablet, 'koppeln-tablet');

    // Fremder Code am Handy: abgelaufen
    await handy.goto(`${BASE}/koppeln/bestaetigen?code=gibt-es-nicht`, { waitUntil: 'domcontentloaded' });
    await handy.getByText('Dieser Code gilt nicht mehr').waitFor();
    pruefe(true, 'Unbekannter Code: „Dieser Code gilt nicht mehr“');

    // Handy „scannt“: öffnet die Adresse aus dem QR-Code, sieht dieselbe Prüfzahl, bestätigt
    await handy.goto(`${BASE}/koppeln/bestaetigen?code=${encodeURIComponent(start.code)}`, { waitUntil: 'domcontentloaded' });
    await handy.getByText(start.pruefzahl, { exact: true }).waitFor();
    pruefe(true, 'Handy zeigt dieselbe Prüfzahl');
    await shot(handy, 'koppeln-handy');
    await handy.getByRole('button', { name: 'Tablet anmelden' }).click();
    await handy.getByText('Fertig. Das Tablet zeigt gleich den Tresen.').waitFor();

    // Tablet landet am Tresen
    await tablet.waitForURL('**/shop-dashboard', { timeout: 20_000 });
    await tablet.getByRole('heading', { name: 'Koppeln-Test' }).waitFor({ timeout: 20_000 });
    pruefe(true, 'Tablet zeigt den Tresen des Ladens');
    await shot(tablet, 'koppeln-tresen');
    const nav = (await tablet.getByRole('navigation', { name: 'Hauptnavigation' }).first().innerText()).replace(/\s+/g, ' ').trim();
    pruefe(/Heute/.test(nav) && /Kalender/.test(nav) && !/Laden/.test(nav), `Navigation nur Heute und Kalender („${nav}“)`);
    const ich = await tablet.evaluate(async () => (await fetch('/routes/anmeldung/ich', { cache: 'no-store' })).json());
    pruefe(ich.bereich === 'tresen' && ich.laden === laden.shopId, `Sitzung nur für den Tresen (${ich.bereich}, ${ich.laden})`);

    // Seiten außerhalb des Tresens führen zurück
    for (const pfad of ['/shop-profile', '/tarif', '/profile']) {
      await tablet.goto(`${BASE}${pfad}`, { waitUntil: 'domcontentloaded' });
      await tablet.waitForURL('**/shop-dashboard', { timeout: 10_000 }).catch(() => undefined);
      pruefe(new URL(tablet.url()).pathname === '/shop-dashboard', `${pfad} → zurück zum Tresen`);
    }
    await tablet.goto(`${BASE}/kalender`, { waitUntil: 'domcontentloaded' });
    await tablet.waitForTimeout(1500);
    pruefe(new URL(tablet.url()).pathname === '/kalender', 'Kalender geht');

    // Backend: Tresen ja, Tarif, Laden ändern, Passwort, weitere Geräte nein
    const antworten = await tablet.evaluate(async (shopId) => {
      const post = (pfad, body = {}) =>
        fetch(pfad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const status = async (antwort) => `${antwort.status} ${antwort.headers.get('X-Anmeldung-Fehler') || ''}`.trim();
      return {
        kunden: await status(await fetch(`/routes/team/laeden/${shopId}/kunden`)),
        termine: await status(await fetch(`/routes/team/termine?shopId=${shopId}&von=2026-01-01T00:00:00Z&bis=2026-01-02T00:00:00Z`)),
        tarif: await status(await post('/routes/billing/portal', { shop_id: shopId })),
        laden: await status(await post(`/routes/team/laeden/${shopId}`, { name: 'Umbenannt' })),
        passwort: await status(await post('/routes/anmeldung/passwort-pruefen', { passwort: 'x' })),
        geraete: await status(await fetch('/routes/geraete')),
      };
    }, laden.shopId);
    pruefe(antworten.kunden === '200' && antworten.termine === '200', `Backend: Kunden und Termine lesen (${antworten.kunden}, ${antworten.termine})`);
    for (const art of ['tarif', 'laden', 'passwort', 'geraete']) {
      pruefe(antworten[art] === '403 auth/tresen', `Backend: ${art} gesperrt (${antworten[art]})`);
    }

    // Inhaber: Tablet unter „Laden“, abmelden
    await handy.goto(`${BASE}/shop-profile`, { waitUntil: 'domcontentloaded' });
    const liste = handy.locator('section[aria-labelledby="tablets-tresen"]');
    await liste.getByText(/Koppeln-Test/).waitFor({ timeout: 15_000 });
    pruefe(true, 'Tablet steht unter „Laden“ → „Tablets am Tresen“');
    await liste.scrollIntoViewIfNeeded();
    await shot(handy, 'koppeln-liste');
    await liste.getByRole('button', { name: 'Abmelden' }).click();
    await handy.getByText('Tablet abgemeldet').waitFor();
    const nachher = await tablet.evaluate(async () => (await fetch('/routes/anmeldung/ich', { cache: 'no-store' })).json());
    pruefe(nachher.uid === null, 'Tablet nach dem Abmelden ohne Sitzung');

    pruefe(jsFehler.length === 0, `keine JavaScript-Fehler am Tablet${jsFehler.length ? `: ${jsFehler.join(' | ')}` : ''}`);
    await removeTempShop(handy, laden);
  } catch (e) {
    pruefe(false, `Abbruch: ${String(e).slice(0, 300)}`);
  } finally {
    await browser.close();
  }

  if (fehler.length) {
    console.log(`\n${fehler.length} Fehler`);
    process.exit(1);
  }
  console.log('\nKoppeln: alles in Ordnung');
})();
