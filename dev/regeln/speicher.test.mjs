// Prüft storage.rules im Storage-Emulator. npm test in dev/regeln, Anleitung README.md.
// Seit Fassung 2026-11-04 (Stufe 2, requirements/eigene-datenbank.md) lädt die App neue Bilder zum eigenen Server hoch.
// Im Speicher liegen nur noch ältere Logos und Fotos: ansehen geht ohne Anmeldung, sonst ist alles zu – auch für den
// Inhaber des Ladens.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

const OWNER = 'inhaberin';
const TEAM = 'robin';
const OTHER = 'fremd';
const SHOP = 'laden1';

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
    await setDoc(doc(ctx.firestore(), 'shops', SHOP), { name: 'Salon Test', owner: OWNER });
  });
});

const storageOf = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const put = (uid, path, data = PNG, meta = image) => storageOf(uid).ref(path).put(data, meta);
/** Datei anlegen, wie sie schon da wäre (Regeln aus) */
const seed = (path) => env.withSecurityRulesDisabled((ctx) => ctx.storage().ref(path).put(PNG, image));

for (const folder of ['shop-logos', 'staff-profile-images']) {
  describe(folder, () => {
    const file = `${folder}/${SHOP}/1730000000000_bild.png`;

    test('niemand lädt mehr hoch, auch der Inhaber nicht', async () => {
      for (const uid of [null, OTHER, TEAM, OWNER]) await assertFails(put(uid, file));
    });

    test('ältere Bilder ansehen geht ohne Anmeldung, auflisten nicht', async () => {
      await seed(file);
      await assertSucceeds(storageOf(null).ref(file).getMetadata());
      await assertFails(storageOf(null).ref(`${folder}/${SHOP}`).listAll());
      await assertFails(storageOf(OWNER).ref(`${folder}/${SHOP}`).listAll());
    });

    test('niemand ersetzt oder löscht', async () => {
      await seed(file);
      for (const uid of [null, OTHER, TEAM, OWNER]) {
        await assertFails(put(uid, file));
        await assertFails(storageOf(uid).ref(file).delete());
      }
    });
  });
}

test('andere Ordner sind zu', async () => {
  await assertFails(put(OWNER, `${SHOP}/1_bild.png`));
  await assertFails(put(OWNER, 'probe/bild.png'));
  await assertFails(storageOf(null).ref('').listAll());
});
