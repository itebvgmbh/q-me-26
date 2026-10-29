// Logo und Foto einer Person im Testladen hochladen (wie „Mein Laden“ und „Team“), ansehen und wieder löschen.
// Prüft nach dem Einspielen von storage.rules, dass Inhaber weiter hochladen können (deploy/README.md,
// „Speicher-Regeln“). Was andere nicht dürfen, prüfen die Emulator-Tests in dev/regeln. Braucht den Entwicklungsserver.
const { BASE, launch, newPage, collectErrors, fixture, signIn, report, run } = require('./lib.cjs');

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await signIn(page, fx);
  const results = await page.evaluate(async (shopId) => {
    const { uploadImage } = await import('/src/utils/firestore/storage.ts');
    const { storage } = await import('/src/utils/firestore/firebase-client.ts');
    const src = await (await fetch('/src/utils/firestore/storage.ts')).text();
    const st = await import(src.match(/from "([^"]*firebase[^"]*storage[^"]*)"/)[1]);
    // 1×1 Pixel PNG
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const out = [];
    for (const folder of ['shop-logos', 'staff-profile-images']) {
      const row = { folder };
      try {
        const url = await uploadImage(new File([bytes], 'test.png', { type: 'image/png' }), `${folder}/${shopId}`);
        row.uploaded = true;
        row.viewable = (await fetch(url)).ok;
        await st.deleteObject(st.ref(storage, url));
        row.deleted = true;
      } catch (e) {
        row.error = String(e?.code || e).slice(0, 120);
      }
      out.push(row);
    }
    return out;
  }, fx.shopId);
  await browser.close();
  return report([
    ...results.flatMap((r) => [
      { name: `${r.folder}: hochladen`, pass: !!r.uploaded, detail: r.error ?? '' },
      { name: `${r.folder}: ohne Anmeldung ansehen`, pass: !!r.viewable },
      { name: `${r.folder}: wieder löschen`, pass: !!r.deleted },
    ]),
    { name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') },
  ]);
});
