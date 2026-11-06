// Ladenauswahl in der Kopfzeile (frontend/src/utils/laden-kontext.tsx, components/LadenWahlKopf.tsx):
//  - ein Laden: keine Auswahl
//  - zwei Läden: genau eine Auswahl oben, auf allen Seiten des Ladens derselbe Laden, keine zweite Auswahl auf der Seite
//  - Wechsel oben gilt für alle Seiten, auch nach dem Neuladen; ?shopId= wählt, verschwindet beim Wechsel
//  - Handy: Kopfzeile läuft nicht über
// Wegwerf-Konto mit zwei Wegwerf-Läden (bleiben bis „Konten aufräumen“). Braucht den Entwicklungsserver (Anmelden über /src/…).
const { BASE, launch, newPage, shot, collectErrors, tempShop, removeTempShop, report, run } = require('./lib.cjs');

const SEITEN = ['/shop-dashboard', '/kalender', '/shop-profile', '/service-management', '/staff-management', '/tarif', '/auswertung', '/plakat', '/telefon-assistent'];

run(async () => {
  const browser = await launch();
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const a = await tempShop(page, 'Laden A (Test Ladenwahl)');
  const auswahl = () => page.getByRole('combobox', { name: /Laden (wählen|wechseln)/ });
  const kopf = () => page.locator('header').getByRole('combobox', { name: 'Laden wechseln' });
  /** Seite öffnen und warten, bis sie steht (Überschrift da, nichts lädt mehr) */
  const oeffne = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('main h1').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
  };
  const imKopf = async () => ((await kopf().count()) ? ((await kopf().innerText()).includes('Laden B') ? 'B' : (await kopf().innerText()).includes('Laden A') ? 'A' : '?') : '–');

  try {
    // Nur ein Laden: oben nichts zu wählen
    await oeffne('/shop-dashboard');
    check('Ein Laden: keine Auswahl', (await auswahl().count()) === 0, String(await auswahl().count()));

    // Zweiter Laden desselben Inhabers, wie in der App über das Backend
    const b = await page.evaluate(async () => {
      const { createShop } = await import('/src/utils/firestore/shops.ts');
      const laden = await createShop('', {
        name: 'Laden B (Test Ladenwahl)', phone: '1', email: 'b@example.com',
        businessHoursByDay: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isOpen: d >= 1 && d <= 5, openTime: '09:00', closeTime: '17:00', breaks: [] })),
      });
      return { shopId: laden.id };
    });

    // ?shopId= eines eben angelegten Ladens: wird nachgeladen und gewählt (wie nach „Laden einrichten“)
    await oeffne(`/shop-dashboard?shopId=${b.shopId}`);
    check('Neuer Laden per ?shopId= gewählt', (await imKopf()) === 'B', await imKopf());
    check('Heute: Name auf der Seite', /Laden B/.test(await page.locator('main h1').first().innerText()));

    for (const path of SEITEN) {
      await oeffne(path);
      const anzahl = await auswahl().count();
      const got = await imKopf();
      check(`${path}: eine Auswahl, oben B`, anzahl === 1 && got === 'B', `${anzahl} Auswahl, oben ${got}`);
    }
    // Seite ohne Bezug zum Laden: keine Auswahl
    await oeffne('/profile');
    check('Mein Profil: keine Auswahl', (await auswahl().count()) === 0);

    // Oben auf A wechseln: Seite folgt, ?shopId= ist weg (Bilder in dev/out/laden-wahl-*.png)
    await oeffne(`/shop-dashboard?shopId=${b.shopId}`);
    await shot(page, 'laden-wahl-desktop', false);
    await kopf().click();
    await page.getByRole('option', { name: /Laden A/ }).waitFor();
    await shot(page, 'laden-wahl-desktop-offen', false);
    await page.getByRole('option', { name: /Laden A/ }).click();
    await page.waitForFunction(() => /Laden A/.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 30000 });
    check('Wechsel oben: Heute zeigt A', true);
    check('Wechsel oben: ?shopId= entfernt', !new URL(page.url()).searchParams.has('shopId'), page.url());

    // Über das Menü weiter: die anderen Seiten folgen
    await page.locator('header nav').getByRole('link', { name: 'Kalender' }).click();
    await page.waitForURL(/\/kalender/);
    await page.waitForFunction(() => /Laden A/.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 30000 });
    check('Menü Kalender: A', (await imKopf()) === 'A', await imKopf());
    await page.locator('header nav').getByRole('link', { name: 'Laden' }).click();
    await page.waitForURL(/\/shop-profile/);
    await page.waitForFunction(() => /Laden A/.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 30000 });
    check('Menü Laden: A', (await imKopf()) === 'A', await imKopf());

    // Neu laden: bleibt A
    await oeffne('/tarif');
    // Im Tarif-Kasten steht der Name in Großbuchstaben (innerText übernimmt das)
    check('Nach Neuladen: Tarif zeigt A', (await imKopf()) === 'A' && /Laden A/i.test(await page.locator('main').innerText()), await imKopf());

    // Auf dem Handy: Auswahl sichtbar, nichts läuft über
    await page.setViewportSize({ width: 360, height: 760 });
    await oeffne('/shop-dashboard');
    const handy = await page.evaluate(() => {
      const box = document.querySelector('header [role="combobox"]')?.getBoundingClientRect();
      return { breite: document.documentElement.scrollWidth, fenster: window.innerWidth, rechts: box ? box.right : -1 };
    });
    check('Handy: Auswahl in der Kopfzeile', handy.rechts > 0 && handy.rechts <= handy.fenster, JSON.stringify(handy));
    check('Handy: kein Überlauf', handy.breite <= handy.fenster, JSON.stringify(handy));
    await shot(page, 'laden-wahl-handy', false);
    await page.setViewportSize({ width: 768, height: 900 });
    await oeffne('/shop-dashboard');
    const tablet = await page.evaluate(() => ({ breite: document.documentElement.scrollWidth, fenster: window.innerWidth }));
    check('Tablet (768): kein Überlauf', tablet.breite <= tablet.fenster, JSON.stringify(tablet));
    await shot(page, 'laden-wahl-tablet', false);

    // Mein Tag folgt der Kopfzeile: eigener Eintrag nur im Team von B (Inhaber darf sich selbst eintragen)
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async ({ shopId, uid }) => {
      const { createStaff } = await import('/src/utils/firestore/staff.ts');
      const tage = [0, 1, 2, 3, 4, 5, 6];
      await createStaff({
        shopId, name: 'Ich selbst', email: '', phone: '', role: 'staff', serviceIds: [], isActive: true, status: 'available', userId: uid,
        workingHours: tage.map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00', isWorking: d !== 0 })),
      });
    }, { shopId: b.shopId, uid: a.uid });
    await page.goto(`${BASE}/employee-dashboard`, { waitUntil: 'domcontentloaded' });
    const hinweisA = await page.getByText('Die Termine deines Teams stehen am Tresen.').waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('Mein Tag, oben A (kein Eintrag): Hinweis', hinweisA && (await imKopf()) === 'A', await imKopf());
    await kopf().click();
    await page.getByRole('option', { name: /Laden B/ }).click();
    const tagB = await page.getByRole('button', { name: 'Meine Arbeitszeiten' }).waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('Mein Tag, oben B: eigener Tag', tagB && (await page.getByText('Die Termine deines Teams stehen am Tresen.').count()) === 0);
  } finally {
    await removeTempShop(page, a);
  }
  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
