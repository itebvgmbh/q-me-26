// Prüft die Übersetzungen (frontend/src/i18n): fehlt etwas, passen Platzhalter und Tags, steht noch deutscher Text ohne t() im Code?
//
//   node --experimental-strip-types dev/i18n-pruefen.mjs                 alle Dateien
//   node --experimental-strip-types dev/i18n-pruefen.mjs pages/Nummer.tsx components/queue   nur diese (Pfade unter frontend/src)
//   … --offen    zusätzlich: Zeilen, die nach deutschem Text ohne t() aussehen (Schätzung, Hilfe beim Umstellen)
//
// Ende mit Fehlercode 1, wenn Übersetzungen fehlen oder nicht passen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend/src");
const SPRACHEN = ["en", "tr", "ar"];
// Bleibt deutsch: Betreiber-Bereich und Werkzeuge nur für den Betreiber bzw. Entwickler, Rechtstexte (verbindlich nur
// auf Deutsch, LegalPage zeigt einen Hinweis), Seitenköpfe für Suchmaschinen (beim Bauen erzeugt), Firmenangaben
const AUSGENOMMEN = [
  /^i18n\//, /^brain\//, /^internal-components\//, /^constants\//,
  /^components\/betreiber\//, /^pages\/(Betreiber|CodeHealth|SchedulerControl)\.tsx$/,
  /^components\/(Scheduler\w+|NotificationHistoryTable)\.tsx$/, /^utils\/hooks\/useSchedulerControl\.ts$/,
  /^pages\/(Agb|Datenschutz|Impressum)\.tsx$/, /^utils\/seiten-kopf\.ts$/,
];

const argumente = process.argv.slice(2);
const offenZeigen = argumente.includes("--offen");
const filter = argumente.filter((a) => !a.startsWith("--")).map((a) => a.replace(/\\/g, "/").replace(/^(frontend\/)?src\//, ""));

const alleDateien = [];
(function sammle(ordner) {
  for (const name of fs.readdirSync(ordner)) {
    const voll = path.join(ordner, name);
    if (fs.statSync(voll).isDirectory()) sammle(voll);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) alleDateien.push(path.relative(WURZEL, voll).split(path.sep).join("/"));
  }
})(WURZEL);
const dateien = alleDateien
  .filter((d) => !AUSGENOMMEN.some((m) => m.test(d)))
  .filter((d) => !filter.length || filter.some((f) => d === f || d.startsWith(f.replace(/\/?$/, "/"))));

// --- Zeichenketten aus t(), tn(), tTeile(), merke() lesen ---
const AUFRUF = /(?<![\w$.])(t|tn|tTeile|merke)\(/g;

function leseZeichenkette(quelle, i) {
  while (/\s/.test(quelle[i])) i++;
  const zeichen = quelle[i];
  if (!["'", '"', "`"].includes(zeichen)) return { ende: i, wert: null };
  let wert = "";
  let j = i + 1;
  for (; j < quelle.length && quelle[j] !== zeichen; j++) {
    if (quelle[j] === "\\") {
      const n = quelle[++j];
      wert += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else if (zeichen === "`" && quelle[j] === "$" && quelle[j + 1] === "{") {
      return { ende: j, wert: null, vorlage: true };
    } else wert += quelle[j];
  }
  return { ende: j + 1, wert };
}

function ueberspringeArgument(quelle, i) {
  let tiefe = 0;
  for (; i < quelle.length; i++) {
    const z = quelle[i];
    if ("([{".includes(z)) tiefe++;
    else if (")]}".includes(z)) {
      if (tiefe === 0) return i;
      tiefe--;
    } else if (z === "," && tiefe === 0) return i;
    else if (z === "'" || z === '"' || z === "`") i = leseZeichenkette(quelle, i).ende - 1;
  }
  return i;
}

const zeileVon = (quelle, index) => quelle.slice(0, index).split("\n").length;

const verwendet = new Map(); // Schlüssel -> [Fundstellen]
const fehler = [];
const hinweise = [];

for (const datei of dateien) {
  const quelle = fs.readFileSync(path.join(WURZEL, datei), "utf8");
  const importiert = /from\s+["'][^"']*\bi18n(?:\/index(?:\.ts)?)?["']/.test(quelle);
  if (!importiert) continue;

  // Eigene Variable namens t überdeckt die Übersetzung
  const ueberdeckt = quelle.match(/(?:\(\s*t\s*[,)]|[,(]\s*t\s*\)|\bconst\s+t\s*=|\blet\s+t\s*=|\(\s*t\s*:\s*\w|\bt\s*=>|catch\s*\(\s*t\s*\))/);
  if (ueberdeckt) fehler.push(`${datei}:${zeileVon(quelle, ueberdeckt.index)}: eigene Variable "t" überdeckt die Übersetzungsfunktion – umbenennen`);

  for (const treffer of quelle.matchAll(AUFRUF)) {
    const funktion = treffer[1];
    let i = treffer.index + treffer[0].length;
    if (funktion === "tn") i = ueberspringeArgument(quelle, i) + 1; // Anzahl
    const erstes = leseZeichenkette(quelle, i);
    const ort = `${datei}:${zeileVon(quelle, treffer.index)}`;
    if (erstes.vorlage) {
      fehler.push(`${ort}: ${funktion}() mit \`…\${}\` – Werte als {platzhalter} übergeben`);
      continue;
    }
    if (erstes.wert === null) {
      // t(variable): Text kommt aus merke() oder ist Absicht (z. B. Daten aus der Datenbank)
      continue;
    }
    let schluessel = erstes.wert;
    if (funktion === "tn") {
      let k = erstes.ende;
      while (/\s/.test(quelle[k])) k++;
      if (quelle[k] !== ",") continue;
      const zweites = leseZeichenkette(quelle, k + 1);
      if (zweites.wert === null) {
        fehler.push(`${ort}: tn() braucht Einzahl und Mehrzahl als Text`);
        continue;
      }
      schluessel = zweites.wert;
      const platzE = [...erstes.wert.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => p !== "n").sort().join(",");
      const platzM = [...zweites.wert.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => p !== "n").sort().join(",");
      if (platzE !== platzM) fehler.push(`${ort}: Einzahl und Mehrzahl haben verschiedene Platzhalter`);
    }
    if (!schluessel.trim()) continue;
    if (!verwendet.has(schluessel)) verwendet.set(schluessel, []);
    verwendet.get(schluessel).push(ort);
  }
}

// --- Kataloge laden ---
const kataloge = {};
const herkunft = {}; // sprache -> schlüssel -> [bereiche]
for (const sprache of SPRACHEN) {
  const ordner = path.join(WURZEL, "i18n", sprache);
  herkunft[sprache] = {};
  for (const name of fs.readdirSync(ordner)) {
    if (["index.ts", "texte.ts"].includes(name)) continue;
    const modul = await import(pathToFileURL(path.join(ordner, name)).href);
    for (const [schluessel, wert] of Object.entries(modul.default)) {
      (herkunft[sprache][schluessel] ??= []).push({ bereich: name.replace(/\.ts$/, ""), wert });
    }
  }
  kataloge[sprache] = (await import(pathToFileURL(path.join(ordner, "texte.ts")).href)).default;
}

const platzhalter = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...s.matchAll(/<\/?(\w+)\/?>/g)].map((m) => m[0]).sort().join(",");

let fehlend = 0;
for (const [schluessel, orte] of verwendet) {
  for (const sprache of SPRACHEN) {
    const wert = kataloge[sprache][schluessel];
    if (wert === undefined) {
      fehlend++;
      fehler.push(`${orte[0]}: [${sprache}] fehlt: ${JSON.stringify(schluessel)}`);
      continue;
    }
    const formen = typeof wert === "string" ? [wert] : Object.values(wert);
    if (typeof wert !== "string" && typeof wert.other !== "string") fehler.push(`${orte[0]}: [${sprache}] Mehrzahl ohne "other": ${JSON.stringify(schluessel)}`);
    for (const form of formen) {
      if (!form.trim()) fehler.push(`${orte[0]}: [${sprache}] leer: ${JSON.stringify(schluessel)}`);
      // {n} darf in Mehrzahlformen fehlen ("one": "ein Termin")
      const erwartet = platzhalter(schluessel).split(",").filter((p) => typeof wert === "string" || p !== "n").join(",");
      const da = platzhalter(form).split(",").filter((p) => typeof wert === "string" || p !== "n").join(",");
      if (erwartet !== da) fehler.push(`${orte[0]}: [${sprache}] Platzhalter passen nicht (${erwartet || "keine"} ≠ ${da || "keine"}): ${JSON.stringify(schluessel)}`);
      if (tags(schluessel) !== tags(form)) fehler.push(`${orte[0]}: [${sprache}] Tags passen nicht: ${JSON.stringify(schluessel)}`);
    }
  }
}

// Doppelte Schlüssel mit verschiedener Übersetzung – nur Hinweis, gilt der spätere Bereich
for (const sprache of SPRACHEN) {
  for (const [schluessel, stellen] of Object.entries(herkunft[sprache])) {
    const werte = new Set(stellen.map((s) => JSON.stringify(s.wert)));
    if (werte.size > 1) hinweise.push(`[${sprache}] verschieden übersetzt in ${stellen.map((s) => s.bereich).join(", ")}: ${JSON.stringify(schluessel)}`);
  }
}

if (!filter.length) {
  for (const sprache of SPRACHEN) {
    const unbenutzt = Object.keys(kataloge[sprache]).filter((s) => !verwendet.has(s));
    if (unbenutzt.length) hinweise.push(`[${sprache}] ${unbenutzt.length} Einträge werden im Code nicht (mehr) als Text verwendet, z. B. ${unbenutzt.slice(0, 5).map((s) => JSON.stringify(s)).join(", ")}`);
  }
}

// --- Schätzung: deutscher Text ohne t() ---
const offen = [];
if (offenZeigen) {
  // Klassenlisten, Pfade, Bezeichner und Datumsmuster sind kein Text
  const keinText = (x) =>
    /^[\w:\[\]&>!\/.%#=()*+,@-]+(\s+[\w:\[\]&>!\/.%#=()*+,@-]+)*$/.test(x) && /(^|\s)[\w:\[\]&>!]*-/.test(x) ||
    /^(https?:|mailto:|\/|\.{1,2}\/|#|@)/.test(x) ||
    /^[a-z][\w.-]*$/.test(x) ||
    /^[A-Z_][A-Z0-9_]+$/.test(x) ||
    /^[yMdHhmsEaPp.,:'\s\/-]+$/.test(x);
  const textArtig = (x) => {
    const s = x.trim();
    if (!s || keinText(s)) return false;
    return /[äöüßÄÖÜ]/.test(s) || /[A-Za-z]{2,}[.,!?…]?\s+[A-Za-zÄÖÜäöü]{2,}/.test(s) || /^[A-ZÄÖÜ][a-zäöüß]{2,}[\s…?!:.]*$/.test(s);
  };
  for (const datei of dateien) {
    const zeilen = fs.readFileSync(path.join(WURZEL, datei), "utf8").split("\n");
    let imKommentar = false;
    zeilen.forEach((zeile, nr) => {
      const s = zeile.trim();
      if (imKommentar) {
        if (s.includes("*/")) imKommentar = false;
        return;
      }
      if (s.startsWith("/*") && !s.includes("*/")) {
        imKommentar = true;
        return;
      }
      if (/^(\/\/|\*|\/\*|\{\s*\/\*)/.test(s) || /console\.(log|error|warn|info|debug)|throw new Error|import |\.displayName = /.test(s)) return;
      // Fortsetzungszeilen von Code (Typen, Aufzählungen, Bedingungen)
      if (/^(type|interface|export|async|await|function|if|else|for|while|switch|case|return|const|let|var|key)\b/.test(s) || /(,|&&|\|\||\?|=>)$/.test(s) && !/["'`]/.test(s)) return;
      // Text in Anführungszeichen oder zwischen JSX-Tags, der nicht schon in t(…) steht
      const ohneT = s
        .replace(/(?<![\w$.])(t|tn|tTeile|merke)\((?:[^()]|\([^()]*\))*\)/g, "")
        .replace(/\/\/.*$/, "")
        .replace(/className=(["'`]).*?\1/g, "")
        .replace(/class(Name)?=\{[^}]*\}/g, "");
      // Schlüssel in Objekten und Vergleiche ("shopOwner") sind keine Anzeige
      const ohneCode = ohneT.replace(/\b(key|to|href|src|type|variant|size|role|side|align|name|id|path|value|mode|lang|dir|inputMode|autoComplete)=(["'])[^"']*\2/g, "");
      const texte = [...ohneCode.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      const jsx = [...ohneCode.matchAll(/>([^<>{}]+)(?=<|\{)/g)].map((m) => m[1]);
      const nurJsx = /^[^<>{}"'`=;()]+(\{' '\})?$/.test(ohneCode) && !/^(case |return|export|const|let|import|default|from|else|\}|\)|\]|[\w.]+,?$)/.test(ohneCode) ? [ohneCode.replace(/\{' '\}$/, "")] : [];
      if ([...texte, ...jsx, ...nurJsx].some(textArtig)) offen.push(`${datei}:${nr + 1}: ${s.slice(0, 140)}`);
    });
  }
}

for (const h of hinweise) console.log("Hinweis:", h);
if (offen.length) {
  console.log(`\nVermutlich noch ohne t() (${offen.length} Zeilen, Schätzung):`);
  for (const o of offen) console.log("  " + o);
}
if (fehler.length) {
  console.log(`\n${fehler.length} Fehler:`);
  for (const f of fehler) console.log("  " + f);
}
console.log(`\n${dateien.length} Dateien, ${verwendet.size} Texte, ${fehlend} fehlende Übersetzungen, ${fehler.length} Fehler.`);
process.exit(fehler.length ? 1 : 0);
