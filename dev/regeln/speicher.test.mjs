// Prüft storage.rules im Storage-Emulator (zusammen mit dem Firestore-Emulator: die Regeln fragen dort nach dem
// Inhaber des Ladens). npm test in dev/regeln, Anleitung README.md. Hochgeladen wird wie in der App
// (frontend/src/utils/firestore/storage.ts): <ordner>/<shopId>/<zeit>_<dateiname>.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

const OWNER = 'inhaberin';
const TEAM = 'robin'; // Person im Team, nicht Inhaber
const OTHER = 'fremd';
const SHOP = 'laden1';
const SHOP2 = 'laden2'; // Laden von OTHER

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = { contentType: 'image/png' };

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dranzeit',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'shops', SHOP), { name: 'Salon Test', owner: OWNER });
    await setDoc(doc(db, 'shops', SHOP, 'members', TEAM), { staffId: 'person1' });
    await setDoc(doc(db, 'shops', SHOP2), { name: 'Anderer Laden', owner: OTHER });
  });
});

const storageOf = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const put = (uid, path, data = PNG, meta = image) => storageOf(uid).ref(path).put(data, meta);
/** Datei anlegen, wie sie schon da wäre (Regeln aus) */
const seed = (path) => env.withSecurityRulesDisabled((ctx) => ctx.storage().ref(path).put(PNG, image));

for (const folder of ['shop-logos', 'staff-profile-images']) {
  describe(folder, () => {
    const file = `${folder}/${SHOP}/1730000000000_bild.png`;

    test('Inhaber lädt hoch, ersetzt und löscht', async () => {
      await assertSucceeds(put(OWNER, file));
      await assertSucceeds(put(OWNER, file));
      await assertSucceeds(storageOf(OWNER).ref(file).delete());
    });

    test('ohne Anmeldung, fremdes Konto und Team: kein Hochladen', async () => {
      await assertFails(put(null, file));
      await assertFails(put(OTHER, file));
      await assertFails(put(TEAM, file));
    });

    test('nur in den eigenen Laden', async () => {
      await assertFails(put(OWNER, `${folder}/${SHOP2}/1_bild.png`));
      await assertFails(put(OWNER, `${folder}/gibt-es-nicht/1_bild.png`));
    });

    test('nur Bilder bis 2 MB', async () => {
      await assertFails(put(OWNER, file, PNG, { contentType: 'text/html' }));
      await assertFails(put(OWNER, file, new Uint8Array(2 * 1024 * 1024 + 1), image));
      await assertSucceeds(put(OWNER, file, new Uint8Array(1024 * 1024), { contentType: 'image/jpeg' }));
    });

    test('Bild ansehen geht ohne Anmeldung, auflisten nicht', async () => {
      await seed(file);
      await assertSucceeds(storageOf(null).ref(file).getMetadata());
      await assertFails(storageOf(null).ref(`${folder}/${SHOP}`).listAll());
      await assertFails(storageOf(OTHER).ref(`${folder}/${SHOP}`).listAll());
    });

    test('Löschen nur der Inhaber', async () => {
      await seed(file);
      await assertFails(storageOf(null).ref(file).delete());
      await assertFails(storageOf(OTHER).ref(file).delete());
      await assertFails(storageOf(TEAM).ref(file).delete());
      await assertSucceeds(storageOf(OWNER).ref(file).delete());
    });
  });
}

test('andere Ordner sind zu, auch für Inhaber', async () => {
  await assertFails(put(OWNER, `${SHOP}/1_bild.png`));
  await assertFails(put(OWNER, `undefined/1_bild.png`));
  await assertFails(put(OWNER, 'probe/bild.png'));
  await assertFails(storageOf(null).ref('').listAll());
});
