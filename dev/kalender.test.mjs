// Rechnungen des Kalenders am Tresen (frontend/src/utils/calendar-layout.ts) ohne Browser und ohne Datenbank:
//   node --experimental-strip-types dev/kalender.test.mjs
import { atMinute, minuteAt, minuteOfDay, movedStart, sideBySide, visibleHours, weekDays } from '../frontend/src/utils/calendar-layout.ts';

const rows = [];
const check = (name, pass, detail = '') => rows.push({ name, pass, detail });
const m = (hhmm) => {
  const [h, min] = hhmm.split(':').map(Number);
  return h * 60 + min;
};

// 1. Sichtbare Stunden
{
  check('Ohne alles 9–18 Uhr', JSON.stringify(visibleHours([])) === '{"first":9,"last":18}');
  const r = visibleHours([{ start: m('09:30'), end: m('18:00') }, { start: m('08:45'), end: m('09:15') }, { start: m('19:00'), end: m('19:20') }]);
  check('Früher Termin und später Termin erweitern', r.first === 8 && r.last === 20, JSON.stringify(r));
  check('Leere Fenster zählen nicht', JSON.stringify(visibleHours([{ start: 600, end: 600 }])) === '{"first":9,"last":18}');
}

// 2. Nebeneinander
{
  const lay = sideBySide([
    { id: 'a', start: m('09:00'), end: m('09:30') },
    { id: 'b', start: m('09:15'), end: m('09:45') },
    { id: 'c', start: m('09:30'), end: m('10:00') },
    { id: 'd', start: m('10:00'), end: m('10:30') },
  ]);
  const s = (id) => `${lay.get(id).lane}/${lay.get(id).lanes}`;
  check('Überschneidung: zwei Spuren', s('a') === '0/2' && s('b') === '1/2', `${s('a')} ${s('b')}`);
  check('Frei gewordene Spur wird wiederverwendet', s('c') === '0/2', s('c'));
  check('Anschließender Termin hat die ganze Breite', s('d') === '0/1', s('d'));
  check('Ohne Termine leer', sideBySide([]).size === 0);
}

// 3. Ziehen
{
  check('Auf 5 Minuten gerundet', movedStart(m('09:00'), 30, 22) === m('09:20'));
  check('Nicht vor Mitternacht', movedStart(m('00:10'), 30, -60) === 0);
  check('Endet spätestens um Mitternacht', movedStart(m('23:00'), 30, 120) === m('23:30'));
}

// 4. Klicken: 1,5 Pixel je Minute, Raster ab 9 Uhr
{
  check('Klick auf 10:20 gibt 10:15', minuteAt(80 * 1.5, 9, 1.5) === m('10:15'));
  check('Klick ganz oben gibt Rasterbeginn', minuteAt(-3, 9, 1.5) === m('09:00'));
}

// 5. Tage
{
  const days = weekDays(new Date(2026, 9, 27, 15, 0)); // Dienstag
  check('Woche beginnt Montag', days[0].getDay() === 1 && days[0].getDate() === 26 && days.length === 7);
  check('Woche endet Sonntag', days[6].getDay() === 0 && days[6].getDate() === 1 && days[6].getMonth() === 10);
  const sonntag = weekDays(new Date(2026, 10, 1));
  check('Sonntag gehört zur Woche davor', sonntag[0].getDate() === 26);
  check('atMinute und minuteOfDay passen zusammen', minuteOfDay(atMinute(new Date(2026, 9, 27), m('14:35'))) === m('14:35'));
}

let failed = 0;
for (const r of rows) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FEHL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
console.log(`\n${rows.length - failed}/${rows.length} bestanden`);
process.exit(failed ? 1 : 0);
