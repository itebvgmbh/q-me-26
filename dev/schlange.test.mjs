// Regel der Schlange (frontend/src/utils/queue-lane.ts) ohne Browser und ohne Datenbank:
//   node --experimental-strip-types dev/schlange.test.mjs
// Dieselben Fälle prüft das Backend in backend/tests/test_queue_notify.py (project_lane).
import {
  aheadOf,
  delayMinutes,
  expectedStart,
  isDue,
  occupiedWindow,
  projectLane,
  waitingInOrder,
} from '../frontend/src/utils/queue-lane.ts';

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, 26, h, m).getTime();
};
const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const item = (id, start, minutes, status = 'scheduled', extra = {}) => ({
  id,
  status,
  startTime: new Date(at(start)),
  endTime: new Date(at(start) + minutes * 60000),
  ...extra,
});

const rows = [];
const check = (name, pass, detail = '') => rows.push({ name, pass, detail });

// 1. Überfällige bleiben in der Schlange
{
  const lane = [item('alt', '10:00', 30), item('b', '10:30', 30), item('fertig', '09:30', 30, 'completed'), item('weg', '09:00', 30, 'cancelled')];
  check('Überfälliger wartet weiter', waitingInOrder(lane).map((a) => a.id).join(',') === 'alt,b');
  check('Vor dir zählt den Überfälligen mit', aheadOf(lane[1], lane) === 1);
}

// 2. Verzug: Anna seit 10:10 dran (30 Min.), jetzt 10:45 – sie braucht länger
{
  const now = at('10:45');
  const lane = [
    item('dran', '10:00', 30, 'in-progress', { calledAt: new Date(at('10:10')) }),
    item('b', '10:30', 30),
    item('c', '11:00', 30),
    item('termin', '13:00', 30),
  ];
  const p = projectLane(lane, now);
  check('Wer dran ist, frühestens jetzt fertig', hm(p.get('dran').end) === '10:45', hm(p.get('dran').end));
  check('b rückt nach', hm(p.get('b').start) === '10:45', hm(p.get('b').start));
  check('c wandert mit', hm(p.get('c').start) === '11:15', hm(p.get('c').start));
  check('Termin am Nachmittag bleibt', hm(p.get('termin').start) === '13:00');
  check('Verzug von c', delayMinutes(lane[2], p) === 15, String(delayMinutes(lane[2], p)));
  check('ca.-Zeit von c', hm(expectedStart(lane[2], p).getTime()) === '11:15');
}

// 3. Nie früher als angekündigt, kleine Verzüge nicht anzeigen
{
  const lane = [item('fertig', '10:00', 30, 'completed', { completedAt: new Date(at('10:10')) }), item('b', '10:30', 30)];
  const p = projectLane(lane, at('10:12'));
  check('Früher fertig zieht niemanden vor', hm(p.get('b').start) === '10:30');
  const late = projectLane(lane, at('10:33'));
  check('3 Minuten Verzug: geplante Zeit', hm(expectedStart(lane[1], late).getTime()) === '10:30');
  const later = projectLane(lane, at('10:41'));
  check('11 Minuten Verzug: auf 5 Minuten aufgerundet', hm(expectedStart(lane[1], later).getTime()) === '10:45');
}

// 4. Ohne Aufrufe (Laden hakt nichts ab) keine Prognose
{
  const lane = [item('a', '09:00', 30), item('b', '09:30', 30), item('c', '15:00', 30)];
  const p = projectLane(lane, at('12:00'));
  check('Ohne Aufrufe geplante Zeiten', hm(p.get('c').start) === '15:00' && hm(p.get('a').start) === '09:00');
}

// 5. Belegte Zeit für die Platzsuche
{
  check('Wartend: geplant', JSON.stringify(occupiedWindow(item('a', '11:00', 30))) === JSON.stringify({ start: at('11:00'), end: at('11:30') }));
  const early = occupiedWindow(item('a', '11:00', 30, 'completed', { calledAt: new Date(at('10:20')), completedAt: new Date(at('10:45')) }));
  check('Früher aufgerufen und fertig: 11:00 frei', early.start === at('10:20') && early.end === at('10:45'));
  const done = occupiedWindow(item('a', '11:00', 30, 'completed', { calledAt: new Date(at('11:00')), completedAt: new Date(at('11:15')) }));
  check('Früher fertig: Rest frei', done.end === at('11:15'));
  const running = occupiedWindow(item('a', '11:00', 30, 'in-progress', { calledAt: new Date(at('09:00')), lastCalledAt: new Date(at('10:20')) }));
  check('Dran ab letztem Aufruf', running.start === at('10:20') && running.end === at('10:50'));
  check('Abgesagt belegt nichts', occupiedWindow(item('a', '11:00', 30, 'cancelled')) === null);
  check('Altbestand fertig ohne Zeitpunkt: wie geplant', occupiedWindow(item('a', '11:00', 30, 'completed')).end === at('11:30'));
}

// 6. Fällig zum Aufrufen
{
  check('In 15 Minuten fällig', isDue(item('a', '11:00', 30), at('10:45')));
  check('Termin in 3 Stunden nicht fällig', !isDue(item('a', '14:00', 30), at('11:00')));
  check('Überfällig ist fällig', isDue(item('a', '09:00', 30), at('11:00')));
}

let failed = 0;
for (const r of rows) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'OK  ' : 'FEHL'} ${r.name}${r.detail && !r.pass ? ` (${r.detail})` : ''}`);
}
console.log(`${rows.length - failed}/${rows.length} bestanden`);
process.exit(failed ? 1 : 0);
