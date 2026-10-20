// Lasttest gegen die Live-Seite – eigener Laden "Lasttest (wird gleich gelöscht)", nicht der Testladen
// aus fixtures.py, damit parallel laufende Tests sich nicht stören.
//
//   node dev/e2e/lasttest.cjs anlegen [Verlauf]   Konten, Laden, 4 Personen, morgen ausgebucht, Verlauf (Standard 200)
//   node dev/e2e/lasttest.cjs lauf [Szenario …]    alle Szenarien oder nur die genannten
//   node dev/e2e/lasttest.cjs loeschen             alles wieder weg (auch Konten)
//   node dev/e2e/lasttest.cjs alles [Verlauf]      anlegen, lauf, loeschen
//
// Szenarien:
//   abfragen   freie Zeiten: viele Anfragen gleichzeitig, mit und ohne Zwischenspeicher, Verlauf kostet
//   ansturm    QME_ANSTURM Leute (Standard 10) ziehen im selben Moment eine Nummer bei derselben Person
//   kaskade    "Früher dran": 4 Absagen, Kunden nehmen jedes Angebot sofort an, bis nichts mehr nachrückt;
//              dabei: fremdes Angebot annehmen, dasselbe Angebot zweimal gleichzeitig
//   wettlauf   Annahme und Buchung am Tresen für denselben Platz gleichzeitig (6 Runden, QME_WETTLAUF)
//   absage     Termin abgesagt, Angebot dazu wird trotzdem angenommen
//   flut       viele "Platz frei"-Meldungen auf einmal
//   ruhe       nur der Puls, ohne Last (nur wenn genannt; QME_RUHE Sekunden, Standard 330)
// Während jedes Szenarios fragt ein Puls alle 250 ms /routes/push/config ab: Hängt der Server, sieht man es dort.
//
// Aufbau (deutsche Zeit, "morgen" = Tag nach dem Anlegen):
//   Laden täglich 07–22 Uhr. Alex, Bea, Cem arbeiten nur am Wochentag von morgen, 08–16 Uhr, alle ausgebucht
//   (Alex und Bea 30-Minuten-Termine, Cem gemischt 30/15). 3 von 4 Terminen wollen "früher dran" und gehören
//   einem von 6 Kundenkonten. Dora arbeitet täglich 07–22 Uhr (für den Ansturm heute).
//   Alex hat zusätzlich einen Verlauf alter Termine – jede Platzberechnung liest den mit.
//
// Lese-Budget: ein Lauf mit Verlauf 200 kostet grob 15 000 Firestore-Lesevorgänge (Gratis-Kontingent: 50 000/Tag).
// Ergebnisse: Konsole und dev/out/lasttest-<Zeit>.json. Zugangsdaten: dev/.local/lasttest.json (nicht im Git).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { berlin, launch, newPage, report, run, OUT } = require('./lib.cjs');

const KEY = 'AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE'; // öffentlicher Web-Schlüssel, steht auch in der App
const PROJECT = 'qmedata-7c79e';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
const STATE = path.join(__dirname, '..', '.local', 'lasttest.json');
const SHOP_NAME = 'Lasttest (wird gleich gelöscht)';
const CUSTOMERS = 6;

// Live-Adresse: QME_URL, sonst dranzeit.de, solange das noch nicht auflöst die alte Adresse
let LIVE = (process.env.QME_URL || '').replace(/\/$/, '');
const pickLive = async () => {
  if (LIVE) return LIVE;
  for (const url of ['https://dranzeit.de', 'https://q-me.spielmacherei.de']) {
    try {
      const r = await fetch(`${url}/routes/push/config`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return (LIVE = url);
    } catch { /* nächste Adresse */ }
  }
  throw new Error('Live-Seite nicht erreichbar (dranzeit.de, q-me.spielmacherei.de)');
};

// ---------------------------------------------------------------------------------------------
// Hilfen: Zeit, HTTP, Firestore
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sonntag wie in der App
const at = (day, minutes) => berlin(`${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
const hhmm = (d) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(d);
const minutesOf = (d) => { const [h, m] = hhmm(d).split(':').map(Number); return h * 60 + m; };
const newId = () => Array.from(crypto.randomBytes(20), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
// Angebote speichern Ortszeit ohne Zeitzone ("2026-10-21T08:00:00")
const localIso = (s) => (s instanceof Date ? s : /[zZ]|[+-]\d\d:\d\d$/.test(s) ? new Date(s) : berlin(s.slice(0, 16)));

const stats = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(v[v.length - 1]) };
};
const fmt = (s) => (s.n ? `n=${s.n} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms` : 'keine Werte');

let referer = 'https://dranzeit.de/';
let readCount = 0; // Lesevorgänge dieses Skripts (Dokumente aus Abfragen, mindestens 1 je Abfrage)

const http = async (method, url, { body, token, timeout = 90000 } = {}) => {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { Referer: referer, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    return { status: res.status, ok: res.ok, data, ms: performance.now() - t0 };
  } catch (e) {
    return { status: 0, ok: false, data: String(e), ms: performance.now() - t0 };
  }
};
const must = async (promise, what) => {
  const r = await promise;
  if (!r.ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  return { stringValue: String(v) };
};
const encFields = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)]));
const dec = (v) => {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return undefined;
};
const decFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const docOf = (d) => ({ id: d.name.split('/').pop(), ...decFields(d.fields) });

/** Schreibvorgänge in Paketen zu 400 (Firestore erlaubt 500 je commit) */
const commit = async (writes, token) => {
  for (let i = 0; i < writes.length; i += 400) {
    await must(http('POST', `${FS}:commit`, { body: { writes: writes.slice(i, i + 400) }, token }), 'commit');
  }
};
const setW = (collection, id, fields) => ({ update: { name: `${DOCS}/${collection}/${id}`, fields: encFields(fields) } });
const delW = (name) => ({ delete: name.startsWith('projects/') ? name : `${DOCS}/${name}` });
const patch = (collection, id, fields, token) =>
  http('PATCH', `${FS}/${collection}/${id}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, { body: { fields: encFields(fields) }, token });

/** Abfrage mit UND-verknüpften Bedingungen: [[Feld, Operator, Wert], …] */
const query = async (collection, filters, token, limit = 1000) => {
  const ops = { '==': 'EQUAL', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN', '>': 'GREATER_THAN', '<=': 'LESS_THAN_OR_EQUAL' };
  const where = filters.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: ops[op], value: enc(value) } }));
  const structuredQuery = { from: [{ collectionId: collection }], limit, where: where.length === 1 ? where[0] : { compositeFilter: { op: 'AND', filters: where } } };
  const r = await http('POST', `${FS}:runQuery`, { body: { structuredQuery }, token });
  if (!r.ok) throw new Error(`Abfrage ${collection}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  const docs = r.data.filter((row) => row.document).map((row) => docOf(row.document));
  readCount += Math.max(1, docs.length);
  return docs;
};

const signUp = (email, password) => must(http('POST', `${AUTH}:signUp?key=${KEY}`, { body: { email, password, returnSecureToken: true } }), `Konto ${email}`);
const signIn = (email, password) => must(http('POST', `${AUTH}:signInWithPassword?key=${KEY}`, { body: { email, password, returnSecureToken: true } }), `Anmelden ${email}`);

// Backend der Live-Seite
const api = {
  slots: (body) => http('POST', `${LIVE}/routes/available-timeslots`, { body }),
  slotFreed: (shopId, staffId, token) => http('POST', `${LIVE}/routes/slot-freed`, { body: { shop_id: shopId, staff_id: staffId }, token }),
  accept: (id, token) => http('POST', `${LIVE}/routes/accept-earlier-slot/${id}`, { body: {}, token }),
  ping: () => http('GET', `${LIVE}/routes/push/config`, { timeout: 30000 }),
};

// ---------------------------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------------------------

const loadState = () => {
  if (!fs.existsSync(STATE)) {
    console.error('Kein Lasttest-Laden. Erst anlegen:  node dev/e2e/lasttest.cjs anlegen');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
};

/** Tagesplan von morgen: [Person, Beginn in Minuten, Dauer] – Alex/Bea je 16 × 30 Min., Cem 30/15/15 im Wechsel */
const dayPlan = () => {
  const plan = [];
  for (const staff of ['alex', 'bea']) for (let m = 8 * 60; m < 16 * 60; m += 30) plan.push([staff, m, 30]);
  for (let m = 8 * 60; m < 16 * 60; m += 60) plan.push(['cem', m, 30], ['cem', m + 30, 15], ['cem', m + 45, 15]);
  return plan;
};

async function anlegen(history) {
  if (fs.existsSync(STATE)) throw new Error(`Es gibt schon einen Lasttest-Laden (${STATE}). Erst: node dev/e2e/lasttest.cjs loeschen`);
  await pickLive();
  referer = `${LIVE}/`;
  const ts = Date.now();
  const pw = () => 'Last-' + crypto.randomBytes(8).toString('hex');
  const ownerPw = pw();
  const owner = await signUp(`q-me-last-${ts}@example.com`, ownerPw);
  const state = { live: LIVE, created: new Date().toISOString(), history, owner: { email: owner.email, pw: ownerPw, uid: owner.localId }, customers: [] };
  // Zugangsdaten sofort sichern, damit "loeschen" auch nach einem Abbruch aufräumen kann
  const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2)); };
  save();
  const tokens = [];
  for (let i = 1; i <= CUSTOMERS; i++) {
    const p = pw();
    const c = await signUp(`q-me-last-${ts}-k${i}@example.com`, p);
    state.customers.push({ email: c.email, pw: p, uid: c.localId, name: `Kunde ${i}` });
    tokens.push(c.idToken);
    save();
  }
  const now = new Date();
  await commit([setW('users', owner.localId, { uid: owner.localId, email: owner.email, role: 'shopOwner' })], owner.idToken);
  for (const [i, c] of state.customers.entries()) {
    await commit([setW('users', c.uid, { uid: c.uid, email: c.email, displayName: c.name, role: 'customer', createdAt: now })], tokens[i]);
  }

  const today = ymd(now);
  const d1 = addDays(today, 1);
  state.today = today;
  state.d1 = d1;
  state.shopId = newId();
  const hours = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, isOpen: true, openTime: '07:00', closeTime: '22:00', breaks: [] }));
  await commit([setW('shops', state.shopId, { name: SHOP_NAME, owner: owner.localId, phone: '1', email: owner.email, businessHoursByDay: hours, createdAt: now, updatedAt: now })], owner.idToken);
  save();
  state.services = { schnitt: newId(), kurz: newId() };
  const writes = [
    setW('services', state.services.schnitt, { shopId: state.shopId, name: 'Schnitt', duration: 30, price: 20, createdAt: now, updatedAt: now }),
    setW('services', state.services.kurz, { shopId: state.shopId, name: 'Kurz', duration: 15, price: 10, createdAt: now, updatedAt: now }),
  ];
  state.staff = {};
  const d1Day = weekday(d1);
  const person = (key, name, everyDay) => {
    state.staff[key] = newId();
    const working = Array.from({ length: 7 }, (_, d) => everyDay
      ? { dayOfWeek: d, startTime: '07:00', endTime: '22:00', isWorking: true }
      : { dayOfWeek: d, startTime: '08:00', endTime: '16:00', isWorking: d === d1Day });
    writes.push(setW('staff', state.staff[key], {
      shopId: state.shopId, name, email: `${key}@example.com`, phone: '', role: 'staff', serviceIds: [state.services.schnitt, state.services.kurz],
      isActive: true, status: 'available', userId: '', workingHours: working, createdAt: now, updatedAt: now,
    }));
  };
  person('alex', 'Alex', false);
  person('bea', 'Bea', false);
  person('cem', 'Cem', false);
  person('dora', 'Dora', true);
  await commit(writes, owner.idToken);
  save();

  // Morgen ausgebucht: 3 von 4 Terminen mit "früher dran" und Kundenkonto (reihum), der Rest Laufkundschaft
  const ownerWrites = [];
  const customerWrites = state.customers.map(() => []);
  state.plan = [];
  dayPlan().forEach(([staff, minute, duration], i) => {
    const id = newId();
    const candidate = i % 4 !== 3;
    const k = i % CUSTOMERS;
    const start = at(d1, minute);
    const end = at(d1, minute + duration);
    const fields = {
      id, shopId: state.shopId, staffId: state.staff[staff], serviceId: duration === 30 ? state.services.schnitt : state.services.kurz,
      startTime: start, endTime: end, status: 'scheduled', type: 'booked', createdAt: now, updatedAt: now,
      ...(candidate
        ? { customerId: state.customers[k].uid, customerName: state.customers[k].name, isAnonymous: false, checkEarlierOptions: true, checkEarlierOptionsCreatedAt: now }
        : { customerName: `Laufkunde ${i}`, isAnonymous: true, checkEarlierOptions: false }),
    };
    (candidate ? customerWrites[k] : ownerWrites).push(setW('appointments', id, fields));
    state.plan.push({ id, staff, start: start.toISOString(), end: end.toISOString(), duration, candidate, customer: candidate ? k : null });
  });
  // Verlauf: alte, erledigte Termine bei Alex (jede Platzberechnung für Alex liest sie alle mit)
  for (let i = 0; i < history; i++) {
    const day = addDays(today, -1 - Math.floor(i / 16));
    const minute = 8 * 60 + (i % 16) * 30;
    ownerWrites.push(setW('appointments', newId(), {
      shopId: state.shopId, staffId: state.staff.alex, serviceId: state.services.schnitt, customerName: 'Verlauf', status: 'completed', type: 'booked',
      startTime: at(day, minute), endTime: at(day, minute + 30), isAnonymous: true, createdAt: now, updatedAt: now,
    }));
  }
  for (const [k, w] of customerWrites.entries()) await commit(w, tokens[k]);
  await commit(ownerWrites, owner.idToken);
  save();
  console.log(`Angelegt: Laden ${state.shopId} auf ${LIVE}`);
  console.log(`  morgen (${d1}): ${state.plan.length} Termine, davon ${state.plan.filter((p) => p.candidate).length} mit "früher dran"; Verlauf bei Alex: ${history}`);
  console.log(`  Daten in ${STATE}`);
}

// ---------------------------------------------------------------------------------------------
// Löschen
// ---------------------------------------------------------------------------------------------

async function loeschen() {
  if (!fs.existsSync(STATE)) {
    console.log('Kein Lasttest-Laden vorhanden.');
    return;
  }
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  LIVE = state.live;
  referer = `${LIVE}/`;
  const owner = await signIn(state.owner.email, state.owner.pw);
  const customers = [];
  for (const c of state.customers) customers.push(await signIn(c.email, c.pw).catch(() => null));
  let removed = 0;
  if (state.shopId) {
    for (const collection of ['appointments', 'earlier_slot_notifications', 'services', 'staff', 'customers', 'push_subscriptions', 'schedules', 'shop_days']) {
      for (;;) {
        let docs = [];
        try {
          docs = await query(collection, [['shopId', '==', state.shopId]], owner.idToken, 400);
        } catch (e) {
          if (collection !== 'earlier_slot_notifications') console.log(`  ${collection}: ${e.message.slice(0, 120)}`);
          break;
        }
        if (!docs.length) break;
        try {
          await commit(docs.map((d) => delW(`${collection}/${d.id}`)), owner.idToken);
        } catch (e) {
          console.log(`  ${collection}: ${e.message.slice(0, 120)}`);
          break;
        }
        removed += docs.length;
      }
    }
    // Angebote darf je nach Regeln nur der Kunde selbst sehen
    for (const [i, c] of customers.entries()) {
      if (!c) continue;
      const docs = await query('earlier_slot_notifications', [['userId', '==', state.customers[i].uid]], c.idToken, 400).catch(() => []);
      if (docs.length) await commit(docs.map((d) => delW(`earlier_slot_notifications/${d.id}`)), c.idToken).catch((e) => console.log(`  Angebote Kunde ${i + 1}: ${e.message.slice(0, 120)}`));
      removed += docs.length;
    }
    await commit([delW(`shops/${state.shopId}`)], owner.idToken);
  }
  for (const [i, c] of customers.entries()) {
    if (!c) continue;
    await commit([delW(`users/${state.customers[i].uid}`)], c.idToken).catch(() => {});
    await http('POST', `${AUTH}:delete?key=${KEY}`, { body: { idToken: c.idToken } });
  }
  await commit([delW(`users/${state.owner.uid}`)], owner.idToken).catch(() => {});
  await http('POST', `${AUTH}:delete?key=${KEY}`, { body: { idToken: owner.idToken } });
  fs.unlinkSync(STATE);
  console.log(`Gelöscht: Laden, ${removed} Dokumente, ${customers.filter(Boolean).length + 1} Konten`);
}

// ---------------------------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------------------------

/** Puls: misst laufend, wie schnell der Server antwortet. stop() liefert die Messwerte. */
const pulse = (label) => {
  const samples = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t = Date.now();
      const r = await api.ping();
      samples.push({ t, ms: r.ms, ok: r.ok });
      await sleep(Math.max(0, 250 - r.ms));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      const s = stats(samples.map((x) => x.ms));
      const slow = samples.filter((x) => x.ms > 800).map((x) => `${new Date(x.t).toISOString().slice(11, 19)}Z ${Math.round(x.ms)}ms`);
      return { label, ...s, fails: samples.filter((x) => !x.ok).length, over1s: samples.filter((x) => x.ms > 1000).length, slow };
    },
  };
};

/** Mehrere Aufgaben mit begrenzter Gleichzeitigkeit */
const pool = async (items, concurrency, fn) => {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
};

const overlaps = (list) => {
  const found = [];
  const active = list.filter((a) => a.status !== 'cancelled').sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length && active[j].startTime < active[i].endTime; j++) {
      if (active[j].staffId === active[i].staffId) found.push([active[i], active[j]]);
    }
  }
  return found;
};

async function lauf(only) {
  const state = loadState();
  LIVE = state.live;
  referer = `${LIVE}/`;
  if (state.d1 <= ymd(new Date())) throw new Error(`Der Lasttest-Laden ist von ${state.today} – "morgen" ist schon vorbei. Neu anlegen: loeschen, anlegen.`);
  const owner = await signIn(state.owner.email, state.owner.pw);
  const customers = [];
  for (const c of state.customers) customers.push({ ...c, token: (await signIn(c.email, c.pw)).idToken });
  const S = state.staff;
  const staffName = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));
  const rows = [];
  const measures = [];
  const results = { live: LIVE, started: new Date().toISOString(), history: state.history, scenarios: {} };
  const want = (name) => !only.length || only.includes(name);
  const d1Range = [at(state.d1, 0), at(addDays(state.d1, 1), 0)];
  const dayOf = async (staffKey, range = d1Range) =>
    query('appointments', [['staffId', '==', S[staffKey]], ['startTime', '>=', range[0]], ['startTime', '<', range[1]]], owner.idToken);
  const d1All = async () => (await Promise.all(['alex', 'bea', 'cem'].map((k) => dayOf(k)))).flat();
  const offersOf = async (c) => (await query('earlier_slot_notifications', [['userId', '==', c.uid], ['isAccepted', '==', false]], c.token))
    .filter((n) => n.status !== 'expired' && (!n.expiresAt || n.expiresAt > new Date()));
  const allOffers = async () => (await Promise.all(customers.map(async (c, i) => (await offersOf(c)).map((n) => ({ ...n, customer: i }))))).flat();
  const cancel = (id, token = owner.idToken) => patch('appointments', id, { status: 'cancelled', updatedAt: new Date() }, token);
  const waitOffer = async (predicate, seconds = 45) => {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const hit = (await allOffers()).find(predicate);
      if (hit) return hit;
      await sleep(1000);
    }
    return null;
  };
  /**
   * Buchung am Tresen wie createAppointment (frontend/src/utils/firestore/appointments.ts + schedule.ts):
   * erst die Termine prüfen, dann in einem Schritt Termin anlegen und die Belegung der Person
   * (schedules/{staffId}_{Tag}) fortschreiben – nur, wenn sich die Belegung seit dem Lesen nicht geändert
   * hat (wie die Transaktion der App). Sonst neu lesen; steht der Platz dann drin, ist er vergeben.
   */
  const counterBook = async (staffKey, start, minutes) => {
    const end = new Date(start.getTime() + minutes * 60000);
    const taken = (await dayOf(staffKey)).some((a) => a.status !== 'cancelled' && a.startTime < end && start < a.endTime);
    if (taken) return { booked: false };
    const id = newId();
    const scheduleId = `${S[staffKey]}_${ymd(start)}`;
    for (let attempt = 1; attempt <= 12; attempt++) {
      const got = await http('GET', `${FS}/schedules/${scheduleId}`, { token: owner.idToken });
      if (!got.ok && got.status !== 404) throw new Error(`Belegung lesen: ${got.status} ${JSON.stringify(got.data).slice(0, 200)}`);
      const slots = got.ok ? (decFields(got.data.fields).slots || {}) : {};
      for (const [other, entry] of Object.entries(slots)) {
        if (!(entry.start < end && start < entry.end)) continue;
        const r = await http('GET', `${FS}/appointments/${other}`, { token: owner.idToken });
        const a = r.ok ? docOf(r.data) : null;
        if (a && a.status !== 'cancelled' && a.staffId === S[staffKey] && a.startTime < end && start < a.endTime) return { booked: false, attempts: attempt };
        delete slots[other]; // abgesagt, gelöscht oder verschoben
      }
      slots[id] = { start, end };
      const now = new Date();
      const res = await http('POST', `${FS}:commit`, { token: owner.idToken, body: { writes: [
        { ...setW('appointments', id, {
          id, shopId: state.shopId, staffId: S[staffKey], serviceId: minutes === 15 ? state.services.kurz : state.services.schnitt, startTime: start, endTime: end,
          status: 'scheduled', type: 'queue', customerName: 'Tresen', isAnonymous: true, createdAt: now, updatedAt: now,
        }), currentDocument: { exists: false } },
        { ...setW('schedules', scheduleId, { shopId: state.shopId, staffId: S[staffKey], day: ymd(start), slots, updatedAt: now }),
          currentDocument: got.ok ? { updateTime: got.data.updateTime } : { exists: false } },
      ] } });
      if (res.ok) return { booked: true, id, attempts: attempt };
      if (![400, 409].includes(res.status)) throw new Error(`Tresen buchen: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
      await sleep(100 + Math.random() * 300); // Belegung hat sich geändert: neu lesen
    }
    throw new Error('Tresen buchen: Belegung ändert sich ständig');
  };

  const base = pulse('Ruhe');
  await sleep(5000);
  measures.push(await base.stop());

  // --- ruhe: nur der Puls, ohne Last (zeigt Aussetzer, die der Server von sich aus hat) ---------------
  if (only.includes('ruhe')) {
    console.log('== ruhe');
    const p = pulse('ruhe');
    await sleep(Number(process.env.QME_RUHE || 330) * 1000);
    const pm = await p.stop();
    measures.push(pm);
    results.scenarios.ruhe = pm;
    console.log(`  langsam: ${pm.slow.join(', ') || 'nie'}`);
  }

  // --- abfragen ---------------------------------------------------------------------------------
  if (want('abfragen')) {
    console.log('== abfragen');
    const day = (d) => at(d, 12 * 60).toISOString();
    const p = pulse('abfragen');
    const req = (staff, date, force) => ({ shop_id: state.shopId, staff_id: S[staff], service_id: state.services.schnitt, date: day(date), force_refresh: force });
    // Ohne Zwischenspeicher, nacheinander: Kosten des Verlaufs (Alex) gegenüber ohne (Bea)
    const seq = {};
    for (const staff of ['alex', 'bea']) {
      seq[staff] = [];
      for (let i = 0; i < 5; i++) seq[staff].push((await api.slots(req(staff, state.d1, true))).ms);
    }
    // Viele gleichzeitig, wie mehrere Kunden auf der Buchungsseite (zum Teil aus dem Zwischenspeicher)
    const burst = Array.from({ length: 60 }, (_, i) => req(['bea', 'cem', 'dora'][i % 3], i % 2 ? state.d1 : ymd(new Date()), false));
    const burstRes = await pool(burst, 20, (b) => api.slots(b));
    // Gleichzeitig ohne Zwischenspeicher (z. B. mehrere "Früher dran"-Prüfungen und Buchungsseiten)
    const parallel = await pool(Array.from({ length: 10 }, (_, i) => req(i % 2 ? 'alex' : 'bea', state.d1, true)), 10, (b) => api.slots(b));
    const pm = await p.stop();
    const sa = stats(seq.alex), sb = stats(seq.bea);
    results.scenarios.abfragen = { seq, burst: stats(burstRes.map((r) => r.ms)), burstFails: burstRes.filter((r) => !r.ok).length, parallel: stats(parallel.map((r) => r.ms)), pulse: pm };
    measures.push({ label: `Freie Zeiten Bea (${state.plan.filter((x) => x.staff === 'bea').length} Termine)`, ...sb });
    measures.push({ label: `Freie Zeiten Alex (+${state.history} Verlauf)`, ...sa });
    measures.push({ label: '60 Anfragen, 20 gleichzeitig', ...stats(burstRes.map((r) => r.ms)) });
    measures.push({ label: '10 ohne Zwischenspeicher gleichzeitig', ...stats(parallel.map((r) => r.ms)) });
    measures.push(pm);
    rows.push({ name: 'Freie Zeiten: keine Fehler unter Last', pass: burstRes.every((r) => r.ok) && parallel.every((r) => r.ok), detail: `${burstRes.filter((r) => !r.ok).length + parallel.filter((r) => !r.ok).length} Fehler` });
    rows.push({ name: 'Freie Zeiten: p95 unter 2 s', pass: (stats(burstRes.map((r) => r.ms)).p95 || 0) < 2000 && (stats(parallel.map((r) => r.ms)).p95 || 0) < 2000, detail: `Ansturm ${fmt(stats(burstRes.map((r) => r.ms)))}` });
    const perDoc = state.history ? (sa.p50 - sb.p50) / state.history : 0;
    results.scenarios.abfragen.msPerHistoryDoc = perDoc;
    console.log(`  Verlauf kostet ~${perDoc.toFixed(2)} ms je altem Termin und Berechnung (Alex ${sa.p50} ms, Bea ${sb.p50} ms)`);
  }

  // --- ansturm ----------------------------------------------------------------------------------
  if (want('ansturm')) {
    console.log('== ansturm');
    const n = Number(process.env.QME_ANSTURM || 10);
    const browser = await launch();
    const p = pulse('ansturm');
    const t0 = Date.now();
    const pages = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const page = await newPage(browser);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
      try {
        await page.goto(`${LIVE}/public-join-queue?shopId=${state.shopId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByRole('button', { name: /Schnitt/ }).first().click({ timeout: 60000 });
        await page.getByRole('button', { name: /^Dora/ }).click({ timeout: 60000 });
        await page.locator('#queue-name').fill(`Ansturm ${i + 1}`, { timeout: 60000 });
        await page.waitForFunction(() => /\d{2}:\d{2}/.test(document.querySelector('[aria-live="polite"]')?.textContent || ''), null, { timeout: 60000 });
        const shown = (await page.locator('[aria-live="polite"]').first().innerText()).match(/\d{2}:\d{2}/)?.[0];
        return { page, errors, shown };
      } catch (e) {
        return { page, errors, failed: String(e).slice(0, 160) };
      }
    }));
    const ready = pages.filter((x) => !x.failed);
    // Alle im selben Moment auf "Nummer ziehen"
    const outcome = await Promise.all(ready.map(async (x) => {
      const t = Date.now();
      await x.page.getByRole('button', { name: 'Nummer ziehen' }).click();
      const res = await Promise.race([
        x.page.getByText('Du bist eingereiht.').waitFor({ timeout: 45000 }).then(() => 'eingereiht'),
        x.page.locator('[data-sonner-toast]').first().waitFor({ timeout: 45000 }).then(async () => `Hinweis: ${(await x.page.locator('[data-sonner-toast]').first().innerText()).slice(0, 80)}`),
      ]).catch(() => 'keine Rückmeldung');
      return { shown: x.shown, res, ms: Date.now() - t };
    }));
    await browser.close();
    const pm = await p.stop();
    const today = ymd(new Date());
    const doraToday = await dayOf('dora', [at(today, 0), at(addDays(today, 1), 0)]);
    const rush = doraToday.filter((a) => /^Ansturm/.test(a.customerName || '') && a.status !== 'cancelled');
    const dup = overlaps(rush);
    const codes = rush.map((a) => a.referenceCode).filter(Boolean);
    const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
    const slotsUsed = new Set(rush.map((a) => hhmm(a.startTime)));
    results.scenarios.ansturm = { n, ready: ready.length, failedToLoad: pages.filter((x) => x.failed).map((x) => x.failed), outcome, created: rush.map((a) => ({ id: a.id, start: hhmm(a.startTime), code: a.referenceCode })), pulse: pm, seconds: (Date.now() - t0) / 1000 };
    console.log(`  ${ready.length}/${n} Seiten bereit, angezeigt: ${[...new Set(ready.map((x) => x.shown))].join(', ')}`);
    console.log(`  Ergebnis: ${Object.entries(outcome.reduce((m, o) => ({ ...m, [o.res]: (m[o.res] || 0) + 1 }), {})).map(([k, v]) => `${v}× ${k}`).join(', ')}`);
    console.log(`  angelegt: ${rush.length} Termine auf ${slotsUsed.size} Uhrzeiten (${[...slotsUsed].join(', ')})`);
    measures.push({ label: `Nummer ziehen (${ready.length} gleichzeitig)`, ...stats(outcome.map((o) => o.ms)) });
    measures.push(pm);
    rows.push({ name: 'Ansturm: alle Seiten laden', pass: ready.length === n, detail: `${ready.length}/${n}` });
    rows.push({ name: 'Ansturm: jeder bekommt Rückmeldung', pass: outcome.every((o) => o.res !== 'keine Rückmeldung'), detail: `${outcome.filter((o) => o.res === 'keine Rückmeldung').length} ohne` });
    rows.push({ name: 'Ansturm: keine Doppelbuchung', pass: dup.length === 0, detail: `${rush.length} Termine, ${dup.length} Überschneidungen` });
    rows.push({ name: 'Ansturm: keine doppelte Nummer', pass: dupCodes.length === 0, detail: dupCodes.length ? `doppelt: ${[...new Set(dupCodes)].join(', ')}` : `${codes.length} Nummern` });
    // Wieder freigeben, damit nichts liegen bleibt
    await Promise.all(rush.map((a) => cancel(a.id)));
  }

  // --- kaskade ----------------------------------------------------------------------------------
  // Kunden-Bots: fragen jede Sekunde ihre Angebote ab und nehmen sie sofort an (außer hold)
  const bot = { hold: true, stop: false, events: [], seen: new Set() };
  const bots = customers.map((c, i) => (async () => {
    while (!bot.stop) {
      if (!bot.hold) {
        const offers = await offersOf(c).catch(() => []);
        for (const o of offers) {
          if (bot.seen.has(o.id) || bot.hold) continue;
          bot.seen.add(o.id);
          const seenAt = Date.now();
          const r = await api.accept(o.id, c.token);
          bot.events.push({ customer: i, offer: o.id, appointment: o.appointmentId, staff: staffName[o.staffId], slot: hhmm(localIso(o.earlierStartTime)), offeredAt: o.offeredAt, seenAt, acceptMs: r.ms, result: r.data?.status || r.status, message: r.data?.message });
        }
      }
      await sleep(1000);
    }
  })());
  const settle = async (quietSeconds = 30, maxSeconds = 600) => {
    const end = Date.now() + maxSeconds * 1000;
    let quietSince = Date.now();
    let lastEvents = bot.events.length;
    while (Date.now() < end) {
      await sleep(3000);
      const open = (await allOffers()).filter((o) => !bot.seen.has(o.id));
      if (open.length || bot.events.length !== lastEvents) {
        quietSince = Date.now();
        lastEvents = bot.events.length;
      } else if (Date.now() - quietSince > quietSeconds * 1000) return true;
    }
    return false;
  };

  if (want('kaskade')) {
    console.log('== kaskade');
    const before = await d1All();
    const initial = new Map(before.map((a) => [a.id, a]));
    const pick = (staff, minute) => before.find((a) => a.staffId === S[staff] && minutesOf(a.startTime) === minute && a.status === 'scheduled');
    const cancelled = [pick('alex', 8 * 60), pick('bea', 8 * 60 + 30), pick('bea', 11 * 60), pick('cem', 8 * 60)].filter(Boolean);
    const p = pulse('kaskade');
    const t0 = Date.now();
    await Promise.all(cancelled.map((a) => cancel(a.id)));
    await Promise.all([...new Set(cancelled.map((a) => a.staffId))].map((staffId) => api.slotFreed(state.shopId, staffId, owner.idToken)));
    // Erstes Angebot: fremd annehmen, dann zweimal gleichzeitig (zwei Geräte – im selben Fenster sperrt der Knopf)
    const first = await waitOffer(() => true, 60);
    const firstMs = Date.now() - t0;
    let special = {};
    if (first) {
      const owner_ = customers[first.customer];
      const stranger = customers[(first.customer + 1) % customers.length];
      const foreign = await api.accept(first.id, stranger.token);
      const apptBefore = (await d1All()).find((a) => a.id === first.appointmentId);
      const [a1, a2] = await Promise.all([api.accept(first.id, owner_.token), api.accept(first.id, owner_.token)]);
      bot.seen.add(first.id);
      const apptAfter = (await d1All()).find((a) => a.id === first.appointmentId);
      special = { foreign: foreign.data, double: [a1.data, a2.data], before: hhmm(apptBefore.startTime), after: hhmm(apptAfter.startTime), slot: hhmm(localIso(first.earlierStartTime)) };
      rows.push({ name: 'Fremdes Angebot wird abgelehnt', pass: foreign.data?.status === 'error' && hhmm(apptBefore.startTime) === hhmm(initial.get(first.appointmentId).startTime), detail: foreign.data?.message });
      const wins = [a1, a2].filter((r) => r.data?.status === 'success').length;
      rows.push({ name: 'Zweimal annehmen: einmal verschoben', pass: wins >= 1 && hhmm(apptAfter.startTime) === special.slot, detail: `${wins}× Erfolg, Termin ${special.before} → ${special.after}` });
      rows.push({ name: 'Zweimal annehmen (2 Geräte): kein Fehler', pass: wins === 2 || [a1, a2].some((r) => r.data?.status === 'success') && [a1, a2].every((r) => r.data?.status === 'success' || /schon|bereits/i.test(r.data?.message || '')), detail: [a1, a2].map((r) => r.data?.message).join(' | ') });
    }
    rows.push({ name: 'Erstes Angebot nach Absage', pass: !!first && firstMs < 15000, detail: first ? `${(firstMs / 1000).toFixed(1)} s` : 'keins in 60 s' });
    bot.hold = false;
    const converged = await settle(30, 600);
    bot.hold = true;
    const seconds = (Date.now() - t0) / 1000;
    const pm = await p.stop();
    const after = await d1All();
    const now = new Date();
    const earliest = new Date(now.getTime() + 15 * 60000);
    const active = after.filter((a) => a.status !== 'cancelled');
    const moved = active.filter((a) => initial.has(a.id) && initial.get(a.id).startTime.getTime() !== a.startTime.getTime());
    const later = active.filter((a) => initial.has(a.id) && a.startTime > initial.get(a.id).startTime);
    const nonCandMoved = moved.filter((a) => !initial.get(a.id).checkEarlierOptions);
    // Verschenkter Platz: ein Kandidat könnte auf einen freien früheren Platz (15-Minuten-Raster, 08–16 Uhr).
    // Plätze, die den eigenen Termin überlappen (15 Minuten vor), bietet das Backend bewusst nicht an.
    const wasted = [];
    for (const c of active.filter((a) => a.checkEarlierOptions && a.customerId)) {
      const dur = (c.endTime - c.startTime) / 60000;
      const mine = active.filter((a) => a.staffId === c.staffId && a.id !== c.id);
      for (let m = 8 * 60; m + dur <= 16 * 60; m += 15) {
        const s = at(state.d1, m), e = at(state.d1, m + dur);
        if (s >= c.startTime || s < earliest || e > c.startTime) continue;
        if (!mine.some((a) => a.startTime < e && s < a.endTime)) { wasted.push(`${staffName[c.staffId]} ${hhmm(s)} für ${hhmm(c.startTime)}`); break; }
      }
    }
    // Reihenfolge: Bei gleicher Dauer überholt niemand, der vorher hinter einem stand
    const overtaken = [];
    const cands = active.filter((a) => initial.has(a.id) && initial.get(a.id).checkEarlierOptions);
    for (const x of cands) for (const y of cands) {
      if (x.staffId === y.staffId && x.serviceId === y.serviceId && initial.get(x.id).startTime < initial.get(y.id).startTime && x.startTime > y.startTime) overtaken.push(`${staffName[x.staffId]} ${hhmm(initial.get(x.id).startTime)}→${hhmm(x.startTime)} hinter ${hhmm(initial.get(y.id).startTime)}→${hhmm(y.startTime)}`);
    }
    const ev = bot.events;
    const ok = ev.filter((e) => e.result === 'success');
    const failed = ev.filter((e) => e.result !== 'success');
    const open = await allOffers();
    results.scenarios.kaskade = { cancelled: cancelled.map((a) => `${staffName[a.staffId]} ${hhmm(a.startTime)}`), firstOfferMs: firstMs, special, converged, seconds, events: ev, moved: moved.length, wasted, overtaken, open: open.length, pulse: pm };
    console.log(`  ${cancelled.length} Absagen → ${ok.length} angenommene Angebote, ${failed.length} abgelehnt, ${moved.length} Termine früher, in ${seconds.toFixed(0)} s`);
    for (const f of failed.slice(0, 5)) console.log(`    abgelehnt: ${f.staff} ${f.slot} – ${f.message}`);
    measures.push({ label: 'Angebot annehmen', ...stats(ev.map((e) => e.acceptMs)) });
    measures.push(pm);
    rows.push({ name: 'Kaskade kommt zur Ruhe', pass: converged, detail: `${seconds.toFixed(0)} s, ${ok.length} Schritte (${(seconds / Math.max(1, ok.length)).toFixed(1)} s je Schritt)` });
    rows.push({ name: 'Kaskade: keine Doppelbuchung', pass: overlaps(after).length === 0, detail: overlaps(after).map(([a, b]) => `${staffName[a.staffId]} ${hhmm(a.startTime)}/${hhmm(b.startTime)}`).join(', ') });
    rows.push({ name: 'Kaskade: kein Termin verloren', pass: active.length === before.filter((a) => a.status !== 'cancelled').length - cancelled.length, detail: `${active.length} aktiv` });
    rows.push({ name: 'Kaskade: niemand rückt nach hinten', pass: later.length === 0, detail: later.map((a) => hhmm(a.startTime)).join(', ') });
    rows.push({ name: 'Kaskade: Laufkunden bleiben, wo sie sind', pass: nonCandMoved.length === 0, detail: nonCandMoved.map((a) => hhmm(a.startTime)).join(', ') });
    rows.push({ name: 'Kaskade: kein früherer Platz verschenkt', pass: wasted.length === 0, detail: wasted.slice(0, 4).join('; ') });
    rows.push({ name: 'Kaskade: Reihenfolge der Schlange', pass: overtaken.length === 0, detail: overtaken.slice(0, 3).join('; ') });
    rows.push({ name: 'Kaskade: Annahmen klappen', pass: failed.length === 0, detail: `${failed.length} von ${ev.length} abgelehnt` });
    rows.push({ name: 'Kaskade: keine offenen Angebote übrig', pass: open.length === 0, detail: `${open.length} offen` });
  }

  // --- wettlauf ---------------------------------------------------------------------------------
  if (want('wettlauf')) {
    console.log('== wettlauf');
    bot.hold = true;
    const p = pulse('wettlauf');
    const rounds = [];
    // Verzögerung des Tresens je Runde, z. B. QME_WETTLAUF=0,25,50,75 für ein feines Raster
    const delays = (process.env.QME_WETTLAUF || '0,50,100,150,200,300').split(',').map(Number);
    const used = new Set(); // Plätze früherer Runden nicht noch einmal nehmen (dort liegen ggf. schon zwei)
    for (const [round, delay] of delays.entries()) {
      const staff = ['alex', 'bea', 'cem'][round % 3];
      const day = (await dayOf(staff)).filter((a) => a.status !== 'cancelled').sort((a, b) => a.startTime - b.startTime);
      const target = day.find((a) => (a.endTime - a.startTime) === 30 * 60000 && a.startTime > new Date(Date.now() + 20 * 60000) && !used.has(`${staff} ${a.startTime.getTime()}`));
      if (target) used.add(`${staff} ${target.startTime.getTime()}`);
      if (!target) { rounds.push({ staff, skipped: 'kein Termin' }); continue; }
      const slot = target.startTime.getTime();
      await cancel(target.id);
      await api.slotFreed(state.shopId, S[staff], owner.idToken);
      const offer = await waitOffer((o) => o.staffId === S[staff] && localIso(o.earlierStartTime).getTime() === slot);
      if (!offer) { rounds.push({ staff, skipped: 'kein Angebot' }); continue; }
      bot.seen.add(offer.id);
      const [acc, desk] = await Promise.all([api.accept(offer.id, customers[offer.customer].token), sleep(delay).then(() => counterBook(staff, new Date(slot), 30))]);
      await sleep(1500);
      const atSlot = (await dayOf(staff)).filter((a) => a.status !== 'cancelled' && a.startTime.getTime() === slot);
      rounds.push({ staff, delay, accept: acc.data?.status, acceptMessage: acc.data?.message, acceptMs: Math.round(acc.ms), desk: desk.booked, atSlot: atSlot.length });
      console.log(`  ${staff} ${hhmm(new Date(slot))}, Tresen nach ${delay} ms: Annahme ${acc.data?.status} (${Math.round(acc.ms)} ms), Tresen ${desk.booked ? 'gebucht' : 'abgewiesen'} → ${atSlot.length} Termin(e) auf dem Platz`);
    }
    const pm = await p.stop();
    measures.push(pm);
    results.scenarios.wettlauf = { rounds, pulse: pm };
    const played = rounds.filter((r) => !r.skipped);
    rows.push({ name: 'Wettlauf: nie zwei auf einem Platz', pass: played.length > 0 && played.every((r) => r.atSlot <= 1), detail: played.map((r) => `${r.staff}: ${r.atSlot}`).join(', ') || rounds.map((r) => r.skipped).join(', ') });
  }

  // --- absage -----------------------------------------------------------------------------------
  if (want('absage')) {
    console.log('== absage');
    bot.hold = true;
    let offer = (await allOffers()).find((o) => !bot.seen.has(o.id));
    if (!offer) {
      const day = (await dayOf('bea')).filter((a) => a.status !== 'cancelled').sort((a, b) => a.startTime - b.startTime);
      const target = day.find((a) => a.startTime > new Date(Date.now() + 20 * 60000));
      if (target) {
        await cancel(target.id);
        await api.slotFreed(state.shopId, S.bea, owner.idToken);
        offer = await waitOffer((o) => !bot.seen.has(o.id));
      }
    }
    if (offer) {
      bot.seen.add(offer.id);
      const c = customers[offer.customer];
      // Kunde sagt seinen Termin ab (wie "Meine Termine") und tippt im selben Moment noch auf das Angebot
      const cancelled = await cancel(offer.appointmentId, c.token);
      const ownCancel = cancelled.ok;
      if (!ownCancel) await cancel(offer.appointmentId);
      const [, acc] = await Promise.all([api.slotFreed(state.shopId, offer.staffId, c.token), api.accept(offer.id, c.token)]);
      await sleep(3000);
      const appt = (await d1All()).find((a) => a.id === offer.appointmentId);
      results.scenarios.absage = { accept: acc.data, status: appt?.status, ownCancel };
      console.log(`  Annahme nach Absage: ${acc.data?.status} – ${acc.data?.message}; Termin danach: ${appt?.status}`);
      rows.push({ name: 'Abgesagter Termin bleibt abgesagt', pass: appt?.status === 'cancelled', detail: `Annahme: ${acc.data?.status}, Termin: ${appt?.status}${ownCancel ? '' : ' (Absage nur als Inhaber möglich)'}` });
    } else {
      rows.push({ name: 'Abgesagter Termin bleibt abgesagt', pass: false, detail: 'kein Angebot zum Prüfen' });
    }
  }

  // --- flut -------------------------------------------------------------------------------------
  if (want('flut')) {
    console.log('== flut');
    const p = pulse('flut');
    const n = 25;
    const res = await Promise.all(Array.from({ length: n }, () => api.slotFreed(state.shopId, S.bea, customers[0].token)));
    await sleep(20000);
    const pm = await p.stop();
    results.scenarios.flut = { n, response: stats(res.map((r) => r.ms)), fails: res.filter((r) => !r.ok).length, pulse: pm };
    measures.push({ label: `${n}× "Platz frei" gleichzeitig`, ...stats(res.map((r) => r.ms)) });
    measures.push(pm);
    rows.push({ name: 'Flut: Server bleibt ansprechbar', pass: pm.max < 3000 && pm.fails === 0, detail: fmt(pm) });
  }

  bot.stop = true;
  await Promise.all(bots);

  // --- Gesamtprüfung ----------------------------------------------------------------------------
  const everything = (await query('appointments', [['shopId', '==', state.shopId]], owner.idToken, 5000)).filter((a) => a.startTime >= at(ymd(new Date()), 0));
  const dup = overlaps(everything);
  rows.push({ name: 'Ende: keine Doppelbuchung im Laden', pass: dup.length === 0, detail: dup.map(([a, b]) => `${staffName[a.staffId]} ${ymd(a.startTime)} ${hhmm(a.startTime)}/${hhmm(b.startTime)}`).slice(0, 5).join(', ') });
  for (const m of measures.filter((x) => /^(Ruhe|ruhe|abfragen|ansturm|kaskade|wettlauf|flut)$/.test(x.label))) {
    rows.push({ name: `Puls ${m.label}: Server antwortet`, pass: (m.max ?? 0) < 3000 && !m.fails, detail: `${fmt(m)}${m.over1s ? `, ${m.over1s}× über 1 s` : ''}` });
  }

  console.log('\nMesswerte (Antwortzeiten)');
  for (const m of measures) console.log(`  ${m.label.padEnd(42)} ${fmt(m)}${m.over1s ? `, ${m.over1s}× über 1 s` : ''}`);
  console.log(`  Firestore-Lesevorgänge dieses Skripts: ~${readCount}\n`);
  results.measures = measures;
  results.rows = rows;
  results.clientReads = readCount;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `lasttest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`Ergebnisse: ${file}`);
  return report(rows);
}

/** Tagesplan von morgen je Person: Uhrzeit, Dauer, * = "früher dran", x = abgesagt */
async function zeigen() {
  const state = loadState();
  LIVE = state.live;
  referer = `${LIVE}/`;
  const owner = await signIn(state.owner.email, state.owner.pw);
  for (const key of ['alex', 'bea', 'cem']) {
    const day = (await query('appointments', [['staffId', '==', state.staff[key]], ['startTime', '>=', at(state.d1, 0)], ['startTime', '<', at(addDays(state.d1, 1), 0)]], owner.idToken))
      .sort((a, b) => a.startTime - b.startTime);
    console.log(`${key.padEnd(5)} ${day.map((a) => `${hhmm(a.startTime)}/${(a.endTime - a.startTime) / 60000}${a.checkEarlierOptions ? '*' : ''}${a.status === 'cancelled' ? 'x' : ''}`).join(' ')}`);
  }
}

run(async () => {
  const [command, ...args] = process.argv.slice(2);
  const history = Number(args[0] ?? 200);
  if (command === 'anlegen') return anlegen(history);
  if (command === 'loeschen' || command === 'löschen') return loeschen();
  if (command === 'lauf') return lauf(args);
  if (command === 'zeigen') return zeigen();
  if (command === 'alles') {
    await anlegen(history);
    try {
      return await lauf([]);
    } finally {
      await loeschen();
    }
  }
  console.error('Aufruf: node dev/e2e/lasttest.cjs anlegen [Verlauf] | lauf [Szenario …] | loeschen | alles [Verlauf]');
  return false;
});
