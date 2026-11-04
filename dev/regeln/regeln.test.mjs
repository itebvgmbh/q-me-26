// Prüft firestore.rules im Firestore-Emulator: npm test (in dev/regeln, Anleitung README.md).
// Seit Fassung 2026-11-04 (Stufe 2, requirements/eigene-datenbank.md) liest und schreibt der Browser nichts mehr selbst:
// Für jedes Konto – ohne Anmeldung, Kunde, Team, Inhaber – ist jede Sammlung zu. „backend“ schreibt wie das Admin SDK
// ohne Regeln und kommt weiter überall hin.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, setLogLevel, Timestamp, updateDoc, where } from 'firebase/firestore';

// Abgelehnte Zugriffe sind hier gewollt; ohne das meldet das SDK jeden einzeln
setLogLevel('silent');

const OWNER = 'inhaberin';
const TEAM = 'robin';
const KUNDIN = 'kundin';
const SHOP = 'laden1';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dranzeit',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

/** Wie das Backend mit dem Admin SDK: Regeln gelten nicht */
const backend = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const KONTEN = {
  'ohne Anmeldung': () => env.unauthenticatedContext().firestore(),
  Kundin: () => env.authenticatedContext(KUNDIN).firestore(),
  Team: () => env.authenticatedContext(TEAM).firestore(),
  Inhaberin: () => env.authenticatedContext(OWNER).firestore(),
};

// Alles, was es in der Datenbank gibt (wie in Betrieb), je mit einem Eintrag des Ladens bzw. des Kontos
const EINTRAEGE = [
  ['shops', SHOP, { name: 'Salon', owner: OWNER, plan: 'gratis' }],
  [`shops/${SHOP}/members`, TEAM, { staffId: 'person1' }],
  [`shops/${SHOP}/staff_contacts`, 'person1', { email: 'robin@example.com' }],
  ['staff', 'person1', { shopId: SHOP, name: 'Robin', userId: TEAM, isActive: true }],
  ['services', 'leistung1', { shopId: SHOP, name: 'Schnitt', duration: 30 }],
  ['appointments', 'termin1', { shopId: SHOP, staffId: 'person1', customerId: KUNDIN, customerName: 'Kara', status: 'scheduled' }],
  ['public_appointments', 'termin1', { shopId: SHOP, staffId: 'person1', status: 'scheduled', staffDay: 'person1_2026-11-10' }],
  ['schedules', 'person1_2026-11-10', { shopId: SHOP, slots: {} }],
  ['shop_days', `${SHOP}_2026-11-10`, { codes: ['12'] }],
  ['customers', 'kunde1', { shopId: SHOP, name: 'Kara', userId: KUNDIN }],
  ['users', KUNDIN, { uid: KUNDIN, role: 'customer' }],
  ['users', OWNER, { uid: OWNER, role: 'shopOwner' }],
  ['users', TEAM, { uid: TEAM, role: 'employee' }],
  ['breaks', 'pause1', { shopId: SHOP, staffId: 'person1' }],
  ['recurring-breaks', 'fest1', { shopId: SHOP, staffId: 'person1', dayOfWeek: 2 }],
  ['earlier_slot_notifications', 'angebot1', { shopId: SHOP, userId: KUNDIN, isAccepted: false }],
  ['push_subscriptions', KUNDIN, { token: 'x' }],
  ['meta', 'founders', { count: 1 }],
  ['verzeichnis', 'eintrag1', { name: 'Salon ohne Vertrag' }],
  ['deleted_shops', 'alt1', { owner: OWNER }],
];

const anlegen = () =>
  backend(async (db) => {
    for (const [pfad, id, daten] of EINTRAEGE) await setDoc(doc(db, pfad, id), { ...daten, createdAt: Timestamp.now() });
  });

for (const [konto, db] of Object.entries(KONTEN)) {
  describe(konto, () => {
    test('liest nichts, auch nicht das Eigene', async () => {
      await anlegen();
      for (const [pfad, id] of EINTRAEGE) await assertFails(getDoc(doc(db(), pfad, id)));
      await assertFails(getDocs(collection(db(), 'shops')));
      await assertFails(getDocs(query(collection(db(), 'public_appointments'), where('staffDay', '==', 'person1_2026-11-10'))));
      await assertFails(getDocs(query(collection(db(), 'appointments'), where('customerId', '==', KUNDIN))));
    });

    test('schreibt nichts: anlegen, ändern, löschen', async () => {
      await anlegen();
      for (const [pfad, id, daten] of EINTRAEGE) {
        await assertFails(setDoc(doc(db(), pfad, `${id}-neu`), daten));
        await assertFails(updateDoc(doc(db(), pfad, id), { geaendert: true }));
        await assertFails(deleteDoc(doc(db(), pfad, id)));
      }
      await assertFails(addDoc(collection(db(), 'shops'), { name: 'Neu', owner: OWNER }));
      await assertFails(addDoc(collection(db(), 'appointments'), { shopId: SHOP, status: 'scheduled' }));
    });
  });
}

test('das Backend (Admin SDK) kommt weiter überall hin', async () => {
  await anlegen();
  await backend(async (db) => {
    for (const [pfad, id] of EINTRAEGE) await assertSucceeds(getDoc(doc(db, pfad, id)));
    await assertSucceeds(updateDoc(doc(db, 'shops', SHOP), { name: 'Salon 2' }));
  });
});
