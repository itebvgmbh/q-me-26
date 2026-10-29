// Inhaber mit zwei Läden: Heute, Kalender, Laden, Leistungen, Team, Tarif und Auswertung zeigen denselben Laden –
// den zuletzt gezeigten (frontend/src/utils/laden-wahl.ts). Wegwerf-Konto mit zwei Wegwerf-Läden, räumt selbst auf.
// Braucht den Entwicklungsserver (Anmelden über /src/…).
const { BASE, launch, newPage, collectErrors, tempShop, removeTempShop, report, run } = require('./lib.cjs');

run(async () => {
  const browser = await launch();
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const errors = collectErrors(page);
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const a = await tempShop(page, 'Laden A (Test Ladenwahl)');
  let b = null;
  try {
    // Zweiter Laden desselben Inhabers
    b = await page.evaluate(async (uid) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      const now = fs.Timestamp.now();
      const ref = await fs.addDoc(fs.collection(firestore, 'shops'), {
        name: 'Laden B (Test Ladenwahl)', owner: uid, phone: '1', email: 'b@example.com', createdAt: now, updatedAt: now,
        businessHoursByDay: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isOpen: d >= 1 && d <= 5, openTime: '09:00', closeTime: '17:00', breaks: [] })),
      });
      return { shopId: ref.id };
    }, a.uid);

    /** Name im Auswahlfeld „Laden wählen“/„Laden wechseln“ (Radix zeigt nur den gewählten) bzw. Wert der <select> */
    const shown = async (path) => {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      const box = page.getByRole('combobox', { name: /Laden (wählen|wechseln)/ }).first();
      await box.waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const tag = await box.evaluate((el) => el.tagName);
      return tag === 'SELECT' ? (await box.inputValue()) === b.shopId ? 'B' : 'A' : /Laden B/.test(await box.innerText()) ? 'B' : 'A';
    };

    check('Heute mit ?shopId= von B zeigt B', (await shown(`/shop-dashboard?shopId=${b.shopId}`)) === 'B');
    for (const path of ['/kalender', '/shop-profile', '/service-management', '/staff-management', '/tarif', '/auswertung']) {
      const got = await shown(path);
      check(`${path} folgt (B)`, got === 'B', got);
    }

    // Unter „Heute“ auf A wechseln – die anderen Seiten folgen
    await page.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: 'Laden wechseln' }).click({ timeout: 30000 });
    await page.getByRole('option', { name: /Laden A/ }).click();
    await page.waitForTimeout(2000);
    for (const path of ['/shop-profile', '/tarif']) {
      const got = await shown(path);
      check(`Nach Wechsel unter Heute: ${path} zeigt A`, got === 'A', got);
    }
  } finally {
    if (b) {
      await page.evaluate(async ({ shopId, uid }) => {
        const src = await (await fetch('/src/utils/firestore-client.ts')).text();
        const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
        const { firestore } = await import('/src/utils/firestore-client.ts');
        const batch = fs.writeBatch(firestore);
        batch.set(fs.doc(firestore, 'deleted_shops', shopId), { owner: uid, deletedAt: fs.Timestamp.now() });
        batch.delete(fs.doc(firestore, 'shops', shopId));
        await batch.commit();
      }, { shopId: b.shopId, uid: a.uid });
    }
    await removeTempShop(page, a);
  }
  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return report(rows);
});
