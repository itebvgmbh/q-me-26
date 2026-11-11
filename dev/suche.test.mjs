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
import { leistungsgruppen } from '../frontend/src/utils/leistungsgruppen.ts';

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

// 7. Leistungsgruppen (dieselben Fälle prüft backend/tests/test_leistungsgruppen.py)
{
  const DATEN = JSON.parse(fs.readFileSync(new URL('../frontend/src/data/leistungsgruppen.json', import.meta.url), 'utf8'));
  const FAELLE = JSON.parse(fs.readFileSync(new URL('./leistungsgruppen-faelle.json', import.meta.url), 'utf8'));
  const G = leistungsgruppen(DATEN);
  const falsch = FAELLE.faelle.filter((f) => G.auto({ name: f.name, category: f.kategorie }, f.kontext) !== f.gruppe);
  check(`Zuordnung per Stichwort (${FAELLE.faelle.length} Fälle)`, falsch.length === 0, JSON.stringify(falsch.map((f) => [f.name, f.gruppe, G.auto({ name: f.name, category: f.kategorie }, f.kontext)])));
  const regelnGueltig = [...DATEN.name, ...DATEN.kategorie].every((r) => G.gruppe(r.gruppe)) && G.gruppe(DATEN.schnitt.gruppe)
    && DATEN.gruppen.every((g) => (g.auch ?? []).every((a) => G.gruppe(a)))
    && Object.values(DATEN.ohneLeistungen).flat().every((k) => G.gruppe(k));
  check('Regeln nennen nur bekannte Gruppen', !!regelnGueltig);
  check('Stichwörter schon normalisiert', [...DATEN.name, ...DATEN.kategorie, DATEN.schnitt].every((r) => [...r.woerter, ...(r.und ?? []), ...(r.nicht ?? [])].every((w) => normSuche(w.replace(/^_/, '')) === w.replace(/^_/, ''))));
  check('Inhaber legt fest', G.wirksam({ name: 'Herrenhaarschnitt', gruppe: 'bart' }) === 'bart' && G.wirksam({ name: 'Herrenhaarschnitt', gruppe: 'keine' }) === null
    && G.wirksam({ name: 'Herrenhaarschnitt', gruppe: 'quatsch' }) === 'herren' && G.wirksam({ name: 'Herrenhaarschnitt', gruppe: '' }) === 'herren');
  check('Herrenhaarschnitt zählt Haarschnitt mit', G.menge('herren').includes('haarschnitt') && !G.menge('kinder').includes('haarschnitt') && G.menge('haarschnitt').includes('kinder'));
  const tuerkisch = (n) => ({ 'Bart & Rasur': 'Sakal & Tıraş' })[n] ?? n;
  check('Was gemeint ist', G.ausText('Herrenhaarschnitt') === 'herren' && G.ausText('herrenschnitt') === 'herren' && G.ausText("Men's haircut") === 'herren'
    && G.ausText('Sakal & Tıraş', tuerkisch) === 'bart' && G.ausText('Halit') === null && G.ausText('  ') === null && G.ausText('balayage') === 'farbe');

  const mit = (laden) => ({ ...laden, leistungen: laden.leistungen.map((l) => ({ ...l, gruppe: G.wirksam(l, laden.name) })) });
  const barbier = mit({ id: 'b', name: 'KaNa Barbers', lat: 52.587, lng: 13.285, termine: true, businessHoursByDay: offen(),
    leistungen: [L('b1', 'Haare & Bart', 35, { duration: 45 }), L('b2', 'Maschinenschnitt', 15, { duration: 20 }), L('b3', 'Trockenschnitt', 18, { duration: 30 }),
      L('b4', 'Konturen', 5, { duration: 10 }), L('b5', 'Bartrasur', 12, { duration: 20 })] });
  const unisex = mit({ id: 'u', name: 'Haarwerk', lat: 52.52, lng: 13.40, termine: true, businessHoursByDay: offen(),
    leistungen: [L('u1', 'Haarschnitt', 30), L('u2', 'Strähnen / Balayage', 80, { duration: 120 })] });
  const herren = { key: 'herren', menge: G.menge('herren') };
  const damen = { key: 'damen', menge: G.menge('damen') };
  check('Barbier: Trockenschnitt ist Herrenschnitt', barbier.leistungen[2].gruppe === 'herren');
  check('Gruppe findet anders benannte Leistung', ladenPasst(barbier, 'Herrenhaarschnitt', herren) && !ladenPasst(barbier, 'Herrenhaarschnitt'));
  check('Übliche Leistung der Gruppe: mind. 15 Min., die kürzeste', passendeLeistung(barbier, 'Herrenhaarschnitt', herren)?.id === 'b2', passendeLeistung(barbier, 'Herrenhaarschnitt', herren)?.name);
  check('Name mit dem Suchtext zuerst', passendeLeistung(barbier, 'Trockenschnitt', herren)?.id === 'b3');
  check('Damenschnitt findet allgemeinen Haarschnitt', ladenPasst(unisex, 'Damenhaarschnitt', damen) && passendeLeistung(unisex, 'Damenhaarschnitt', damen)?.id === 'u1' && !ladenPasst(barbier, 'Damenhaarschnitt', damen));

  const wahl = { liste: DATEN.gruppen.map((g) => ({ key: g.key, name: g.name })), ausText: (t) => G.ausText(t) };
  const ohne = wasVorschlaege('', [barbier, unisex], 5, wahl);
  check('Oft gesucht: Gruppen, die es gibt, häufige zuerst', ohne.gruppen[0]?.key === 'herren' && !ohne.gruppen.some((g) => g.key === 'massage') && ohne.leistungen.length === 0, JSON.stringify(ohne.gruppen));
  const bala = wasVorschlaege('bala', [barbier, unisex], 5, wahl);
  check('Teil eines Leistungsnamens findet die Gruppe', bala.gruppen.map((g) => g.key).join() === 'farbe' && bala.leistungen.includes('Strähnen / Balayage'), JSON.stringify(bala));
  const hs = wasVorschlaege('herrenschnitt', [barbier, unisex], 5, wahl);
  check('Text, den die Stichwörter einordnen', hs.gruppen[0]?.key === 'herren', JSON.stringify(hs));
  const salonsG = [{ ...salons[0], gruppen: ['haarschnitt', 'farbe', 'styling'] }, { ...salons[0], id: 'e2', name: 'Barber Ali', kategorie: 'barbershop', leistungen: [], gruppen: ['herren', 'bart'] }];
  const e = ergebnis([barbier, unisex], salonsG, { was: 'Bart & Rasur', gruppe: { key: 'bart', menge: G.menge('bart') }, bereich: null, filter: [], sortierung: 'empfohlen' }, {}, MITTWOCH_10);
  check('Gruppe filtert Läden und Salons', e.treffer.map((t) => t.laden.id).join() === 'b' && e.salons.map((x) => x.salon.id).join() === 'e2' && e.treffer[0].leistung?.id === 'b5',
    JSON.stringify([e.treffer.map((t) => t.laden.id), e.salons.map((x) => x.salon.id)]));
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
