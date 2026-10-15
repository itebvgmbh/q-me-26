// Gemeinsame Einstellungen der Testskripte (siehe dev/README.md)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Adresse der App: Entwicklungsserver (npm run dev) oder Vorschau des Builds (npm run preview → :4173)
const BASE = (process.env.QME_URL || 'http://localhost:5173').replace(/\/$/, '');
// Laden für die Durchläufe: ITEBV GmbH (Testbetrieb)
const SHOP_ID = process.env.QME_SHOP_ID || 'zNS505OFvKZpFaR1vTdN';
const OUT = path.join(__dirname, '..', 'out');
const FIXTURE = path.join(__dirname, '..', '.local', 'fixture.json');

/** Browser starten; QME_BROWSER_ARGS z. B. für Proxys in Cloud-Umgebungen */
const launch = () => chromium.launch({ args: (process.env.QME_BROWSER_ARGS || '').split(' ').filter(Boolean) });

/** Neue Seite in deutscher Zeit; Handygröße, wenn nichts anderes angegeben */
const newPage = async (browser, options = {}) =>
  (await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Berlin', locale: 'de-DE', ...options })).newPage();

/** "2026-10-19T11:50" als deutsche Ortszeit (Sommer-/Winterzeit richtig), egal in welcher Zeitzone dieser Rechner läuft */
const berlin = (local) => {
  const guess = new Date(`${local}Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value; // z. B. "GMT+2"
  const [, sign, hours, minutes] = name.match(/GMT([+-])(\d+)(?::(\d+))?/) || [null, '+', '0', '0'];
  const offset = (Number(hours) * 60 + Number(minutes || 0)) * (sign === '-' ? -1 : 1);
  return new Date(guess.getTime() - offset * 60000);
};

/** Bildschirmfoto nach dev/out/<name>.png */
const shot = (page, name, fullPage = true) => {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
};

/** JavaScript-Fehler der Seite sammeln */
const collectErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  return errors;
};

/** Testdaten aus dev/fixtures.py (Laden, Person, Pausen, Termin) */
const fixture = () => {
  if (!fs.existsSync(FIXTURE)) {
    console.error('Keine Testdaten. Erst anlegen:  python dev/fixtures.py anlegen');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
};

/** Ergebnisliste ausgeben; Rückgabe true, wenn alles passt */
const report = (rows) => {
  let ok = true;
  for (const { name, pass, detail } of rows) {
    ok = ok && pass;
    console.log(`${pass ? 'OK  ' : 'FEHL'} ${name.padEnd(40)} ${detail ?? ''}`);
  }
  console.log(ok ? 'Alles bestanden.' : 'Es gibt Fehler.');
  return ok;
};

/** Skript ausführen; Exit-Code 1 bei Fehler oder false */
const run = (fn) =>
  fn()
    .then((ok) => process.exit(ok === false ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });

module.exports = { BASE, SHOP_ID, OUT, berlin, launch, newPage, shot, collectErrors, fixture, report, run };
