// Kundenliste unter „Mein Tag“: Einträge vom Telefon-Assistenten sind gekennzeichnet, ein Tipp auf den Namen zeigt die
// Termine der Person (GET /routes/team/laeden/{id}/kunden/{kunde}/termine, backend/app/libs/telefon_kunden.py).
// Ohne Testkonto und ohne echte Daten: Anmeldung (lib.cjs mockAuth/signInFake) und Backend (page.route) nachgestellt,
// der Dialog direkt im Browser gerendert. Braucht: Entwicklungsserver (npm run dev).
const { BASE, launch, newPage, shot, collectErrors, mockAuth, signInFake, report, run } = require('./lib.cjs');

const zeit = (iso) => ({ __zeit: iso });
const KUNDEN = [
  { id: 'k1', shopId: 'laden-test', name: 'Stefan Tittmann', email: '', phone: '+491512345678', isActive: false, source: 'telefon' },
  { id: 'k2', shopId: 'laden-test', name: 'Kara Krause', email: 'kara@example.com', isActive: true, userId: 'konto' },
];
const TERMINE = [
  { id: 't3', startTime: zeit('2026-12-03T13:30:00.000000Z'), status: 'scheduled', type: 'booked', source: 'telefon', referenceCode: '23', leistung: 'Herrenschnitt', person: 'Kim' },
  { id: 't2', startTime: zeit('2026-10-20T08:00:00.000000Z'), status: 'cancelled', type: 'booked', source: 'telefon', leistung: 'Bart', person: 'Kim' },
  { id: 't1', startTime: zeit('2026-10-02T14:00:00.000000Z'), status: 'completed', type: 'queue', leistung: 'Herrenschnitt', person: 'Robin' },
  { id: 't0', startTime: zeit('2025-11-28T09:00:00.000000Z'), status: 'scheduled', type: 'booked', leistung: 'Herrenschnitt', person: '' },
];

run(async () => {
  const browser = await launch();
  const rows = [];
  const check = (name, pass, detail = '') => rows.push({ name, pass: !!pass, detail });
  const page = await newPage(browser, { viewport: { width: 420, height: 900 } });
  const errors = collectErrors(page);
  await mockAuth(page);

  const abrufe = [];
  const json = (route, status, daten) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(daten) });
  await page.route('**/routes/team/laeden/laden-test/kunden**', (route) => {
    const p = new URL(route.request().url()).pathname;
    abrufe.push(p);
    if (p.endsWith('/kunden')) return json(route, 200, { kunden: KUNDEN });
    if (p.endsWith('/kunden/k1/termine')) return json(route, 200, { termine: TERMINE });
    if (p.endsWith('/kunden/k2/termine')) return json(route, 200, { termine: [] });
    return json(route, 404, { detail: 'Diesen Kunden gibt es nicht mehr.' });
  });
  await signInFake(page);

  // Dialog direkt rendern: React aus denselben Modulen wie die App (Pfade so, wie Vite sie ausliefert)
  await page.evaluate(async () => {
    const main = await (await fetch('/src/main.tsx')).text();
    const React = (await import(main.match(/from "([^"]*\/react\.js[^"]*)"/)[1])).default;
    const { createRoot } = (await import(main.match(/from "([^"]*react-dom_client[^"]*)"/)[1])).default;
    const { CustomerListDialog } = await import('/src/components/CustomerListDialog.tsx');
    const el = document.createElement('div');
    document.body.appendChild(el);
    createRoot(el).render(React.createElement(CustomerListDialog, { shopId: 'laden-test', open: true, onOpenChange: () => {} }));
  });

  const dialog = page.getByRole('dialog', { name: 'Kundenliste' });
  await dialog.getByText('Stefan Tittmann').waitFor({ timeout: 30000 });
  check('Beschreibung nennt den Telefon-Assistenten', await dialog.getByText('auch vom Telefon-Assistenten nach einer Buchung').isVisible());
  check('Eintrag vom Telefon gekennzeichnet', await dialog.getByText('Vom Telefon-Assistenten angelegt').count() === 1);
  check('Noch keine Termine geladen', !abrufe.some((p) => p.endsWith('/termine')), abrufe.join(' '));

  const stefan = dialog.getByRole('button', { name: /Stefan Tittmann/ });
  check('Name ist zugeklappt', (await stefan.getAttribute('aria-expanded')) === 'false');
  await stefan.click();
  await dialog.getByText('2 Besuche').waitFor({ timeout: 10000 });
  check('Aufgeklappt', (await stefan.getAttribute('aria-expanded')) === 'true');
  check('Besuche ohne Abgesagte und Kommende', await dialog.getByText('2 Besuche').isVisible());
  const liste = dialog.locator('li li');
  const texte = await liste.allInnerTexts();
  check('Vier Termine, neueste zuerst', texte.length === 4 && texte[0].includes('3. Dez. 2026') && texte[3].includes('2025'), JSON.stringify(texte));
  check('Leistung und Person', texte[0].includes('Herrenschnitt bei Kim'), texte[0]);
  check('Kommender Termin: Geplant', texte[0].includes('Geplant'), texte[0]);
  check('Abgesagt durchgestrichen', texte[1].includes('Abgesagt') && (await liste.nth(1).locator('.line-through').count()) === 1, texte[1]);
  check('Fertig', texte[2].includes('Fertig'), texte[2]);
  check('Vorbei, nicht abgehakt: ohne Status', !/Geplant|Fertig|Abgesagt|Ist dran/.test(texte[3]) && !texte[3].includes('bei'), texte[3]);
  check('Am Telefon gebucht: Zeichen', (await liste.getByRole('img', { name: 'Am Telefon gebucht' }).count()) === 2);
  await shot(page, 'kundenliste-termine');

  await dialog.getByRole('button', { name: /Kara Krause/ }).click();
  await dialog.getByText('Noch keine Termine.').waitFor({ timeout: 10000 });
  check('Ohne Termine: Hinweis', await dialog.getByText('Noch keine Termine.').isVisible());
  check('Löschen bleibt da', (await dialog.getByRole('button', { name: 'Löschen' }).count()) === 2);
  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));

  await browser.close();
  return report(rows);
});
