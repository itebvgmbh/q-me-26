// Betriebsseiten im Testladen, Handy und Desktop: Tresen, Team, Leistungen, Mein Laden, Mein Tag, Früher dran.
// Prüft, was der Rundgang vom 17.10.2026 gefunden hat:
//  - Dialoge: kein Feld ragt über den Rand, Hauptknopf vollständig sichtbar
//  - Leistungsliste: Name überlappt die Dauer nicht
//  - "Person bearbeiten" speichert auch ohne Telefon
//  - "Nummer vergeben": nur Leistung/Person/Name, zeigt den nächsten Platz, legt die Nummer an
//  - keine englischen Beschriftungen, keine JavaScript-Fehler, kein waagrechtes Überlaufen
//  - "Früher dran": Steuerung nur für den Betreiber; Verlauf nur eigene Läden (Backend)
// Braucht: Entwicklungsserver (für das echte Backend: QME_BACKEND=https://dranzeit.de) und Testdaten.
// Schreibt nur im Testladen (eine Nummer); python dev/fixtures.py loeschen räumt sie weg.
const { BASE, launch, newPage, shot, collectErrors, fixture, report, run } = require('./lib.cjs');

const ENGLISH = /\b(Submit|Cancel|Loading|Save|Delete|Edit|Close|Services|Shop Name|Shop Logo|Email|Choose)\b/;

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

/** Felder/Knöpfe, die über den rechten Rand des offenen Dialogs ragen */
const dialogOverflow = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return ['kein Dialog'];
    const right = d.getBoundingClientRect().right;
    return [...d.querySelectorAll('input, button, [role="combobox"], select, textarea')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > right + 1)
      .map((el) => (el.textContent || el.getAttribute('placeholder') || el.id || el.tagName).trim().slice(0, 30));
  });

/** Nummern "Laufkundschaft", die dieser Test im Testladen angelegt hat, wieder löschen */
const removeWalkIns = (page, shopId) =>
  page.evaluate(async (shopId) => {
    const src = await (await fetch('/src/utils/firestore-client.ts')).text();
    const fs = await import(src.match(/from "([^"]*firebase[^"]*firestore[^"]*)"/)[1]);
    const { firestore } = await import('/src/utils/firestore-client.ts');
    const docs = await fs.getDocs(fs.query(fs.collection(firestore, 'appointments'), fs.where('shopId', '==', shopId)));
    for (const d of docs.docs) if (d.data().customerName === 'Laufkundschaft') await fs.deleteDoc(d.ref);
  }, shopId);

const pageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const visibleText = (page) => page.evaluate(() => document.body.innerText);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const rows = [];
  for (const [device, viewport] of [['handy', { width: 360, height: 640 }], ['desktop', { width: 1280, height: 800 }]]) {
    const page = await newPage(browser, { viewport });
    const errors = collectErrors(page);
    await signIn(page, fx);
    const english = [];
    const overflow = [];
    const check = async (name) => {
      const wide = await pageOverflow(page);
      if (wide > 1) overflow.push(`${name} +${wide}px`);
      const hit = (await visibleText(page)).match(ENGLISH);
      if (hit) english.push(`${name}: ${hit[0]}`);
      await shot(page, `betrieb-${device}-${name}`, false);
    };

    // Tresen + Dialoge
    await page.goto(`${BASE}/shop-dashboard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Nummer vergeben' }).first().waitFor({ timeout: 15000 });
    await check('tresen');
    await page.getByRole('button', { name: 'Nummer vergeben' }).first().click();
    await page.locator('[role="dialog"]').getByText(/^Dran$|nichts frei/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const queueDialog = {
      fields: await page.locator('[role="dialog"] label').allTextContents(),
      overflow: await dialogOverflow(page),
      text: await page.locator('[role="dialog"]').innerText(),
    };
    await check('dlg-nummer');
    if (device === 'handy') {
      await page.locator('[role="dialog"]').getByRole('button', { name: 'Nummer vergeben' }).click();
      await page.getByText(/Nummer vergeben: \d\d:\d\d bei Robin/).waitFor({ timeout: 15000 }).catch(() => {});
      queueDialog.created = await page.getByText(/Nummer vergeben: \d\d:\d\d bei Robin/).count();
      // Die Nummer wieder löschen – die Regeltests erwarten die Zeiten im Testladen frei
      await removeWalkIns(page, fx.shopId);
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Termin eintragen' }).first().click();
    await page.waitForTimeout(800);
    const bookedOverflow = await dialogOverflow(page);
    await check('dlg-termin');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Laden bearbeiten' }).click();
    await page.waitForTimeout(800);
    const shopOverflow = await dialogOverflow(page);
    await check('dlg-laden');
    await page.keyboard.press('Escape');

    // Team: Robin hat kein Telefon – Speichern muss trotzdem gehen
    await page.goto(`${BASE}/staff-management`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Bearbeiten' }).first().waitFor({ timeout: 15000 });
    await check('team');
    await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
    await page.waitForTimeout(800);
    const staffOverflow = await dialogOverflow(page);
    await check('dlg-person');
    await page.getByRole('button', { name: 'Arbeitszeiten' }).click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Änderungen speichern' }).last().click();
    const saved = await page.getByText('Gespeichert.').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    const pflicht = await page.getByText('Pflichtfelder').count();

    // Leistungen: Name darf die Dauer nicht überdecken
    await page.goto(`${BASE}/service-management`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Schnitt', { exact: true }).first().waitFor({ timeout: 15000 });
    const listOverlap = await page.evaluate(() => {
      const li = document.querySelector('ul li');
      const [name, dur] = [li.querySelector('p'), li.querySelectorAll('p')[1]];
      const a = name.getBoundingClientRect();
      const b = [...li.querySelectorAll('p')].find((p) => /Min/.test(p.textContent)).getBoundingClientRect();
      return a.right > b.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1;
    });
    await check('leistungen');

    for (const [url, name] of [['/shop-profile', 'mein-laden'], ['/employee-dashboard', 'mein-tag'], ['/scheduler-control', 'frueher-dran']]) {
      await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await check(name);
    }
    const controls = await page.getByRole('button', { name: /Stoppen|Starten/ }).count();
    const meinTagText = await page.goto(`${BASE}/employee-dashboard`).then(() => page.waitForTimeout(3000)).then(() => visibleText(page));

    // Backend: Verlauf nur eigene Läden, Steuerung gesperrt
    const api = await page.evaluate(async (shopId) => {
      const { auth } = await import('/src/app/auth/index.ts');
      const headers = { Authorization: await auth.getAuthHeaderValue() };
      const hist = await fetch('/routes/notification-history', { headers });
      const items = hist.ok ? await hist.json() : [];
      // Nie einen echten Steuerbefehl schicken: 10 s lehnt auch ein ungeschützter Server als ungültig ab (400),
      // ändert also nichts – der geschützte antwortet vorher mit 403
      const stop = await fetch('/routes/set-interval?interval_seconds=10', { method: 'POST', headers });
      const status = await (await fetch('/routes/scheduler-status', { headers })).json();
      const unknown = await fetch('/routes/unknown-notifications', { headers });
      const other = await fetch('/routes/user-notifications?userId=jemand-anderes', { headers });
      return {
        histStatus: hist.status,
        foreign: items.filter((i) => i.shopId !== shopId).length,
        stop: stop.status,
        canControl: status.can_control,
        running: status.is_running,
        unknownCount: unknown.ok ? (await unknown.json()).length : unknown.status,
        otherUser: other.status,
      };
    }, fx.shopId);

    rows.push(
      { name: `${device}: Nummer-Dialog nur Leistung/Person/Name`, pass: !queueDialog.fields.some((f) => /Datum|Uhrzeit|Dauer|Preis|Termintyp/.test(f)), detail: queueDialog.fields.join(', ') },
      { name: `${device}: Nummer-Dialog zeigt nächsten Platz`, pass: /dran|nichts frei/i.test(queueDialog.text), detail: (queueDialog.text.match(/(DRAN|Dran)[\s\S]{0,60}/) || [''])[0].replace(/\s+/g, ' ') },
      ...(device === 'handy' ? [{ name: 'Nummer wird angelegt', pass: queueDialog.created > 0 }] : []),
      { name: `${device}: Dialoge ragen nicht über den Rand`, pass: !queueDialog.overflow.length && !bookedOverflow.length && !shopOverflow.length && !staffOverflow.length, detail: [...queueDialog.overflow, ...bookedOverflow, ...shopOverflow, ...staffOverflow].join(', ') },
      { name: `${device}: Person ohne Telefon speicherbar`, pass: saved && pflicht === 0 },
      { name: `${device}: Leistungsname überlappt Dauer nicht`, pass: !listOverlap },
      { name: `${device}: Mein Tag erklärt sich für Inhaber`, pass: /Du nimmst noch keine Termine an/.test(meinTagText) },
      { name: `${device}: Früher dran ohne Steuerknöpfe`, pass: controls === 0 },
      { name: `${device}: Verlauf nur eigene Läden`, pass: api.histStatus === 200 && api.foreign === 0, detail: `${api.histStatus}, fremd ${api.foreign}` },
      { name: `${device}: Steuerung gesperrt, Dienst läuft`, pass: api.stop === 403 && api.canControl === false && api.running === true, detail: `${api.stop}, läuft ${api.running}` },
      { name: `${device}: Fremde Benachrichtigungen gesperrt`, pass: api.otherUser === 403 && api.unknownCount === 0, detail: `user ${api.otherUser}, unknown ${api.unknownCount}` },
      { name: `${device}: keine englischen Beschriftungen`, pass: english.length === 0, detail: english.join(' | ') },
      { name: `${device}: kein waagrechtes Überlaufen`, pass: overflow.length === 0, detail: overflow.join(', ') },
      { name: `${device}: keine JavaScript-Fehler`, pass: errors.length === 0, detail: errors.join(' | ') },
    );
    await page.context().close();
  }
  await browser.close();
  return report(rows);
});
