// Kundenkartei (frontend/src/utils/kartei-logik.ts) ohne Browser und ohne Backend:
//   node --experimental-strip-types dev/kartei.test.mjs
// Die Kennzahlen selbst prüft das Backend in backend/tests/test_kartei.py.
import assert from 'node:assert/strict';
import {
  inGruppe,
  istLangeNichtDa,
  istNeu,
  langeNichtDaAb,
  passtZurSuche,
  sortiere,
  zaehleGruppen,
  abstandEinheit,
} from '../frontend/src/utils/kartei-logik.ts';

const JETZT = new Date(2026, 10, 12, 12, 0);
const vor = (tage) => new Date(JETZT.getTime() - tage * 86_400_000);
const zahlen = (extra = {}) => ({
  besuche: 0, umsatz: 0, abgesagt: 0, nichtGekommen: 0, zuletzt: null, erster: null, naechster: null,
  abstandTage: null, lieblingsLeistung: '', lieblingsPerson: '', ...extra,
});
const kunde = (id, name, extra = {}, z = {}) => ({ id, name, angelegt: vor(200), kennzahlen: zahlen(z), ...extra });

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log('ok ', name);
};

test('Stammkunde ab drei Besuchen', () => {
  assert.equal(inGruppe(kunde('a', 'A', {}, { besuche: 3 }), 'stamm', JETZT), true);
  assert.equal(inGruppe(kunde('a', 'A', {}, { besuche: 2 }), 'stamm', JETZT), false);
});

test('Neu: höchstens ein Besuch, erster Kontakt in den letzten 60 Tagen', () => {
  assert.equal(istNeu(kunde('a', 'A', { angelegt: vor(5) }), JETZT), true);
  assert.equal(istNeu(kunde('a', 'A', {}, { besuche: 1, erster: vor(30) }), JETZT), true);
  assert.equal(istNeu(kunde('a', 'A', {}, { besuche: 1, erster: vor(90) }), JETZT), false);
  assert.equal(istNeu(kunde('a', 'A', { angelegt: vor(5) }, { besuche: 2, erster: vor(20) }), JETZT), false);
  assert.equal(istNeu({ id: 'x', name: 'X', angelegt: vor(1) }, JETZT), false, 'ohne Kennzahlen (Tarif ohne Kartei) keine Gruppen');
});

test('Lange nicht da: anderthalbmal der übliche Abstand, ohne Abstand 90 Tage, nie mit kommendem Termin', () => {
  assert.equal(langeNichtDaAb(zahlen({ abstandTage: 28 })), 42);
  assert.equal(langeNichtDaAb(zahlen({ abstandTage: 10 })), 24, 'mindestens zwei Wochen mehr als üblich');
  assert.equal(langeNichtDaAb(zahlen()), 90);
  assert.equal(istLangeNichtDa(zahlen({ besuche: 4, abstandTage: 28, zuletzt: vor(43) }), JETZT), true);
  assert.equal(istLangeNichtDa(zahlen({ besuche: 4, abstandTage: 28, zuletzt: vor(40) }), JETZT), false);
  assert.equal(istLangeNichtDa(zahlen({ besuche: 4, abstandTage: 28, zuletzt: vor(60), naechster: new Date(JETZT.getTime() + 86_400_000) }), JETZT), false);
  assert.equal(istLangeNichtDa(zahlen({ besuche: 1, zuletzt: vor(91) }), JETZT), true);
  assert.equal(istLangeNichtDa(zahlen({ besuche: 0 }), JETZT), false);
});

test('Suche über Name ohne Akzente, E-Mail und Telefon in jeder Schreibweise', () => {
  const k = kunde('a', 'Jürgen Müller', { email: 'jm@example.com', phone: '+49 170 1234567' });
  for (const s of ['müller', 'muller', 'MÜLLER jür', 'example', '0170 123', '01701234567', '+491701234567', '1234567', '']) {
    assert.equal(passtZurSuche(k, s), true, s);
  }
  for (const s of ['meier', '0171', '12', 'müller meier']) assert.equal(passtZurSuche(k, s), false, s);
  assert.equal(passtZurSuche(kunde('b', 'Strauß'), 'strauss'), true);
  assert.equal(passtZurSuche(kunde('c', 'Ohne Telefon'), '0170'), false);
});

test('Sortierung: zuletzt da, Umsatz, Besuche, Name; wer nie da war, ans Ende', () => {
  const liste = [
    kunde('nie', 'Anton'),
    kunde('alt', 'Berta', {}, { besuche: 5, umsatz: 300, zuletzt: vor(50) }),
    kunde('neu', 'Cem', {}, { besuche: 1, umsatz: 25, zuletzt: vor(2) }),
    kunde('mitte', 'Dora', {}, { besuche: 2, umsatz: 300, zuletzt: vor(10) }),
  ];
  assert.deepEqual(sortiere(liste, 'zuletzt').map((k) => k.id), ['neu', 'mitte', 'alt', 'nie']);
  assert.deepEqual(sortiere(liste, 'umsatz').map((k) => k.id), ['alt', 'mitte', 'neu', 'nie']);
  assert.deepEqual(sortiere(liste, 'besuche').map((k) => k.id), ['alt', 'mitte', 'neu', 'nie']);
  assert.deepEqual(sortiere(liste, 'name').map((k) => k.id), ['nie', 'alt', 'neu', 'mitte']);
  assert.deepEqual(liste.map((k) => k.id), ['nie', 'alt', 'neu', 'mitte'], 'Liste selbst bleibt, wie sie war');
});

test('Gruppen zählen', () => {
  const liste = [
    kunde('s', 'S', {}, { besuche: 3, zuletzt: vor(10), abstandTage: 30 }),
    kunde('l', 'L', {}, { besuche: 3, zuletzt: vor(100), abstandTage: 30 }),
    kunde('n', 'N', { angelegt: vor(3) }),
  ];
  assert.deepEqual(zaehleGruppen(liste, JETZT), { alle: 3, stamm: 2, neu: 1, lange: 1 });
});

test('Abstand in Wochen ab 14 Tagen', () => {
  assert.deepEqual(abstandEinheit(10), { wert: 10, einheit: 'tage' });
  assert.deepEqual(abstandEinheit(31), { wert: 4, einheit: 'wochen' });
});

console.log(`${n} Tests bestanden`);
