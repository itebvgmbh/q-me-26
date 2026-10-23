// JavaScript, das eine Seite beim ersten Aufruf lädt: Einstieg samt statischen Importen plus Baustein der Seite.
// Baut das Frontend dafür einmal mit Manifest in einen Temp-Ordner (frontend/dist bleibt unberührt).
//   node dev/bundle-groesse.cjs
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const OUT = path.join(os.tmpdir(), 'dranzeit-bundle-groesse');
const SEITEN = {
  '/': 'src/pages/App.tsx',
  '/public-join-queue': 'src/pages/PublicJoinQueue.tsx',
  '/nummer/:id': 'src/pages/Nummer.tsx',
  '/login': 'src/pages/Login.tsx',
  '/shop-map': 'src/pages/ShopMap.tsx',
  '/auswertung': 'src/pages/Auswertung.tsx',
};

execSync(`npx vite build --manifest --outDir "${OUT}" --emptyOutDir --logLevel error`, { cwd: FRONTEND, stdio: 'inherit' });
const manifestPath = [path.join(OUT, 'manifest.json'), path.join(OUT, '.vite', 'manifest.json')].find(fs.existsSync);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Statische Importe laden mit; dynamische (andere Seiten) erst beim Hinklicken
const statisch = (key, gesehen = new Set()) => {
  if (gesehen.has(key) || !manifest[key]) return gesehen;
  gesehen.add(key);
  for (const k of manifest[key].imports || []) statisch(k, gesehen);
  return gesehen;
};
const groesse = (dateien) => {
  let roh = 0;
  let gzip = 0;
  for (const datei of dateien) {
    const inhalt = fs.readFileSync(path.join(OUT, datei));
    roh += inhalt.length;
    gzip += zlib.gzipSync(inhalt, { level: 9 }).length;
  }
  return { roh, gzip };
};
const kb = (n) => `${(n / 1024).toFixed(0).padStart(5)} kB`;

const einstieg = statisch('index.html');
const zeilen = [['Einstieg (jede Seite)', einstieg]];
for (const [seite, quelle] of Object.entries(SEITEN)) {
  if (!manifest[quelle]) {
    console.log(`${seite}: ${quelle} nicht im Manifest`);
    continue;
  }
  zeilen.push([seite, statisch(quelle, new Set(einstieg))]);
}
console.log(`${'Seite'.padEnd(24)} ${'Dateien'.padStart(7)} ${'roh'.padStart(8)} ${'gzip'.padStart(8)}`);
for (const [name, keys] of zeilen) {
  const dateien = [...keys].map((k) => manifest[k].file).filter((f) => f.endsWith('.js'));
  const { roh, gzip } = groesse(dateien);
  console.log(`${name.padEnd(24)} ${String(dateien.length).padStart(7)} ${kb(roh)} ${kb(gzip)}`);
}
const groesste = fs.readdirSync(path.join(OUT, 'assets')).filter((f) => f.endsWith('.js'))
  .map((f) => [f, fs.statSync(path.join(OUT, 'assets', f)).size]).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\nGrößte Bausteine:');
for (const [f, n] of groesste) console.log(`  ${kb(n)}  ${f}`);
