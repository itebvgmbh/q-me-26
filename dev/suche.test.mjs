// Läden finden (frontend/src/utils/suche.ts) ohne Browser und ohne Netz:
//   node --experimental-strip-types dev/suche.test.mjs
// Dieselbe Wortsuche prüft das Backend in backend/tests/test_suche.py (norm, passt).
import fs from 'node:fs';
import {
  ergebnis,
  ladenPasst,
  normSuche,
  offenJetzt,
  ortAusListe,
  ortVorschlaege,
  passendeLeistung,
  passt,
  RADIUS_KM,
  wasVorschlaege,
  zeitenFuer,
  zustandAus,
  zustandParams,
} from '../frontend/src/utils/suche.ts';

const rows = [];
const check = (name, pass, detail = '') => rows.push({ name, pass, detail });

const ORTE = JSON.parse(fs.readFileSync(new URL('../frontend/src/data/orte-berlin.json', import.meta.url), 'utf8'));
const offen = (von = '09:00', bis = '18:00') => Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, isOpen: true, openTime: von, closeTime: bis }));
const L = (id, name, preis, extra = {}) => ({ id, name, price: preis, duration: 30, ...extra });
const MITTWOCH_10 = new Date(2026, 10, 11, 10, 0); // Mittwoch, 10:00

const laeden = [
  { id: 'halit', name: "Halit's Barber Shop", lat: 52.5871, lng: 13.2849, ortsteil: 'Tegel', termine: true, businessHoursByDay: offen(),
    leistungen: [L('h1', 'Herrenhaarschnitt', 22), L('h2', 'Bartform', 12), L('h3', 'Augenbrauen zupfen', 8)] },
  { id: 'test', name: 'Testbarb', lat: 52.6262, lng: 13.2353, ortsteil: 'Heiligensee', termine: false, businessHoursByDay: offen('12:00', '20:00'),
    leistungen: [L('t1', 'Haare & Bart', 30), L('t2', 'Herrenhaarschnitt', 18)] },
  { id: 'mitte', name: 'Salon Mitte', lat: 52.5200, lng: 13.4050, termine: true, businessHoursByDay: offen(),
    leistungen: [L('m1', 'Damenhaarschnitt', 45), L('m2', 'Färben', 60, { category: 'Farbe' })] },
  { id: 'ohne', name: 'Ohne Lage', leistungen: [L('o1', 'Herrenhaarschnitt', 20)] },
];
const salons = [
  { id: 'e1', name: 'Salon Venezia', kategorie: 'friseur', street: '', postalCode: '', city: 'Berlin', ortsteil: 'Tegel', bezirk: 'Reinickendorf',
    pfad: '/friseur/berlin/salon-venezia', lat: 52.585, lng: 13.29, leistungen: ['Damenschnitt'] },
];

// 1. Wörter vergleichen
{
  check('Umlaute und Satzzeichen', normSuche('Färben & Strähnen!') === 'faerben straehnen');
  check('Teilwort findet Leistung', passt('Herrenhaarschnitt', 'schnitt'));
  check('Alle Wörter müssen passen', passt('Haare & Bart', 'bart haare') && !passt('Herrenschnitt', 'bart'));
  check('Leere Suche passt auf jeden Laden', ladenPasst(laeden[0], '  '));
  check('Ladenname oder Leistung', ladenPasst(laeden[0], 'halit') && ladenPasst(laeden[2], 'farbe') && !ladenPasst(laeden[2], 'bart'));
  check('Gesuchte Leistung mit Preis', passendeLeistung(laeden[1], 'herrenhaar')?.price === 18);
}

// 2. Vorschläge
{
  const v = ortVorschlaege('pank', ORTE);
  check('Pankow als Bezirk, nicht doppelt', v.filter((o) => o.name === 'Pankow').length === 1 && v.find((o) => o.name === 'Pankow')?.typ === 'bezirk', JSON.stringify(v));
  check('Wortanfang mitten im Namen', ortVorschlaege('berg', ORTE).some((o) => o.name === 'Prenzlauer Berg'));
  check('Ortsliste vollständig', ORTE.length >= 100 && ORTE.filter((o) => o.typ === 'bezirk').length === 12);
  check('Mittelpunkte in Berlin', ORTE.every((o) => o.lat > 52.33 && o.lat < 52.68 && o.lng > 13.08 && o.lng < 13.77));
  check('Ort aus der Adresse', ortAusListe('tegel', ORTE)?.typ === 'ortsteil' && ortAusListe('Mitte', ORTE)?.typ === 'bezirk');
  const w = wasVorschlaege('', laeden);
  check('Häufigste Leistung zuerst', w.leistungen[0] === 'Herrenhaarschnitt', JSON.stringify(w));
  const w2 = wasVorschlaege('bar', laeden);
  check('Leistungen und Läden zur Eingabe', w2.leistungen.includes('Bartform') && w2.laeden.some((l) => l.id === 'halit') && w2.laeden.some((l) => l.id === 'test'));
}

// 3. Öffnungszeiten
{
  check('Offen um 10 Uhr', offenJetzt(laeden[0], MITTWOCH_10) === true);
  check('Öffnet erst um 12', offenJetzt(laeden[1], MITTWOCH_10) === false);
  check('Ohne Öffnungszeiten: unbekannt', offenJetzt(laeden[3], MITTWOCH_10) === null);
}

// 4. Ergebnis im Umkreis
{
  const tegel = ortAusListe('Tegel', ORTE);
  const bereich = { mitte: tegel, radiusKm: RADIUS_KM.ortsteil };
  const e = ergebnis(laeden, salons, { was: '', bereich, filter: [], sortierung: 'empfohlen' }, {}, MITTWOCH_10);
  check('Halit in Tegel', e.treffer.map((t) => t.laden.id).join() === 'halit', JSON.stringify(e.treffer.map((t) => [t.laden.id, t.km])));
  check('Zu wenige: Testbarb etwas weiter weg', e.weiter.some((t) => t.laden.id === 'test'), JSON.stringify(e.weiter.map((t) => t.laden.id)));
  check('Salon ohne Dranzeit in der Nähe', e.salons.map((s) => s.salon.id).join() === 'e1');
  check('Entfernung gerechnet', e.treffer[0].km !== null && e.treffer[0].km < 2);

  const herren = ergebnis(laeden, salons, { was: 'herrenhaarschnitt', bereich: null, filter: [], sortierung: 'preis' }, {}, MITTWOCH_10);
  check('Ohne Ort: alle passenden, günstigster zuerst', herren.treffer.map((t) => t.laden.id).join() === 'test,ohne,halit', herren.treffer.map((t) => t.laden.id).join());
  check('Salon ohne passende Leistung fehlt', herren.salons.length === 0);

  const kasten = { grenzen: { sued: 52.5, west: 13.3, nord: 52.55, ost: 13.5 } };
  const imAusschnitt = ergebnis(laeden, salons, { was: '', bereich: kasten, filter: [], sortierung: 'entfernung' }, {}, MITTWOCH_10);
  check('Kartenausschnitt', imAusschnitt.treffer.map((t) => t.laden.id).join() === 'mitte');

  // Bezirk nach Adresse: Prenzlauer Berg gehört zu Pankow, liegt aber weiter als der Umkreis von der Bezirksmitte
  const pankow = ortAusListe('Pankow', ORTE);
  const kollwitz = { id: 'kollwitz', name: 'Barber Kollwitz', lat: 52.5367, lng: 13.4187, bezirk: 'Pankow', ortsteil: 'Prenzlauer Berg', leistungen: [] };
  const imBezirk = ergebnis([...laeden, kollwitz], [], { was: '', bereich: { mitte: pankow, radiusKm: RADIUS_KM.bezirk, ort: pankow }, filter: [], sortierung: 'empfohlen' }, {}, MITTWOCH_10);
  check('Laden im Bezirk laut Adresse', imBezirk.treffer.some((t) => t.laden.id === 'kollwitz'), JSON.stringify(imBezirk.treffer.map((t) => [t.laden.id, t.km])));
}

// 5. Filter und Sortierung mit freien Zeiten
{
  const heute = (h) => new Date(2026, 10, 11, h, 30).toISOString();
  const morgen = new Date(2026, 10, 12, 9, 0).toISOString();
  const frei = {
    halit: { warten: 4, leistung: null, nummer: heute(11), termine: [{ start: morgen, personId: 'p' }] },
    test: { warten: 0, leistung: null, nummer: null, termine: [] },
    mitte: { warten: 1, leistung: null, nummer: heute(10), termine: [{ start: heute(15), personId: 'p' }] },
  };
  const anfrage = (filter, sortierung = 'empfohlen') => ({ was: '', bereich: null, filter, sortierung });
  const ids = (e) => e.treffer.map((t) => t.laden.id).join();
  check('Jetzt geöffnet', ids(ergebnis(laeden, salons, anfrage(['offen']), frei, MITTWOCH_10)) === 'halit,mitte');
  check('Heute Termin frei', ids(ergebnis(laeden, salons, anfrage(['heute']), frei, MITTWOCH_10)) === 'mitte');
  check('Kaum Wartezeit (offen und höchstens 2)', ids(ergebnis(laeden, salons, anfrage(['kurz']), frei, MITTWOCH_10)) === 'mitte');
  check('Online-Termine', ids(ergebnis(laeden, salons, anfrage(['termine'], 'warten'), frei, MITTWOCH_10)) === 'mitte,halit');
  check('Mit Filter keine Salons ohne Dranzeit', ergebnis(laeden, salons, anfrage(['offen']), frei, MITTWOCH_10).salons.length === 0);
  const ohneZeiten = ergebnis(laeden, salons, anfrage(['heute']), {}, MITTWOCH_10);
  check('Filter wartet auf freie Zeiten', ohneZeiten.wartetAufZeiten === true && ohneZeiten.treffer.length === 0);
  check('Zeiten zuerst für die nächsten', zeitenFuer(laeden, { was: '', bereich: { mitte: { lat: 52.59, lng: 13.28 }, radiusKm: 2 }, filter: [], sortierung: 'empfohlen' }).join() === 'halit,test,mitte', 'nach Entfernung, ohne Lage nicht');
}

// 6. Adresse der Seite
{
  const z = zustandAus(new URLSearchParams('was=Bart&wo=Tegel&filter=offen,quatsch,heute&sort=preis&shopId=x'));
  check('Lesen', z.was === 'Bart' && z.wo === 'Tegel' && z.filter.join() === 'offen,heute' && z.sortierung === 'preis');
  const p = zustandParams({ ...z, sortierung: 'empfohlen', filter: [] }, new URLSearchParams('shopId=x&was=alt'));
  check('Schreiben ohne Standardwerte, andere bleiben', p.toString() === 'shopId=x&was=Bart&wo=Tegel', p.toString());
  check('Unbekannte Sortierung', zustandAus(new URLSearchParams('sort=xyz')).sortierung === 'empfohlen');
}

let failed = 0;
for (const r of rows) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'OK  ' : 'FEHL'} ${r.name}${r.detail && !r.pass ? ` (${r.detail})` : ''}`);
}
console.log(`${rows.length - failed}/${rows.length} bestanden`);
process.exit(failed ? 1 : 0);
