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
    await setDoc(doc(db, 'services', 'leistung1'), { shopId: SHOP, name: 'Schnitt', duration: 30, price: 20 });
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
    await assertSucceeds(getDocs(query(collection(db, 'appointments'), where('staffId', '==', STAFF), where('startTime', '>=', inDays(0)), where('startTime', '<', inDays(1)))));
  });

  test('Nummer ziehen: Termin, Belegung und Tagesnummer in einer Transaktion (appointments.ts createAppointment)', async () => {
    await seedShop();
    const db = anon();
    const day = new Date().toISOString().slice(0, 10);
    const appointment = doc(collection(db, 'appointments'));
    const start = inDays(0.1);
    const end = Timestamp.fromMillis(start.toMillis() + 30 * 60000);
    await assertSucceeds(runTransaction(db, async (tx) => {
      const schedule = await tx.get(doc(db, 'schedules', `${STAFF}_${day}`));
      const numbers = await tx.get(doc(db, 'shop_days', `${SHOP}_${day}`));
      const now = Timestamp.now();
      tx.set(appointment, {
        id: appointment.id, shopId: SHOP, staffId: STAFF, serviceId: 'leistung1', startTime: start, endTime: end, status: 'scheduled',
        type: 'queue', isAnonymous: true, customerName: 'Gast', checkEarlierOptions: false, referenceCode: 'A12', createdAt: now, updatedAt: now,
      });
      tx.set(schedule.ref, { shopId: SHOP, staffId: STAFF, day, slots: { [appointment.id]: { start, end } }, updatedAt: now });
      tx.set(numbers.ref, { shopId: SHOP, day, codes: [...(numbers.data()?.codes || []), 'A12'], updatedAt: now });
    }));

    // Absagen auf /nummer/<id> (cancelAppointment): Status und Belegung in einer Transaktion
    await assertSucceeds(runTransaction(db, async (tx) => {
      const snap = await tx.get(appointment);
      const schedule = await tx.get(doc(db, 'schedules', `${STAFF}_${day}`));
      tx.set(snap.ref, { status: 'cancelled', updatedAt: Timestamp.now() }, { merge: true });
      tx.set(schedule.ref, { shopId: SHOP, staffId: STAFF, day, slots: {}, updatedAt: Timestamp.now() });
    }));
  });

  test('alte Warteschlange abfragen ja, schreiben nein', async () => {
    const db = as(OTHER);
    await assertSucceeds(getDocs(query(collection(db, 'queue'), where('shopId', '==', SHOP), where('customerId', '==', OTHER), where('status', '==', 'waiting'))));
    await assertFails(addDoc(collection(db, 'queue'), { shopId: SHOP, customerId: OTHER, status: 'waiting' }));
  });
});

describe('Offen wie bisher: Inhaber, Team, Kunden', () => {
  test('Inhaber pflegt Leistungen, Personen und Pausen', async () => {
    await seedShop();
    const db = as(OWNER);
    await assertSucceeds(setDoc(doc(db, 'services', 'neu'), { id: 'neu', shopId: SHOP, name: 'Farbe', duration: 60, price: 50 }));
    await assertSucceeds(setDoc(doc(db, 'staff', 'neu'), { id: 'neu', shopId: SHOP, name: 'Kim', isActive: true, userId: '' }));
    await assertSucceeds(addDoc(collection(db, 'recurring-breaks'), { shopId: SHOP, staffId: STAFF, dayOfWeek: 1, startTime: '12:00', endTime: '13:00', active: true }));
    await assertSucceeds(setDoc(doc(db, 'breaks', 'neu'), { id: 'neu', shopId: SHOP, staffId: STAFF, startTime: inDays(1), endTime: inDays(1.1) }));
  });

  test('Team: eigene Arbeitszeiten, Kunden anlegen, Termin aufrufen', async () => {
    await seedShop();
    const db = as(TEAM);
    await assertSucceeds(setDoc(doc(db, 'staff', STAFF), { workingHours: [{ dayOfWeek: 1, startTime: '08:00', endTime: '16:00', isWorking: true }] }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, 'customers', 'kunde1'), { id: 'kunde1', shopId: SHOP, name: 'Kundin', email: 'k@example.com', phone: '', isActive: false }));
    await backend((admin) => setDoc(doc(admin, 'appointments', 't1'), { shopId: SHOP, staffId: STAFF, status: 'scheduled' }));
    await assertSucceeds(setDoc(doc(db, 'appointments', 't1'), { status: 'in-progress', calledAt: Timestamp.now() }, { merge: true }));
  });

  test('Kunde: eigenes Profil anlegen und ändern, Angebote lesen', async () => {
    const db = as(OTHER);
    await assertSucceeds(setDoc(doc(db, 'users', OTHER), { uid: OTHER, email: 'k@example.com', role: 'customer', createdAt: Timestamp.now() }));
    await assertSucceeds(updateDoc(doc(db, 'users', OTHER), { displayName: 'Kim', phoneNumber: '0170', updatedAt: Timestamp.now() }));
    await assertSucceeds(getDocs(query(collection(db, 'earlier_slot_notifications'), where('userId', '==', OTHER), where('isAccepted', '==', false))));
  });
});

describe('Nur das Backend', () => {
  for (const path of ['meta/gruender', 'push_subscriptions/abc', 'staff-invitations/abc', 'unbekannt/abc']) {
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
