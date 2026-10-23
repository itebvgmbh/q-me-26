// Prüft firestore.rules im Firestore-Emulator: npm test (in dev/regeln, Anleitung README.md).
// Die Schreibvorgänge sind denen der App und der Testskripte nachgebaut (Felder wie dort), damit die Regeln nichts
// sperren, was heute gebraucht wird. „backend“ schreibt wie das Admin SDK ohne Regeln.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, runTransaction, setDoc, setLogLevel, Timestamp,
  updateDoc, where, writeBatch,
} from 'firebase/firestore';

// Abgelehnte Zugriffe sind hier gewollt; ohne das meldet das SDK jeden einzeln
setLogLevel('silent');

const DAY = 86_400_000;
const inDays = (days) => Timestamp.fromMillis(Date.now() + days * DAY);

const OWNER = 'inhaberin';
const TEAM = 'robin'; // Person im Team (staff.userId), nicht Inhaber
const OTHER = 'fremd'; // irgendein anderes Konto
const SHOP = 'laden1';
const STAFF = 'person1';
const SHOP2 = 'laden2'; // Laden eines anderen Kontos (OTHER)
const STAFF2 = 'person2';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dranzeit',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid) => env.authenticatedContext(uid).firestore();
/** Wie das Backend mit dem Admin SDK: Regeln gelten nicht */
const backend = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

/** Laden wie in Betrieb: angelegt vom Assistenten, Person im Team, Leistung */
const seedShop = (extra = {}) =>
  backend(async (db) => {
    await setDoc(doc(db, 'shops', SHOP), {
      name: 'Salon Test', owner: OWNER, phone: '1', email: 'laden@example.com', businessHoursByDay: [],
      plan: 'gratis', trialEndsAt: inDays(30), createdAt: inDays(0), updatedAt: inDays(0), ...extra,
    });
    await setDoc(doc(db, 'staff', STAFF), { shopId: SHOP, name: 'Robin', userId: TEAM, isActive: true, workingHours: [] });
    // Team-Vermerk, wie ihn das Backend beim Annehmen der Einladung setzt (app/libs/team.py)
    await setDoc(doc(db, 'shops', SHOP, 'members', TEAM), { staffId: STAFF, at: Timestamp.now() });
    await setDoc(doc(db, 'services', 'leistung1'), { shopId: SHOP, name: 'Schnitt', duration: 30, price: 20 });
    // Zweiter Laden eines anderen Kontos
    await setDoc(doc(db, 'shops', SHOP2), { name: 'Anderer Laden', owner: OTHER, plan: 'gratis', createdAt: inDays(0), updatedAt: inDays(0) });
    await setDoc(doc(db, 'staff', STAFF2), { shopId: SHOP2, name: 'Alex', userId: '', isActive: true, workingHours: [] });
  });

const TODAY = new Date().toISOString().slice(0, 10);
const START = inDays(0.1);
const END = Timestamp.fromMillis(START.toMillis() + 30 * 60000);
// Hash des Schlüssels einer Nummer ohne Konto (utils/ticket-key.ts: SHA-256 als Hex)
const KEY_HASH = 'a'.repeat(64);

/** Termin wie createAppointment (Felder je nach Ablauf), ohne Transaktion */
const ticket = (extra = {}) => ({
  shopId: SHOP, staffId: STAFF, serviceId: 'leistung1', startTime: START, endTime: END, status: 'scheduled',
  type: 'queue', customerName: 'Gast', checkEarlierOptions: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra,
});

/** Nummer ohne Konto, wie QueueBookingService sie zieht: mit Name, Handynummer und Hash des Schlüssels */
const anonTicket = (extra = {}) => ticket({ isAnonymous: true, customerPhone: '0170 1', ticketKeyHash: KEY_HASH, ...extra });

// Öffentliche Kurzfassung wie publicViewOf (utils/firestore/public-appointments.ts)
const PUBLIC_FIELDS = ['shopId', 'staffId', 'serviceId', 'type', 'status', 'startTime', 'endTime', 'referenceCode', 'isAnonymous', 'calledAt', 'lastCalledAt', 'completedAt'];
const publicOf = (a) => {
  const view = Object.fromEntries(PUBLIC_FIELDS.filter((f) => a[f] !== undefined && a[f] !== null).map((f) => [f, a[f]]));
  view.shopDay = `${a.shopId}_${TODAY}`;
  if (a.staffId) view.staffDay = `${a.staffId}_${TODAY}`;
  return view;
};

/** Termin, den es schon gibt (vom Backend angelegt, mit Kurzfassung) */
const seedAppointment = (id, extra = {}) =>
  backend(async (db) => {
    const data = ticket(extra);
    await setDoc(doc(db, 'appointments', id), data);
    await setDoc(doc(db, 'public_appointments', id), publicOf(data));
  });

/** Nummer ziehen wie createAppointment: Termin, Kurzfassung, Belegung und Tagesnummer in einer Transaktion */
const drawNumber = (db, data, code = 'A12', view = publicOf) => {
  const appointment = doc(collection(db, 'appointments'));
  return runTransaction(db, async (tx) => {
    const schedule = await tx.get(doc(db, 'schedules', `${data.staffId}_${TODAY}`));
    const numbers = await tx.get(doc(db, 'shop_days', `${data.shopId}_${TODAY}`));
    const now = Timestamp.now();
    const created = { id: appointment.id, ...data, referenceCode: code, createdAt: now, updatedAt: now };
    tx.set(appointment, created);
    if (view) tx.set(doc(db, 'public_appointments', appointment.id), view(created));
    tx.set(schedule.ref, { shopId: data.shopId, staffId: data.staffId, day: TODAY, slots: { ...(schedule.data()?.slots || {}), [appointment.id]: { start: data.startTime, end: data.endTime } }, updatedAt: now });
    tx.set(numbers.ref, { shopId: data.shopId, day: TODAY, codes: [...(numbers.data()?.codes || []), code], updatedAt: now });
  }).then(() => appointment);
};

/** Absagen wie cancelAppointment: Status, Kurzfassung und Belegung in einer Transaktion */
const cancel = (db, id, staffId = STAFF) =>
  runTransaction(db, async (tx) => {
    const snap = await tx.get(doc(db, 'appointments', id));
    const schedule = await tx.get(doc(db, 'schedules', `${staffId}_${TODAY}`));
    const slots = { ...(schedule.data()?.slots || {}) };
    delete slots[id];
    const update = { status: 'cancelled', updatedAt: Timestamp.now() };
    tx.set(snap.ref, update, { merge: true });
    tx.set(doc(db, 'public_appointments', id), publicOf({ ...snap.data(), ...update }));
    tx.set(schedule.ref, { shopId: snap.data().shopId, staffId, day: TODAY, slots, updatedAt: Timestamp.now() });
  });

/** Termin ändern wie updateAppointment (Tresen, Mein Tag): Termin und Kurzfassung in einer Transaktion */
const change = (db, id, update) =>
  runTransaction(db, async (tx) => {
    const snap = await tx.get(doc(db, 'appointments', id));
    tx.set(snap.ref, update, { merge: true });
    tx.set(doc(db, 'public_appointments', id), publicOf({ ...snap.data(), ...update }));
  });

/** Neuer Laden wie utils/shop-setup.ts → createShop (Felder aus dem Assistenten, plans.ts newShopPlanFields) */
const appShop = (owner, extra = {}) => ({
  name: 'Neuer Laden', street: 'Hauptstr. 1', postalCode: '12345', city: 'Testheim', address: 'Hauptstr. 1, 12345 Testheim',
  phone: '0123', email: 'neu@example.com', businessHoursByDay: [{ dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '17:00', breaks: [] }],
  plan: 'gratis', trialEndsAt: inDays(30), owner, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra,
});

/** Laden löschen wie die Testskripte: Vermerk in deleted_shops und Löschen in einem Schritt */
const deleteShop = (db, shopId, owner) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'deleted_shops', shopId), { owner, deletedAt: Timestamp.now() });
  batch.delete(doc(db, 'shops', shopId));
  return batch.commit();
};

describe('Läden anlegen', () => {
  test('Einrichtungsassistent: gratis, Testphase 30 Tage', async () => {
    await assertSucceeds(addDoc(collection(as(OWNER), 'shops'), appShop(OWNER)));
  });

  test('fixtures.py, lasttest.cjs, Testskripte: ohne Tarif-Felder', async () => {
    const now = Timestamp.now();
    await assertSucceeds(setDoc(doc(as(OWNER), 'shops', 'fixture'), { name: 'Testladen (wird gleich gelöscht)', owner: OWNER, phone: '1', email: 'x@example.com', businessHoursByDay: [], createdAt: now, updatedAt: now }));
    await assertSucceeds(addDoc(collection(as(OWNER), 'shops'), { name: 'Zweitladen', owner: OWNER, createdAt: now, updatedAt: now }));
  });

  test('Testskripte: Testphase schon vorbei oder gleich gesperrt (schadet nur dem Laden selbst)', async () => {
    await assertSucceeds(addDoc(collection(as(OWNER), 'shops'), appShop(OWNER, { trialEndsAt: inDays(-1) })));
    await assertSucceeds(addDoc(collection(as(OWNER), 'shops'), appShop(OWNER, { suspended: { at: Timestamp.now() } })));
  });

  test('ohne Anmeldung oder für ein anderes Konto: abgelehnt', async () => {
    await assertFails(addDoc(collection(anon(), 'shops'), appShop(OWNER)));
    await assertFails(addDoc(collection(as(OTHER), 'shops'), appShop(OWNER)));
  });

  for (const [what, extra] of [
    ['Testphase 60 Tage', { trialEndsAt: inDays(60) }],
    ['Testphase als Text', { trialEndsAt: '2099-12-31' }],
    ['Anlegedatum in der Zukunft (Testphase zählt ab da)', { trialEndsAt: undefined, createdAt: inDays(10) }],
    ['Anlegedatum als Text', { trialEndsAt: undefined, createdAt: '2099-12-31' }],
    ['Tarif Team', { plan: 'team' }],
    ['Abo', { billing: { plan: 'team', status: 'active' } }],
    ['Freischaltung', { grant: { plan: 'team', until: inDays(365) } }],
    ['Gründerplatz', { founder: true }],
    ['Gründer seit', { founderSince: Timestamp.now() }],
    ['Sperre mit Konten (die das Backend beim Entsperren wieder freigibt)', { suspended: { at: Timestamp.now(), accounts: [OTHER] } }],
  ]) {
    test(`mit ${what}: abgelehnt`, async () => {
      const data = Object.fromEntries(Object.entries(appShop(OWNER, extra)).filter(([, v]) => v !== undefined));
      await assertFails(addDoc(collection(as(OWNER), 'shops'), data));
    });
  }

  test('nicht unter der ID eines gelöschten Ladens', async () => {
    await backend((db) => setDoc(doc(db, 'deleted_shops', 'alt'), { owner: OWNER, deletedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(as(OWNER), 'shops', 'alt'), appShop(OWNER)));
  });
});

describe('Laden ändern', () => {
  test('Mein Laden speichern (EditShopForm → updateShop, setDoc mit merge)', async () => {
    await seedShop();
    await assertSucceeds(setDoc(doc(as(OWNER), 'shops', SHOP), {
      name: 'Salon Neu', street: 'Weg 2', city: 'Ort', postalCode: '54321', ownerName: 'Inhaberin', phone: '2', email: 'neu@example.com',
      website: 'https://example.com', description: 'Text', businessHours: '', businessHoursByDay: [], industry: 'friseur', logoUrl: '',
      timeSlotBuffer: 3_600_000, updatedAt: Timestamp.now(),
    }, { merge: true }));
  });

  test('Assistent ein zweites Mal (shop-setup.ts: updateShop mit den Daten des Assistenten)', async () => {
    await seedShop();
    const { plan, trialEndsAt, owner, createdAt, ...data } = appShop(OWNER);
    await assertSucceeds(setDoc(doc(as(OWNER), 'shops', SHOP), data, { merge: true }));
  });

  test('Startklar-Merker setzen und (hilfe-bilder.cjs) wieder wegnehmen', async () => {
    await seedShop();
    await assertSucceeds(setDoc(doc(as(OWNER), 'shops', SHOP), { onboarding: { plakatAt: Timestamp.now() } }, { merge: true }));
    await assertSucceeds(updateDoc(doc(as(OWNER), 'shops', SHOP), { name: 'Salon Test', onboarding: deleteField() }));
  });

  test('Tarif-Felder unverändert mitgeschickt: erlaubt, und was das Backend gesetzt hat, bleibt', async () => {
    await seedShop({
      billing: { plan: 'laden', status: 'active', interval: 'monat', currentPeriodEnd: inDays(20), cancelAtPeriodEnd: false },
      grant: { plan: 'team', until: inDays(10) }, founder: true, founderSince: inDays(-5),
    });
    const db = as(OWNER);
    const current = (await getDoc(doc(db, 'shops', SHOP))).data();
    await assertSucceeds(setDoc(doc(db, 'shops', SHOP), { ...current, name: 'Salon Neu' }));
    const after = (await getDoc(doc(db, 'shops', SHOP))).data();
    assert.equal(after.name, 'Salon Neu');
    assert.equal(after.grant.plan, 'team');
    assert.equal(after.billing.status, 'active');
  });

  for (const [what, change, seed] of [
    ['Testphase verlängern', { trialEndsAt: inDays(365) }],
    ['Testphase verkürzen (auch das nur das Backend)', { trialEndsAt: inDays(-1) }],
    ['Testphase entfernen (zählt dann ab createdAt)', { trialEndsAt: deleteField() }],
    ['Tarif', { plan: 'team' }],
    ['Abo eintragen', { billing: { plan: 'team', status: 'active' } }],
    ['Abo-Stand ändern', { 'billing.status': 'active' }, { billing: { plan: 'laden', status: 'canceled' } }],
    ['Freischaltung eintragen', { grant: { plan: 'team', until: inDays(365) } }],
    ['Freischaltung verlängern', { 'grant.until': inDays(365) }, { grant: { plan: 'team', until: inDays(10) } }],
    ['Gründerplatz', { founder: true }],
    ['Gründer seit', { founderSince: Timestamp.now() }],
    ['sich selbst sperren', { suspended: { at: Timestamp.now() } }],
    ['Sperre aufheben', { suspended: null }, { suspended: { at: inDays(-1), accounts: [] } }],
    ['Sperre löschen', { suspended: deleteField() }, { suspended: { at: inDays(-1), accounts: [] } }],
    ['Inhaber wechseln', { owner: OTHER }],
    ['Anlegedatum ändern', { createdAt: inDays(5) }],
  ]) {
    test(`Inhaber: ${what} – abgelehnt`, async () => {
      await seedShop(seed);
      await assertFails(updateDoc(doc(as(OWNER), 'shops', SHOP), { ...change, updatedAt: Timestamp.now() }));
    });
  }

  test('Team, fremdes Konto, ohne Anmeldung: nicht einmal den Namen', async () => {
    await seedShop();
    for (const db of [as(TEAM), as(OTHER), anon()]) {
      await assertFails(setDoc(doc(db, 'shops', SHOP), { name: 'Übernommen', updatedAt: Timestamp.now() }, { merge: true }));
      await assertFails(setDoc(doc(db, 'shops', SHOP), { onboarding: { plakatAt: Timestamp.now() } }, { merge: true }));
    }
  });

  test('Backend (Admin SDK) setzt Tarif-Felder, der Inhaber ändert danach weiter seinen Laden', async () => {
    await seedShop();
    await backend((db) => updateDoc(doc(db, 'shops', SHOP), {
      grant: { plan: 'laden', until: inDays(90) }, trialEndsAt: inDays(90), founder: true, founderSince: Timestamp.now(),
      suspended: { at: Timestamp.now(), accounts: [OWNER] }, 'billing.plan': 'team', plan: 'team',
    }));
    await backend((db) => updateDoc(doc(db, 'shops', SHOP), { suspended: null }));
    await assertSucceeds(updateDoc(doc(as(OWNER), 'shops', SHOP), { name: 'Salon Neu', updatedAt: Timestamp.now() }));
  });
});

describe('Laden löschen', () => {
  test('ohne Vermerk: abgelehnt', async () => {
    await seedShop();
    await assertFails(deleteDoc(doc(as(OWNER), 'shops', SHOP)));
  });

  test('mit Vermerk im selben Schritt: erlaubt; dieselbe ID danach nicht mehr', async () => {
    await seedShop();
    await assertSucceeds(deleteShop(as(OWNER), SHOP, OWNER));
    await assertFails(setDoc(doc(as(OWNER), 'shops', SHOP), appShop(OWNER)));
    await assertFails(setDoc(doc(as(OWNER), 'shops', SHOP), appShop(OWNER, { trialEndsAt: inDays(-1) })));
  });

  test('fremder Laden: abgelehnt, auch mit Vermerk', async () => {
    await seedShop();
    await assertFails(deleteShop(as(OTHER), SHOP, OTHER));
    await assertFails(deleteShop(as(TEAM), SHOP, TEAM));
    await assertFails(deleteShop(as(OTHER), SHOP, OWNER));
  });

  test('Vermerk allein (Laden bleibt), ändern, lesen oder löschen: abgelehnt', async () => {
    await seedShop();
    await assertFails(setDoc(doc(as(OWNER), 'deleted_shops', SHOP), { owner: OWNER, deletedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(as(OWNER), 'deleted_shops', 'gibtsnicht'), { owner: OWNER }));
    await assertSucceeds(deleteShop(as(OWNER), SHOP, OWNER));
    await assertFails(getDoc(doc(as(OWNER), 'deleted_shops', SHOP)));
    await assertFails(deleteDoc(doc(as(OWNER), 'deleted_shops', SHOP)));
    await assertFails(setDoc(doc(as(OWNER), 'deleted_shops', SHOP), { owner: OWNER, deletedAt: inDays(1) }));
  });
});

describe('Ohne Anmeldung: Läden finden, buchen, Nummer ziehen', () => {
  test('alle Läden lesen (Läden finden, Karte, Buchen) und einen Laden live (Wartezimmer-Bildschirm)', async () => {
    await seedShop();
    const db = anon();
    await assertSucceeds(getDocs(collection(db, 'shops')));
    await assertSucceeds(getDoc(doc(db, 'shops', SHOP)));
    await assertSucceeds(getDocs(query(collection(db, 'staff'), where('shopId', '==', SHOP))));
    await assertSucceeds(getDocs(query(collection(db, 'services'), where('shopId', '==', SHOP))));
    await assertSucceeds(getDocs(query(collection(db, 'breaks'), where('staffId', '==', STAFF))));
    await assertSucceeds(getDocs(query(collection(db, 'recurring-breaks'), where('staffId', '==', STAFF))));
  });

  test('freie Plätze, Nummernseite, Bildschirm: nur die Kurzfassung der Termine (Person/Laden und Tag)', async () => {
    await seedShop();
    await seedAppointment('t1', { isAnonymous: true, customerPhone: '0170 1' });
    const db = anon();
    await assertSucceeds(getDocs(query(collection(db, 'public_appointments'), where('staffDay', 'in', [`${STAFF}_${TODAY}`, `${STAFF}_2099-01-01`]))));
    await assertSucceeds(getDocs(query(collection(db, 'public_appointments'), where('staffDay', '==', `${STAFF}_${TODAY}`))));
    await assertSucceeds(getDocs(query(collection(db, 'public_appointments'), where('shopDay', '==', `${SHOP}_${TODAY}`))));
    const view = await assertSucceeds(getDoc(doc(db, 'public_appointments', 't1')));
    assert.equal(view.data().customerName, undefined);
    assert.equal(view.data().customerPhone, undefined);
  });

  test('Termine selbst (Name, Handynummer, E-Mail, Konto): ohne Anmeldung weder einzeln noch als Liste', async () => {
    await seedShop();
    await seedAppointment('t1', { isAnonymous: true, customerPhone: '0170 1', notifyEmail: 'gast@example.com' });
    const db = anon();
    await assertFails(getDoc(doc(db, 'appointments', 't1')));
    await assertFails(getDocs(query(collection(db, 'appointments'), where('staffId', '==', STAFF), where('startTime', '>=', inDays(0)), where('startTime', '<', inDays(1)))));
    await assertFails(getDocs(query(collection(db, 'appointments'), where('shopId', '==', SHOP))));
    await assertFails(getDocs(collection(db, 'appointments')));
  });

  test('Nummer ziehen ohne Konto, zweite Nummer am Tag; zurückgeben geht nur übers Backend (mit Schlüssel)', async () => {
    await seedShop();
    const db = anon();
    const first = await assertSucceeds(drawNumber(db, anonTicket()));
    await assertSucceeds(drawNumber(db, anonTicket({ customerName: 'Gast 2' }), 'B07'));
    await assertFails(cancel(db, first.id));
    await assertFails(getDoc(doc(db, 'appointments', first.id)));
    await assertSucceeds(getDoc(doc(db, 'public_appointments', first.id)));
  });

  test('Nummer ohne Konto ohne Hash des Schlüssels: abgelehnt', async () => {
    await seedShop();
    await assertFails(drawNumber(anon(), ticket({ isAnonymous: true })));
    await assertFails(drawNumber(anon(), anonTicket({ ticketKeyHash: 'abc' })));
  });

  test('alte Warteschlange: eigene abfragen ja, fremde und schreiben nein', async () => {
    const db = as(OTHER);
    await assertSucceeds(getDocs(query(collection(db, 'queue'), where('shopId', '==', SHOP), where('customerId', '==', OTHER), where('status', '==', 'waiting'))));
    await assertFails(getDocs(query(collection(db, 'queue'), where('shopId', '==', SHOP))));
    await assertFails(getDocs(query(collection(anon(), 'queue'), where('shopId', '==', SHOP))));
    await assertFails(addDoc(collection(db, 'queue'), { shopId: SHOP, customerId: OTHER, status: 'waiting' }));
  });
});

describe('Termine: Nummer ziehen und buchen', () => {
  test('mit Konto für sich selbst: Nummer (queue) und Termin (booked)', async () => {
    await seedShop();
    await assertSucceeds(drawNumber(as(OTHER), ticket({ customerId: OTHER, customerPhone: '0170', checkEarlierOptions: true, checkEarlierOptionsCreatedAt: Timestamp.now() })));
    await assertSucceeds(addDoc(collection(as(OTHER), 'appointments'), ticket({ customerId: OTHER, type: 'booked' })));
  });

  for (const [what, db, data] of [
    ['ohne Konto auf ein fremdes Konto', () => anon(), anonTicket({ customerId: OTHER })],
    ['mit Konto auf ein anderes Konto', () => as(OTHER), ticket({ customerId: TEAM })],
    ['ohne Konto als Termin statt Nummer', () => anon(), anonTicket({ type: 'booked' })],
    ['gleich aufgerufen', () => anon(), anonTicket({ status: 'in-progress' })],
    ['mit Aufrufzeit', () => anon(), anonTicket({ calledAt: Timestamp.now() })],
    ['mit Nachricht an den Kunden', () => as(OTHER), ticket({ customerId: OTHER, customerNotice: 'moved' })],
    ['bei einer Person eines anderen Ladens', () => anon(), anonTicket({ staffId: STAFF2 })],
    ['bei einer Person, die es nicht gibt', () => anon(), anonTicket({ staffId: 'gibtsnicht' })],
    ['ohne Laden', () => anon(), anonTicket({ shopId: 'gibtsnicht' })],
  ]) {
    test(`${what}: abgelehnt`, async () => {
      await seedShop();
      await assertFails(addDoc(collection(db(), 'appointments'), data));
    });
  }

  test('gesperrter Laden: Kunden ziehen keine Nummer, der Inhaber trägt weiter ein', async () => {
    await seedShop({ suspended: { at: Timestamp.now(), accounts: [] } });
    await assertFails(drawNumber(anon(), anonTicket()));
    await assertFails(addDoc(collection(as(OTHER), 'appointments'), ticket({ customerId: OTHER })));
    await assertSucceeds(addDoc(collection(as(OWNER), 'appointments'), ticket({ customerId: 'walk-in' })));
  });

  test('Belegung: falsche ID, fremde Felder oder Person eines anderen Ladens – abgelehnt', async () => {
    await seedShop();
    const db = anon();
    const slots = { x: { start: START, end: END } };
    await assertFails(setDoc(doc(db, 'schedules', `${STAFF}_2099-01-01`), { shopId: SHOP, staffId: STAFF, day: TODAY, slots, updatedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(db, 'schedules', `${STAFF}_${TODAY}`), { shopId: SHOP, staffId: STAFF, day: TODAY, slots, updatedAt: Timestamp.now(), extra: 1 }));
    await assertFails(setDoc(doc(db, 'schedules', `${STAFF2}_${TODAY}`), { shopId: SHOP, staffId: STAFF2, day: TODAY, slots, updatedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(doc(db, 'schedules', `${STAFF}_${TODAY}`), { shopId: SHOP, staffId: STAFF, day: TODAY, slots, updatedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(db, 'schedules', `${STAFF}_${TODAY}`), { shopId: SHOP2, staffId: STAFF, day: TODAY, slots, updatedAt: Timestamp.now() }));
    await assertFails(deleteDoc(doc(db, 'schedules', `${STAFF}_${TODAY}`)));
  });

  test('Tagesnummern: nur genau eine dazu, keine weg', async () => {
    await seedShop();
    const db = anon();
    const ref = doc(db, 'shop_days', `${SHOP}_${TODAY}`);
    await assertFails(setDoc(ref, { shopId: SHOP, day: TODAY, codes: ['A1', 'A2'], updatedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(ref, { shopId: SHOP, day: TODAY, codes: ['A1'], updatedAt: Timestamp.now() }));
    await assertFails(setDoc(ref, { shopId: SHOP, day: TODAY, codes: [], updatedAt: Timestamp.now() }));
    await assertFails(setDoc(ref, { shopId: SHOP, day: TODAY, codes: ['A2'], updatedAt: Timestamp.now() }));
    await assertFails(setDoc(ref, { shopId: SHOP, day: TODAY, codes: ['A1', 'A2', 'A3'], updatedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(ref, { shopId: SHOP, day: TODAY, codes: ['A1', 'A2'], updatedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(db, 'shop_days', `${SHOP}_2099-01-01`), { shopId: SHOP, day: TODAY, codes: ['A1'], updatedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(db, 'shop_days', `gibtsnicht_${TODAY}`), { shopId: 'gibtsnicht', day: TODAY, codes: ['A1'], updatedAt: Timestamp.now() }));
  });
});

describe('Kurzfassung der Termine (public_appointments)', () => {
  test('nur als genaue Kopie des Termins: andere Zeit, anderer Status, Name dabei, falscher Tag – abgelehnt', async () => {
    await seedShop();
    for (const view of [
      (a) => ({ ...publicOf(a), status: 'completed' }),
      (a) => ({ ...publicOf(a), startTime: inDays(2) }),
      (a) => ({ ...publicOf(a), referenceCode: '99' }),
      (a) => ({ ...publicOf(a), customerName: a.customerName }),
      (a) => ({ ...publicOf(a), staffDay: `${STAFF2}_${TODAY}` }),
      (a) => ({ ...publicOf(a), shopDay: 'irgendwas' }),
      (a) => { const { isAnonymous, ...rest } = publicOf(a); return rest; },
    ]) {
      await assertFails(drawNumber(anon(), anonTicket(), 'A12', view));
    }
    await assertSucceeds(drawNumber(anon(), anonTicket(), 'A12'));
  });

  test('ohne Termin oder unabhängig vom Termin: nichts anlegen, nichts verfälschen, nichts löschen', async () => {
    await seedShop();
    await seedAppointment('t1', { isAnonymous: true });
    const view = publicOf(ticket({ isAnonymous: true }));
    for (const db of [anon(), as(OTHER)]) {
      await assertFails(setDoc(doc(db, 'public_appointments', 'gibtsnicht'), { ...view }));
      await assertFails(setDoc(doc(db, 'public_appointments', 't1'), { ...view, status: 'cancelled' }));
      await assertFails(deleteDoc(doc(db, 'public_appointments', 't1')));
    }
    // Eine genaue Kopie zu schreiben schadet nicht (so gleicht auch ein Fenster mit altem Stand nichts falsch ab)
    await assertSucceeds(setDoc(doc(anon(), 'public_appointments', 't1'), view));
  });

  test('Kurzfassung eines gelöschten Termins: darf weg', async () => {
    await seedShop();
    await backend((db) => setDoc(doc(db, 'public_appointments', 'weg'), publicOf(ticket())));
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'public_appointments', 'weg')));
  });
});

describe('Termine: lesen, absagen, übernehmen, ändern', () => {
  test('lesen: Inhaber und Team den ganzen Laden (Tresen, Mein Tag), Kunde nur die eigenen, andere nichts', async () => {
    await seedShop();
    await seedAppointment('meins', { customerId: OTHER, customerPhone: '0170' });
    await seedAppointment('fremd', { customerId: 'jemand' });
    const range = (db) => query(collection(db, 'appointments'), where('shopId', '==', SHOP), where('startTime', '>=', inDays(0)), where('startTime', '<', inDays(1)));
    for (const db of [as(OWNER), as(TEAM)]) {
      await assertSucceeds(getDocs(range(db)));
      await assertSucceeds(getDocs(query(collection(db, 'appointments'), where('shopId', '==', SHOP))));
      await assertSucceeds(getDoc(doc(db, 'appointments', 'fremd')));
    }
    await assertSucceeds(getDocs(query(collection(as(OTHER), 'appointments'), where('customerId', '==', OTHER))));
    await assertSucceeds(getDoc(doc(as(OTHER), 'appointments', 'meins')));
    await assertFails(getDoc(doc(as(OTHER), 'appointments', 'fremd')));
    await assertFails(getDocs(range(as(OTHER))));
    await assertFails(getDocs(query(collection(as(OTHER), 'appointments'), where('customerId', '==', 'jemand'))));
    await assertFails(getDocs(query(collection(as(OWNER), 'appointments'), where('shopId', '==', SHOP2))));
  });

  test('ohne Konto: nichts an Terminen ändern, auch keine Nummer ohne Konto zurückgeben (das macht das Backend)', async () => {
    await seedShop();
    await seedAppointment('ohne', { isAnonymous: true, ticketKeyHash: KEY_HASH });
    await seedAppointment('mit', { customerId: OTHER });
    const db = anon();
    await assertFails(cancel(db, 'mit'));
    await assertFails(cancel(db, 'ohne'));
    await assertFails(setDoc(doc(db, 'appointments', 'ohne'), { status: 'cancelled', updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(db, 'appointments', 'ohne'), { startTime: inDays(2), updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(db, 'appointments', 'ohne'), { status: 'completed', updatedAt: Timestamp.now() }, { merge: true }));
  });

  test('Kunde: eigenen Termin absagen ja, fremden nein', async () => {
    await seedShop();
    await seedAppointment('meins', { customerId: OTHER });
    await seedAppointment('fremd', { customerId: 'jemand' });
    await assertFails(cancel(as(OTHER), 'fremd'));
    await assertSucceeds(cancel(as(OTHER), 'meins'));
  });

  test('Nummer ohne Konto ins eigene Konto übernehmen: im Browser nicht (das Backend prüft den Schlüssel)', async () => {
    await seedShop();
    await seedAppointment('ohne', { isAnonymous: true, ticketKeyHash: KEY_HASH });
    const claim = (db, uid = OTHER) =>
      setDoc(doc(db, 'appointments', 'ohne'), { customerId: uid, customerName: 'Kim', isAnonymous: false, updatedAt: Timestamp.now() }, { merge: true });
    await assertFails(claim(as(OTHER)));
    await assertFails(claim(as(OTHER), TEAM));
    await assertFails(claim(anon()));
  });

  test('Inhaber und Team: aufrufen, verschieben, ändern (mit Kurzfassung); nie in einen anderen Laden', async () => {
    await seedShop();
    await seedAppointment('t1', { isAnonymous: true });
    await assertSucceeds(change(as(OWNER), 't1', { status: 'in-progress', calledAt: Timestamp.now(), lastCalledAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    await assertSucceeds(change(as(TEAM), 't1', { status: 'completed', completedAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    await assertSucceeds(change(as(TEAM), 't1', { startTime: inDays(1), endTime: inDays(1.02), customerNotice: 'moved', updatedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(doc(as(TEAM), 'appointments', 't1'), { customerName: 'Kim', customerPhone: '0170', updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(as(OWNER), 'appointments', 't1'), { shopId: SHOP2 }, { merge: true }));
    await assertSucceeds(addDoc(collection(as(TEAM), 'appointments'), ticket({ customerId: 'walk-in', type: 'booked' })));
  });

  test('fremdes Konto: weder aufrufen noch verschieben noch löschen', async () => {
    await seedShop();
    await seedAppointment('t1', { customerId: 'jemand' });
    for (const db of [as(OTHER), anon()]) {
      await assertFails(setDoc(doc(db, 'appointments', 't1'), { status: 'in-progress', updatedAt: Timestamp.now() }, { merge: true }));
      await assertFails(setDoc(doc(db, 'appointments', 't1'), { startTime: inDays(2), updatedAt: Timestamp.now() }, { merge: true }));
      await assertFails(deleteDoc(doc(db, 'appointments', 't1')));
    }
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'appointments', 't1')));
  });
});

describe('Personen, Leistungen, Pausen', () => {
  test('Inhaber pflegt Leistungen, Personen und Pausen', async () => {
    await seedShop();
    const db = as(OWNER);
    await assertSucceeds(setDoc(doc(db, 'services', 'neu'), { id: 'neu', shopId: SHOP, name: 'Farbe', duration: 60, price: 50 }));
    await assertSucceeds(setDoc(doc(db, 'services', 'neu'), { archived: true, archivedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, 'staff', 'neu'), { id: 'neu', shopId: SHOP, name: 'Kim', isActive: true, userId: '' }));
    await assertSucceeds(setDoc(doc(db, 'staff', 'ich'), { id: 'ich', shopId: SHOP, name: 'Chefin', isActive: true, userId: OWNER }));
    await assertSucceeds(updateDoc(doc(db, 'staff', 'neu'), { userId: OWNER }));
    await assertSucceeds(setDoc(doc(db, 'staff', STAFF), { isActive: false, updatedAt: Timestamp.now() }, { merge: true }));
    const rb = await assertSucceeds(addDoc(collection(db, 'recurring-breaks'), { shopId: SHOP, staffId: STAFF, dayOfWeek: 1, startTime: '12:00', endTime: '13:00', active: true }));
    await assertSucceeds(updateDoc(rb, { active: false, updatedAt: Timestamp.now() }));
    await assertSucceeds(deleteDoc(rb));
    await assertSucceeds(setDoc(doc(db, 'breaks', 'neu'), { id: 'neu', shopId: SHOP, staffId: STAFF, startTime: inDays(1), endTime: inDays(1.1) }));
    await assertSucceeds(deleteDoc(doc(db, 'breaks', 'neu')));
  });

  test('Kontaktdaten der Personen: nur der Inhaber, nicht am öffentlichen Eintrag', async () => {
    await seedShop();
    const contact = (db, staffId = STAFF, data = { email: 'robin@example.com', phone: '0171', updatedAt: Timestamp.now() }) =>
      setDoc(doc(db, 'shops', SHOP, 'staff_contacts', staffId), data, { merge: true });
    // Neue Person wie createStaff: Eintrag und Kontaktdaten in einem Schritt
    const owner = as(OWNER);
    const batch = writeBatch(owner);
    batch.set(doc(owner, 'staff', 'neu'), { id: 'neu', shopId: SHOP, name: 'Kim', isActive: true, userId: '' });
    batch.set(doc(owner, 'shops', SHOP, 'staff_contacts', 'neu'), { email: 'kim@example.com', phone: '', updatedAt: Timestamp.now() });
    await assertSucceeds(batch.commit());
    await assertSucceeds(contact(as(OWNER)));
    await assertSucceeds(getDocs(collection(as(OWNER), 'shops', SHOP, 'staff_contacts')));
    for (const db of [as(TEAM), as(OTHER), anon()]) {
      await assertFails(getDocs(collection(db, 'shops', SHOP, 'staff_contacts')));
      await assertFails(getDoc(doc(db, 'shops', SHOP, 'staff_contacts', STAFF)));
      await assertFails(contact(db));
    }
    await assertFails(contact(as(OWNER), STAFF2));
    await assertFails(contact(as(OWNER), 'gibtsnicht'));
    await assertFails(contact(as(OWNER), STAFF, { inviteEmailTo: 'x@example.com' }));
    await assertFails(contact(as(OWNER), STAFF, { email: 'x@example.com', notiz: 'privat' }));
    await assertFails(setDoc(doc(as(OWNER), 'staff', 'neu2'), { shopId: SHOP, name: 'Kim', isActive: true, userId: '', email: 'kim@example.com' }));
    await assertFails(updateDoc(doc(as(OWNER), 'staff', STAFF), { phone: '0171' }));
    await assertFails(setDoc(doc(as(TEAM), 'staff', STAFF), { workingHours: [], email: 'robin@example.com' }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'shops', SHOP, 'staff_contacts', 'neu')));
  });

  test('Inhaber: kein fremdes Konto verbinden, keine Einladung schreiben, nichts in einen anderen Laden', async () => {
    await seedShop();
    const db = as(OWNER);
    await assertFails(setDoc(doc(db, 'staff', 'neu'), { shopId: SHOP, name: 'Kim', isActive: true, userId: OTHER }));
    await assertFails(setDoc(doc(db, 'staff', 'neu'), { shopId: SHOP, name: 'Kim', isActive: true, userId: '', inviteTokenHash: 'abc' }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { userId: OTHER }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { inviteExpires: inDays(30) }));
    await assertFails(updateDoc(doc(db, 'staff', STAFF), { shopId: SHOP2 }));
    await assertFails(setDoc(doc(db, 'staff', 'neu2'), { shopId: SHOP2, name: 'Kim', isActive: true, userId: '' }));
    await assertFails(setDoc(doc(db, 'services', 'neu'), { shopId: SHOP2, name: 'Farbe' }));
    await assertFails(updateDoc(doc(db, 'services', 'leistung1'), { shopId: SHOP2 }));
    await assertFails(setDoc(doc(db, 'breaks', 'neu'), { shopId: SHOP, staffId: STAFF2, startTime: inDays(1), endTime: inDays(1.1) }));
    await assertFails(addDoc(collection(db, 'recurring-breaks'), { shopId: SHOP, staffId: STAFF2, dayOfWeek: 1, startTime: '12:00', endTime: '13:00', active: true }));
  });

  test('Team: eigene Arbeitszeiten ja, sonst nichts an Personen, Leistungen, Pausen', async () => {
    await seedShop();
    const db = as(TEAM);
    await assertSucceeds(setDoc(doc(db, 'staff', STAFF), { workingHours: [{ dayOfWeek: 1, startTime: '08:00', endTime: '16:00', isWorking: true }], updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(db, 'staff', STAFF), { name: 'Chefin', updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(db, 'staff', STAFF), { isActive: false, workingHours: [] }, { merge: true }));
    await assertFails(setDoc(doc(db, 'staff', 'neu'), { shopId: SHOP, name: 'Kim', userId: '' }));
    await assertFails(setDoc(doc(db, 'services', 'neu'), { shopId: SHOP, name: 'Farbe' }));
    await assertFails(setDoc(doc(db, 'breaks', 'neu'), { shopId: SHOP, staffId: STAFF, startTime: inDays(1), endTime: inDays(1.1) }));
  });

  test('fremdes Konto und ohne Anmeldung: nicht ins Team eintragen, nichts ändern', async () => {
    await seedShop();
    for (const db of [as(OTHER), anon()]) {
      await assertFails(updateDoc(doc(db, 'staff', 'person1'), { userId: OTHER }));
      await assertFails(setDoc(doc(db, 'staff', 'neu'), { shopId: SHOP, name: 'Ich', isActive: true, userId: OTHER }));
      await assertFails(setDoc(doc(db, 'staff', STAFF), { workingHours: [] }, { merge: true }));
      await assertFails(updateDoc(doc(db, 'services', 'leistung1'), { price: 1 }));
      await assertFails(setDoc(doc(db, 'breaks', 'neu'), { shopId: SHOP, staffId: STAFF, startTime: inDays(1), endTime: inDays(1.1) }));
      await assertFails(addDoc(collection(db, 'recurring-breaks'), { shopId: SHOP, staffId: STAFF, dayOfWeek: 1, startTime: '00:00', endTime: '23:59', active: true }));
    }
  });
});

describe('Team-Vermerk', () => {
  test('Deaktivieren nimmt das Team-Recht, Zurückholen gibt es wieder', async () => {
    await seedShop();
    await backend((db) => setDoc(doc(db, 'customers', 'k1'), { shopId: SHOP, name: 'Kundin', isActive: false }));
    const kunden = () => getDocs(query(collection(as(TEAM), 'customers'), where('shopId', '==', SHOP)));
    await assertSucceeds(kunden());
    await assertSucceeds(deleteDoc(doc(as(OWNER), 'shops', SHOP, 'members', TEAM)));
    await assertFails(kunden());
    await assertFails(setDoc(doc(as(TEAM), 'appointments', 'x'), ticket({ customerId: 'walk-in' })));
    await assertSucceeds(setDoc(doc(as(OWNER), 'shops', SHOP, 'members', TEAM), { staffId: STAFF, at: Timestamp.now() }));
    await assertSucceeds(kunden());
  });

  test('nur für eine Person dieses Ladens mit genau diesem Konto; sonst niemand', async () => {
    await seedShop();
    await assertFails(setDoc(doc(as(OWNER), 'shops', SHOP, 'members', OTHER), { staffId: STAFF, at: Timestamp.now() }));
    await assertFails(setDoc(doc(as(OWNER), 'shops', SHOP, 'members', OTHER), { staffId: STAFF2, at: Timestamp.now() }));
    await assertFails(setDoc(doc(as(OTHER), 'shops', SHOP, 'members', OTHER), { staffId: STAFF, at: Timestamp.now() }));
    await assertFails(setDoc(doc(as(TEAM), 'shops', SHOP, 'members', TEAM), { staffId: STAFF, at: Timestamp.now(), role: 'chef' }));
    await assertFails(deleteDoc(doc(as(TEAM), 'shops', SHOP, 'members', TEAM)));
    await assertFails(getDoc(doc(anon(), 'shops', SHOP, 'members', TEAM)));
  });
});

describe('Kundenliste, Profile, Angebote', () => {
  test('Kundenliste: Inhaber und Team lesen und legen an; andere nicht', async () => {
    await seedShop();
    await backend((db) => setDoc(doc(db, 'customers', 'k1'), { shopId: SHOP, name: 'Kundin', email: 'k@example.com', isActive: false }));
    for (const db of [as(OWNER), as(TEAM)]) {
      await assertSucceeds(getDocs(query(collection(db, 'customers'), where('shopId', '==', SHOP))));
      await assertSucceeds(getDocs(query(collection(db, 'customers'), where('email', '==', 'k@example.com'), where('shopId', '==', SHOP))));
    }
    await assertSucceeds(setDoc(doc(as(TEAM), 'customers', 'k2'), { id: 'k2', shopId: SHOP, name: 'Neu', email: '', phone: '', isActive: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    for (const db of [as(OTHER), anon()]) {
      await assertFails(getDocs(query(collection(db, 'customers'), where('shopId', '==', SHOP))));
      await assertFails(getDoc(doc(db, 'customers', 'k1')));
      await assertFails(setDoc(doc(db, 'customers', 'k3'), { shopId: SHOP, name: 'X', isActive: false }));
    }
  });

  test('Kundenliste: kein Konto verbinden, nicht aktiv anlegen, nicht ändern', async () => {
    await seedShop();
    await backend((db) => setDoc(doc(db, 'customers', 'k1'), { shopId: SHOP, name: 'Kundin', isActive: false }));
    await assertFails(setDoc(doc(as(OWNER), 'customers', 'k2'), { shopId: SHOP, name: 'X', isActive: false, userId: OTHER }));
    await assertFails(setDoc(doc(as(OWNER), 'customers', 'k2'), { shopId: SHOP, name: 'X', isActive: true }));
    await assertFails(setDoc(doc(as(OWNER), 'customers', 'k2'), { shopId: SHOP, name: 'X', isActive: false, activationTokenHash: 'x' }));
    await assertFails(updateDoc(doc(as(OWNER), 'customers', 'k1'), { userId: OTHER }));
    await assertFails(updateDoc(doc(as(TEAM), 'customers', 'k1'), { name: 'Anders' }));
  });

  test('Profil: eigenes anlegen, ändern, lesen; fremdes weder lesen noch ändern', async () => {
    await backend((db) => setDoc(doc(db, 'users', TEAM), { uid: TEAM, email: 't@example.com', role: 'employee', phoneNumber: '0171' }));
    const db = as(OTHER);
    await assertSucceeds(setDoc(doc(db, 'users', OTHER), { uid: OTHER, email: 'k@example.com', role: 'customer', createdAt: Timestamp.now() }));
    await assertSucceeds(updateDoc(doc(db, 'users', OTHER), { displayName: 'Kim', phoneNumber: '0170', updatedAt: Timestamp.now() }));
    await assertSucceeds(getDoc(doc(db, 'users', OTHER)));
    await assertFails(updateDoc(doc(db, 'users', OTHER), { role: 'admin' }));
    await assertFails(getDoc(doc(db, 'users', TEAM)));
    await assertFails(getDoc(doc(as(OWNER), 'users', OTHER)));
    await assertFails(getDocs(collection(anon(), 'users')));
    await assertFails(updateDoc(doc(db, 'users', TEAM), { role: 'customer' }));
    await assertFails(setDoc(doc(anon(), 'users', OTHER), { role: 'shopOwner' }));
  });

  test('Angebote „Früher dran“: eigene lesen, der Laden räumt auf; fremde nicht, schreiben nur das Backend', async () => {
    await seedShop();
    await backend((db) => setDoc(doc(db, 'earlier_slot_notifications', 'n1'), { userId: OTHER, shopId: SHOP, isAccepted: false }));
    await assertSucceeds(getDocs(query(collection(as(OTHER), 'earlier_slot_notifications'), where('userId', '==', OTHER), where('isAccepted', '==', false))));
    await assertSucceeds(getDoc(doc(as(OTHER), 'earlier_slot_notifications', 'n1')));
    await assertSucceeds(getDocs(query(collection(as(OWNER), 'earlier_slot_notifications'), where('shopId', '==', SHOP))));
    await assertFails(getDocs(query(collection(as(TEAM), 'earlier_slot_notifications'), where('userId', '==', OTHER))));
    await assertFails(getDoc(doc(anon(), 'earlier_slot_notifications', 'n1')));
    await assertFails(setDoc(doc(as(OTHER), 'earlier_slot_notifications', 'n2'), { userId: OTHER, shopId: SHOP, isAccepted: true }));
    await assertFails(updateDoc(doc(as(OTHER), 'earlier_slot_notifications', 'n1'), { isAccepted: true }));
  });
});

describe('Nur das Backend', () => {
  for (const path of ['meta/gruender', 'push_subscriptions/abc', 'staff-invitations/abc', 'verzeichnis/abc', 'unbekannt/abc']) {
    test(`${path}: im Browser weder lesen noch schreiben`, async () => {
      await backend((db) => setDoc(doc(db, path), { count: 3 }));
      for (const db of [anon(), as(OWNER)]) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { count: 0 }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(getDocs(collection(anon(), path.split('/')[0])));
    });
  }
});
