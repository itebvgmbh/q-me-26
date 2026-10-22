// Welche Browser nehmen gleich die einfache Verbindungsart (frontend/src/utils/connection.ts)? Ohne Browser:
//   node --experimental-strip-types dev/verbindung.test.mjs
import { isSafariEngine } from '../frontend/src/utils/connection.ts';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  playwright: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36',
};

const cases = [
  ['iPhone Safari', isSafariEngine(UA.iphoneSafari, 'iPhone', 5), true],
  ['iPhone Chrome', isSafariEngine(UA.iphoneChrome, 'iPhone', 5), true],
  ['iPhone Firefox', isSafariEngine(UA.iphoneFirefox, 'iPhone', 5), true],
  ['iPhone App-Ansicht (Home-Bildschirm)', isSafariEngine(UA.iphoneApp, 'iPhone', 5), true],
  ['iPad Desktop-Ansicht', isSafariEngine(UA.ipadDesktop, 'MacIntel', 5), true],
  ['Mac Safari', isSafariEngine(UA.macSafari, 'MacIntel', 0), true],
  ['Mac Chrome', isSafariEngine(UA.macChrome, 'MacIntel', 0), false],
  ['Mac Firefox', isSafariEngine(UA.macFirefox, 'MacIntel', 0), false],
  ['Windows Chrome', isSafariEngine(UA.windowsChrome, 'Win32', 0), false],
  ['Windows Edge', isSafariEngine(UA.windowsEdge, 'Win32', 0), false],
  ['Android Chrome', isSafariEngine(UA.androidChrome, 'Linux armv8l', 5), false],
  ['Android Samsung', isSafariEngine(UA.androidSamsung, 'Linux armv8l', 5), false],
  ['Playwright (Chromium)', isSafariEngine(UA.playwright, 'Win32', 0), false],
];

let ok = true;
for (const [name, got, want] of cases) {
  const pass = got === want;
  ok &&= pass;
  console.log(`${pass ? 'OK  ' : 'FEHL'} ${name.padEnd(38)} ${pass ? '' : `erwartet ${want}, bekommen ${got}`}`);
}
console.log(ok ? 'Alles bestanden.' : 'Es gibt Fehler.');
process.exit(ok ? 0 : 1);
