// Bilder für die Hilfe (backend/app/hilfe/artikel) aus der echten Oberfläche im Testladen, Handy und Desktop.
// Prüft nebenbei die Startklar-Liste am Tresen (erscheint, hakt den Testlauf ab, lässt sich ausblenden).
// Braucht: Entwicklungsserver mit Backend (QME_BACKEND) und Testdaten (python dev/fixtures.py anlegen).
// Schreibt nur im Testladen: Name, Öffnungs- und Arbeitszeiten für die Fotos, drei Nummern. Stellt alles wieder her.
// Ergebnis: frontend/public/img/hilfe/*.jpg – danach committen und in den Artikeln einbinden.
const fs = require('fs');
const path = require('path');
const { BASE, launch, newPage, collectErrors, fixture, report, run } = require('./lib.cjs');

const OUT = path.join(__dirname, '..', '..', 'frontend', 'public', 'img', 'hilfe');
const NAMES = ['Lea', 'Jonas', 'Mia'];
const DESKTOP = { width: 1280, height: 800 };
const HANDY = { width: 390, height: 844 };

const signIn = async (page, fx) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async (fx) => {
    const src = await (await fetch('/src/app/auth/firebase.ts')).text();
    const { signInWithEmailAndPassword } = await import(src.match(/from "([^"]*firebase[^"]*auth[^"]*)"/)[1]);
    const { firebaseAuth } = await import('/src/app/auth/firebase.ts');
    await signInWithEmailAndPassword(firebaseAuth, fx.email, fx.pw);
  }, fx);
};

/** Firestore im angemeldeten Browser: body bekommt fs (Modul), db und arg */
const firestore = (page, body, arg) =>
  page.evaluate(
    async ({ body, arg }) => {
      const src = await (await fetch('/src/utils/firestore-client.ts')).text();
      const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
      const { firestore: db } = await import('/src/utils/firestore-client.ts');
      return new Function('fs', 'db', 'arg', `return (async () => { ${body} })()`)(fs, db, arg);
    },
    { body, arg },
  );

const photo = async (target, name) => {
  fs.mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
};

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      rows.push({ name, pass: true, detail });
    } catch (e) {
      rows.push({ name, pass: false, detail: String(e).split('\n')[0].slice(0, 160) });
    }
  };

  const owner = await newPage(browser, { viewport: DESKTOP });
  const errors = collectErrors(owner);
  await signIn(owner, fx);

  // Für die Fotos: freundlicher Name, offen von früh bis spät, Startklar-Liste frisch
  const original = await firestore(
    owner,
    `const shop = (await fs.getDoc(fs.doc(db, 'shops', arg.shopId))).data();
     const staff = (await fs.getDoc(fs.doc(db, 'staff', arg.staffId))).data();
     const open = [0,1,2,3,4,5,6].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: '06:00', closeTime: '23:00', breaks: [] }));
     const work = [0,1,2,3,4,5,6].map((d) => ({ dayOfWeek: d, startTime: '06:00', endTime: '23:00', isWorking: true }));
     await fs.updateDoc(fs.doc(db, 'shops', arg.shopId), { name: 'Barbershop Muster', businessHoursByDay: open, onboarding: fs.deleteField() });
     await fs.updateDoc(fs.doc(db, 'staff', arg.staffId), { workingHours: work });
     return { name: shop.name, hours: shop.businessHoursByDay, work: staff.workingHours };`,
    fx,
  );

  const customer = await newPage(browser, { viewport: HANDY });
  try {
    await step('Tresen mit Startklar-Liste', async () => {
      await owner.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('heading', { name: 'Startklar machen' }).waitFor({ timeout: 20000 });
      await owner.waitForTimeout(1000);
      await photo(owner, 'tresen-startklar');
      return 'tresen-startklar';
    });

    await step('Kunde: Leistung wählen und Nummer ziehen', async () => {
      await customer.goto(`${BASE}/public-join-queue?shopId=${fx.shopId}`, { waitUntil: 'domcontentloaded' });
      const service = customer.locator('section button[aria-pressed]').first();
      await service.waitFor({ timeout: 60000 });
      await customer.waitForTimeout(500);
      await photo(customer, 'kunde-leistung');
      await service.click();
      await customer.getByRole('button', { name: /Egal wer/ }).click({ timeout: 30000 });
      await customer.waitForFunction(() => /\d{2}:\d{2}/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
      await customer.locator('#queue-name').fill(NAMES[0]);
      await photo(customer, 'kunde-bestaetigen');
      await customer.getByRole('button', { name: 'Nummer ziehen' }).click();
      await customer.getByText('Du bist eingereiht.').waitFor({ timeout: 30000 });
      await customer.waitForTimeout(1500);
      await photo(customer, 'kunde-nummer');
      return 'kunde-leistung, kunde-bestaetigen, kunde-nummer';
    });

    await step('Tresen: Nummer vergeben', async () => {
      for (const [i, name] of NAMES.slice(1).entries()) {
        await owner.getByRole('button', { name: 'Nummer vergeben' }).first().click();
        const dialog = owner.locator('[role="dialog"]');
        await dialog.getByText(/^Dran$|nichts frei/).first().waitFor({ timeout: 20000 });
        await dialog.locator('#customerName').fill(name);
        if (i === 0) await photo(dialog, 'nummer-vergeben');
        await dialog.getByRole('button', { name: 'Nummer vergeben' }).click();
        await owner.getByText(/Nummer vergeben: \d\d:\d\d/).first().waitFor({ timeout: 15000 });
        await owner.waitForTimeout(800);
      }
      return 'nummer-vergeben';
    });

    await step('Tresen: Schlange und Aufrufen', async () => {
      const lane = owner.locator('section[aria-label^="Schlange von"]').first();
      await lane.getByText(NAMES[2]).waitFor({ timeout: 15000 });
      await photo(lane, 'tresen-schlange');
      await lane.getByRole('button', { name: 'Nächste Nummer aufrufen' }).click();
      await lane.getByText('Jetzt dran').waitFor();
      await owner.waitForTimeout(1500);
      await photo(lane, 'tresen-aufgerufen');
      await customer.getByText(/Du bist dran/).first().waitFor({ timeout: 20000 });
      await customer.waitForTimeout(800);
      await photo(customer, 'kunde-dran');
      return 'tresen-schlange, tresen-aufgerufen, kunde-dran';
    });

    await step('Startklar hakt den Testlauf ab', async () => {
      const item = owner.getByRole('button', { name: /Einmal selbst ausprobieren \(erledigt\)/ });
      await item.waitFor({ timeout: 10000 });
      return 'erledigt';
    });

    await step('Plakat', async () => {
      await owner.goto(`${BASE}/plakat`, { waitUntil: 'domcontentloaded' });
      const sheet = owner.locator('article').first();
      await sheet.waitFor({ timeout: 20000 });
      await owner.waitForTimeout(800);
      await photo(sheet, 'plakat');
      return 'plakat';
    });

    await step('Team: Pausen', async () => {
      await owner.goto(`${BASE}/staff-management`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('button', { name: 'Bearbeiten' }).first().click({ timeout: 20000 });
      const dialog = owner.locator('[role="dialog"]');
      await dialog.getByRole('button', { name: 'Wöchentliche Pausen' }).click();
      await owner.waitForTimeout(1500);
      await photo(dialog, 'team-pausen');
      await owner.keyboard.press('Escape');
      return 'team-pausen';
    });

    await step('Leistung bearbeiten', async () => {
      await owner.goto(`${BASE}/service-management`, { waitUntil: 'domcontentloaded' });
      await owner.getByText('Schnitt', { exact: true }).first().waitFor({ timeout: 20000 });
      await owner.getByRole('button', { name: /Bearbeiten/ }).first().click();
      const dialog = owner.locator('[role="dialog"]');
      await dialog.locator('#setupTime').waitFor({ timeout: 10000 });
      await owner.waitForTimeout(500);
      await photo(dialog, 'leistung');
      await owner.keyboard.press('Escape');
      return 'leistung';
    });

    await step('Wartezimmer-Bildschirm', async () => {
      const screen = await newPage(browser, { viewport: { width: 1280, height: 720 } });
      await screen.goto(`${BASE}/bildschirm/${fx.shopId}`, { waitUntil: 'domcontentloaded' });
      await screen.getByText(NAMES[1]).first().waitFor({ timeout: 30000 }).catch(() => {});
      await screen.waitForTimeout(2000);
      await photo(screen, 'bildschirm');
      await screen.close();
      return 'bildschirm';
    });

    await step('Mein Tarif', async () => {
      await owner.goto(`${BASE}/tarif`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('heading', { name: 'Mein Tarif' }).waitFor({ timeout: 20000 });
      await owner.waitForTimeout(1500);
      await photo(owner, 'tarif');
      return 'tarif';
    });

    await step('Startklar lässt sich ausblenden', async () => {
      await owner.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('heading', { name: 'Startklar machen' }).waitFor({ timeout: 20000 });
      await owner.getByRole('button', { name: 'Liste ausblenden' }).click();
      await owner.reload({ waitUntil: 'domcontentloaded' });
      await owner.getByRole('button', { name: 'Nummer vergeben' }).first().waitFor({ timeout: 20000 });
      await owner.waitForTimeout(1500);
      const still = await owner.getByRole('heading', { name: 'Startklar machen' }).count();
      if (still) throw new Error('Liste nach dem Ausblenden noch da');
      return 'ausgeblendet';
    });
  } finally {
    // Aufräumen: Nummern weg, Name und Zeiten zurück, Startklar-Merker weg
    await firestore(
      owner,
      `const docs = await fs.getDocs(fs.query(fs.collection(db, 'appointments'), fs.where('shopId', '==', arg.fx.shopId)));
       for (const d of docs.docs) if (arg.names.includes(d.data().customerName)) await fs.deleteDoc(d.ref);
       await fs.updateDoc(fs.doc(db, 'shops', arg.fx.shopId), { name: arg.original.name, businessHoursByDay: arg.original.hours, onboarding: fs.deleteField() });
       await fs.updateDoc(fs.doc(db, 'staff', arg.fx.staffId), { workingHours: arg.original.work });`,
      { fx, names: NAMES, original },
    ).catch((e) => rows.push({ name: 'Aufräumen', pass: false, detail: String(e).slice(0, 160) }));
  }

  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ').slice(0, 200) });
  await browser.close();
  return report(rows);
});
