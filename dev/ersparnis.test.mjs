// Rechnung des Ersparnis-Rechners (frontend/src/utils/ersparnis.ts, Seite /rechner) ohne Browser:
//   node --experimental-strip-types dev/ersparnis.test.mjs
import assert from 'node:assert/strict';
import { STANDARD, WOCHEN_JE_MONAT, rechne, tarifFuer, telefonKosten } from '../frontend/src/utils/ersparnis.ts';

// Wie utils/plans.ts und utils/telefon-assistent.ts (dort ändern, hier nachziehen)
const TARIFE = [
  { id: 'gratis', monthly: 0, maxStaff: 1 },
  { id: 'solo', monthly: 19, maxStaff: 1 },
  { id: 'laden', monthly: 39, maxStaff: 4 },
  { id: 'team', monthly: 59, maxStaff: 10 },
];
const TELEFON = { grundpreis: 29, inklusiv: 100, minute: 0.2 };

const nah = (ist, soll, text) => assert.ok(Math.abs(ist - soll) < 0.01, `${text}: ${ist} statt ${soll}`);
let faelle = 0;
const fall = (name, fn) => {
  fn();
  faelle++;
  console.log('ok', name);
};

fall('Tarif nach Leuten am Stuhl, nie Gratis', () => {
  assert.equal(tarifFuer(1, TARIFE).id, 'solo');
  assert.equal(tarifFuer(2, TARIFE).id, 'laden');
  assert.equal(tarifFuer(4, TARIFE).id, 'laden');
  assert.equal(tarifFuer(5, TARIFE).id, 'team');
  assert.equal(tarifFuer(10, TARIFE).id, 'team');
  assert.equal(tarifFuer(14, TARIFE).id, 'team');
  assert.equal(tarifFuer(0, TARIFE).id, 'solo');
});

fall('Telefon: 100 Minuten inklusive, danach 0,20 € je Minute', () => {
  nah(telefonKosten(0, TELEFON), 29, '0 Minuten');
  nah(telefonKosten(100, TELEFON), 29, '100 Minuten');
  nah(telefonKosten(325, TELEFON), 74, '325 Minuten');
});

fall('Beispiel mit den Standardwerten', () => {
  const r = rechne(STANDARD, TARIFE, TELEFON);
  nah(r.tageJeMonat, 5 * 52 / 12, 'Arbeitstage');
  // 10 Anrufe × 3 Minuten × 21,67 Tage = 650 Minuten vom Telefon zurück, die Hälfte wird Kundenzeit: 325 / 30 Minuten
  nah(r.telefon.stunden, 650 / 60, 'Stunden');
  nah(r.telefon.kundenAusZeit, 325 / 30, 'Kunden aus Zeit');
  nah(r.telefon.umsatzAusZeit, (325 / 30) * 25, 'Umsatz aus Zeit');
  nah(r.telefon.kundenAusVerpassten, 2 * WOCHEN_JE_MONAT, 'verpasste Anrufe');
  nah(r.telefon.minuten, 325, 'Gesprächsminuten');
  nah(r.telefon.kosten, 74, 'Telefon-Kosten');
  nah(r.nachruecken.kunden, 4 * WOCHEN_JE_MONAT * 0.5, 'nachbesetzt');
  assert.equal(r.tarif.id, 'laden');
  nah(r.kosten, 39 + 74, 'Kosten');
  nah(r.mehrUmsatz, r.telefon.umsatzAusZeit + r.telefon.umsatzAusVerpassten + r.nachruecken.umsatz, 'Summe');
  nah(r.plusMonat, r.mehrUmsatz - 113, 'Plus');
  nah(r.plusJahr, r.plusMonat * 12, 'Jahr');
  assert.equal(r.kundenFuerKosten, 5); // 113 € / 25 € = 4,52
});

fall('Bausteine abgeschaltet: nur das Abo, kein Gewinn', () => {
  const r = rechne({ ...STANDARD, telefon: false, nachruecken: false, personen: 1 }, TARIFE, TELEFON);
  assert.equal(r.telefon, null);
  assert.equal(r.nachruecken, null);
  assert.equal(r.mehrKunden, 0);
  nah(r.kosten, 19, 'Solo');
  nah(r.plusMonat, -19, 'Minus');
});

fall('Unsinnige Eingaben ergeben keine negativen Kunden und kein NaN', () => {
  const r = rechne(
    { ...STANDARD, anrufeJeTag: -5, minutenJeKunde: 0, anteilKundenzeit: 3, lueckenJeWoche: Number.NaN, umsatzJeKunde: -1 },
    TARIFE,
    TELEFON,
  );
  for (const wert of [r.mehrKunden, r.mehrUmsatz, r.kosten, r.plusMonat, r.kundenFuerKosten]) assert.ok(Number.isFinite(wert));
  assert.equal(r.telefon.kundenAusZeit, 0);
  assert.equal(r.nachruecken.kunden, 0);
  assert.equal(r.mehrUmsatz, 0);
  assert.equal(r.kundenFuerKosten, 0);
});

console.log(`${faelle} Fälle bestanden`);
