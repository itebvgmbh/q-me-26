// Logo und Foto einer Person im Testladen hochladen (wie „Mein Laden“ und „Team“), ansehen und wieder löschen.
// Prüft nach dem Einspielen von storage.rules, dass Inhaber weiter hochladen können (deploy/README.md,
// „Speicher-Regeln“). Was andere nicht dürfen, prüfen die Emulator-Tests in dev/regeln. Braucht den Entwicklungsserver.
const { BASE, launch, newPage, collectErrors, fixture, signIn, report, run } = require('./lib.cjs');

/** Im Browser: Bild hochladen wie die App (utils/firestore/storage.ts), Rückgabe die Download-Adresse */
const upload = (page, folder, shopId) =>
  page.evaluate(
    async ({ folder, shopId }) => {
      const { uploadImage } = await import('/src/utils/firestore/storage.ts');
      // 1×1 Pixel PNG
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
      try {
        return { url: await uploadImage(new File([bytes], 'test.png', { type: 'image/png' }), `${folder}/${shopId}`) };
      } catch (e) {
        return { error: String(e?.code || e).slice(0, 120) };
      }
    },
    { folder, shopId },
  );

/** Im Browser löschen (als Inhaber) */
const remove = (page, url) =>
  page.evaluate(async (url) => {
    const { storage } = await import('/src/utils/firestore/firebase-client.ts');
    const src = await (await fetch('/src/utils/firestore/storage.ts')).text();
    const st = await import(src.match(/from "([^"]*firebase[^"]*storage[^"]*)"/)[1]);
    try {
      await st.deleteObject(st.ref(storage, url));
      return '';
    } catch (e) {
      return String(e?.code || e).slice(0, 120);
    }
  }, url);

run(async () => {
  const fx = fixture();
  const browser = await launch();
  const page = await newPage(browser);
  const errors = collectErrors(page);
  await signIn(page, fx);
  const rows = [];
  for (const folder of ['shop-logos', 'staff-profile-images']) {
    const { url, error } = await upload(page, folder, fx.shopId);
    rows.push({ name: `${folder}: hochladen`, pass: !!url, detail: error ?? '' });
    if (!url) continue;
    // Ansehen wie ein <img> auf der Buchungsseite: ohne Anmeldung, nicht aus dem Browser (dort fehlt CORS für localhost)
    const viewed = await fetch(url).then((r) => r.status).catch((e) => String(e));
    rows.push({ name: `${folder}: ohne Anmeldung ansehen`, pass: viewed === 200, detail: String(viewed) });
    const failed = await remove(page, url);
    rows.push({ name: `${folder}: wieder löschen`, pass: !failed, detail: failed || '' });
    if (failed) console.log(`Liegt noch im Speicher: ${decodeURIComponent(new URL(url).pathname.split('/o/')[1])}`);
  }
  rows.push({ name: 'Keine JavaScript-Fehler', pass: errors.length === 0, detail: errors.join(' | ') });
  await browser.close();
  return report(rows);
});
