// Mein Tag: Zeitraum wählen und blättern (Wegwerf-Laden, räumt sich selbst weg).
//  - Ein neu gewählter Zeitraum (3/5 Tage, auch zurück auf 1 Tag) beginnt heute, auch wenn vorher ein anderer Tag zu sehen war
//  - Die Pfeile schieben den Zeitraum um genau einen Tag, nicht um seine ganze Länge
const { BASE, launch, newPage, shot, collectErrors, tempShop, removeTempShop, report, run } = require('./lib.cjs');

/** Tag im Monat, heute + offset Tage, deutsche Zeit */
const dayOfMonth = (offset) => {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())}T12:00:00Z`);
  today.setUTCDate(today.getUTCDate() + offset);
  return today.getUTCDate();
};

run(async () => {
  const browser = await launch();
  const page = await newPage(browser, { viewport: { width: 1440, height: 900 } });
  const errors = collectErrors(page);
  const shop = await tempShop(page, 'Mein-Tag-Zeitraum (Test)');
  const rows = [];
  try {
    // Inhaber ist selbst die Person Robin, damit "Mein Tag" ihre Termine zeigt
    await page.evaluate(async ({ staffId, uid }) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore } = await import('/src/utils/firestore-client.ts');
      await fs.updateDoc(fs.doc(firestore, 'staff', staffId), { userId: uid });
    }, shop);
    await page.goto(`${BASE}/employee-dashboard`, { waitUntil: 'domcontentloaded' });
    const back = page.getByRole('button', { name: 'Einen Tag zurück' });
    const next = page.getByRole('button', { name: 'Einen Tag weiter' });
    await back.waitFor({ timeout: 20000 });
    const label = back.locator('xpath=following-sibling::p[1]');
    /** Tage im Monat aus der Anzeige, z. B. "Do. 22. Okt. – Mo. 26. Okt." → [22, 26] */
    const shown = async () => {
      await page.waitForTimeout(400);
      return ((await label.textContent()) || '').match(/\d+(?=\. )/g).map(Number);
    };
    const choose = async (text) => {
      await page.getByRole('combobox', { name: 'Zeitraum' }).click();
      await page.getByRole('option', { name: text, exact: true }).click();
    };
    const check = async (name, from, to) => {
      const got = await shown();
      const want = to === undefined ? [dayOfMonth(from)] : [dayOfMonth(from), dayOfMonth(to)];
      rows.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), detail: `${await label.textContent()} (erwartet ${want.join('–')})` });
    };

    await check('Start: heute', 0);
    await next.click();
    await check('1 Tag: Pfeil vor → morgen', 1);
    await back.click();
    await back.click();
    await check('1 Tag: zweimal zurück → gestern', -1);

    await choose('5 Tage');
    await check('5 Tage gewählt → ab heute', 0, 4);
    rows.push({ name: '5 Tage: kein "Heute"-Knopf nötig', pass: (await page.getByRole('button', { name: 'Heute', exact: true }).count()) === 0 });
    await shot(page, 'mein-tag-5-tage', false);
    await next.click();
    await check('5 Tage: Pfeil vor → einen Tag weiter', 1, 5);
    await back.click();
    await back.click();
    await check('5 Tage: zweimal zurück → ab gestern', -1, 3);
    rows.push({ name: '5 Tage: "Heute"-Knopf da, wenn nicht ab heute', pass: (await page.getByRole('button', { name: 'Heute', exact: true }).count()) === 1 });

    await next.click();
    await next.click();
    await next.click();
    await choose('3 Tage');
    await check('3 Tage gewählt → wieder ab heute', 0, 2);
    await next.click();
    await choose('1 Tag');
    await check('1 Tag gewählt → heute', 0);

    rows.push({ name: 'keine JS-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  } finally {
    await removeTempShop(page, shop);
    await browser.close();
  }
  return report(rows);
});
