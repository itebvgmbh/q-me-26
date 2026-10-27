// Erzeugt das Android-Projekt (Trusted Web Activity) aus twa-manifest.json neu – nach jeder Änderung dort.
// Ohne Rückfragen und ohne JDK, anders als "bubblewrap init/update". Die Symbole lädt es von dranzeit.de.
// Schreibt auch frontend/public/.well-known/assetlinks.json aus "fingerprints": Nur mit dem richtigen
// Fingerabdruck zeigt Android die Seite ohne Adresszeile.
//
//   cd android && npm ci && npm run erzeugen
//
// Danach den Unterschied ansehen (git diff) und appVersionCode in twa-manifest.json für jede neue Store-Fassung
// um eins erhöhen. Gebaut wird in GitHub Actions (.github/workflows/android.yml), Anleitung in README.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConsoleLog, DigitalAssetLinks, TwaGenerator, TwaManifest } from "@bubblewrap/core";

const ordner = path.dirname(fileURLToPath(import.meta.url));
const manifest = await TwaManifest.fromFile(path.join(ordner, "twa-manifest.json"));
const fehler = manifest.validate();
if (fehler) throw new Error(`twa-manifest.json: ${fehler}`);
await new TwaGenerator().createTwaProject(ordner, manifest, new ConsoleLog("erzeugen"));

const fingerabdruecke = manifest.fingerprints.map((f) => f.value);
const assetlinks = path.join(ordner, "../frontend/public/.well-known/assetlinks.json");
fs.mkdirSync(path.dirname(assetlinks), { recursive: true });
fs.writeFileSync(
  assetlinks,
  fingerabdruecke.length ? `${DigitalAssetLinks.generateAssetLinks(manifest.packageId, ...fingerabdruecke)}\n` : "[]\n",
);
console.log(`Fertig: ${manifest.packageId} ${manifest.appVersionName} (${manifest.appVersionCode}), Start ${manifest.startUrl}`);
console.log(`assetlinks.json: ${fingerabdruecke.length} Fingerabdruck/-drücke`);
