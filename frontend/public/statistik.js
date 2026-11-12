/*
 * Google Analytics 4 (Property „Dranzeit“, Mess-ID G-RG8P11CJNJ) nur mit Einwilligung – Google Consent Mode v2.
 *
 * Eingebunden in frontend/index.html (React-App) und backend/app/seo.py (_page: Stadt-, Verzeichnis-, Hilfe- und
 * Vergleichsseiten vom Backend). Eine Datei für beide, damit Regeln und Mess-ID nur an einer Stelle stehen.
 *
 * - Grundeinstellung: alle vier Signale „denied“. Ohne Einwilligung lädt gtag.js gar nicht – keine Anfrage an Google,
 *   kein Cookie. Erst „Alle akzeptieren“ (oder die gespeicherte Wahl) erteilt analytics_storage und lädt das Tag.
 *   Die Werbe-Signale bleiben immer „denied“: Es gibt kein Werbe-Tag.
 * - Wahl in localStorage „dranzeit:cookies“: „alle“ oder „notwendig“. Banner: frontend/src/components/CookieBanner.tsx
 *   (App) und COOKIE_BANNER in backend/app/seo.py (Seiten vom Backend), beide mit Link „Cookie-Einstellungen“.
 * - Nie in der App aus Google Play/App Store (dort steht „kein Tracking“ in den Datenschutz-Angaben, mobile/README.md;
 *   Erkennung wie frontend/src/utils/app-shell.ts) und nie auf dem Wartezimmer-Bildschirm (/bildschirm/…). Der Kasten
 *   für fremde Webseiten (/einbau/…, backend/app/einbau.py) bindet diese Datei gar nicht ein.
 * - Nur diese eine Mess-ID. Kein Google-Ads-Tag, kein Meta-Pixel.
 * - Seitenaufrufe in der React-App zählt GA4 selbst (Optimierte Messung: Seitenwechsel über den Browserverlauf).
 * - Ereignisse: sign_up (Laden registriert), laden_eingerichtet (Einrichtung fertig), generate_lead (Nummer/Termin).
 * - Anzeigen auf Facebook/Instagram kommen mit utm_*-Angaben (Plan: dranzeit-marketing/meta-2026-11). Stimmt jemand
 *   erst nach einem Seitenwechsel zu, gibt starten() die Angaben der Einstiegsseite mit (kampagne).
 */
(function () {
  var ID = 'G-RG8P11CJNJ';
  var SPEICHER = 'dranzeit:cookies';
  var w = window;

  function wahl() {
    try {
      var wert = localStorage.getItem(SPEICHER);
      return wert === 'alle' || wert === 'notwendig' ? wert : null;
    } catch (e) {
      return null;
    }
  }

  function inStoreApp() {
    var a = null;
    try { a = sessionStorage.getItem('dranzeit:app'); } catch (e) { /* ohne Speicher */ }
    if (a === 'android' || a === 'ios') return true;
    var p = new URLSearchParams(location.search).get('app');
    return p === 'android' || p === 'ios' || document.referrer.indexOf('android-app://de.dranzeit.app') === 0 ||
      /\bDranzeitApp\/ios\b/.test(navigator.userAgent);
  }

  var aus = inStoreApp() || location.pathname.indexOf('/bildschirm/') === 0;

  w.dataLayer = w.dataLayer || [];
  if (typeof w.gtag !== 'function') w.gtag = function () { w.dataLayer.push(arguments); };
  var gtag = w.gtag;
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  var gestartet = false;
  var erteilt = !aus && wahl() === 'alle';
  function laden() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
  }
  // Kampagnenangaben (utm_*) der Einstiegsadresse, z. B. aus einer Anzeige auf Facebook oder Instagram. Wer erst auf
  // einer späteren Seite der React-App zustimmt, wird so trotzdem der Kampagne zugeordnet. Nur im Speicher dieser
  // Seite, nie in localStorage/sessionStorage (das bräuchte vor der Einwilligung selbst eine, § 25 TDDDG).
  var FELDER = { utm_source: 'campaign_source', utm_medium: 'campaign_medium', utm_campaign: 'campaign_name',
    utm_content: 'campaign_content', utm_term: 'campaign_term', utm_id: 'campaign_id' };
  function kampagneIn(suche) {
    var q = new URLSearchParams(suche);
    if (!q.get('utm_source')) return null;
    var k = {};
    for (var f in FELDER) if (q.get(f)) k[FELDER[f]] = q.get(f).slice(0, 100);
    return k;
  }
  var kampagne = kampagneIn(location.search);

  // gtag.js erst nach dem Laden der Seite (Ladezeit auf dem Handy). Aufrufe davor warten in dataLayer.
  function starten(sofort) {
    if (gestartet || aus) return;
    gestartet = true;
    gtag('js', new Date());
    // Steht die Kampagne noch in der Adresse, liest GA4 sie selbst
    if (kampagne && !kampagneIn(location.search)) gtag('config', ID, kampagne);
    else gtag('config', ID);
    if (sofort && document.readyState === 'complete') return laden();
    var spaeter = function () {
      setTimeout(function () {
        if ('requestIdleCallback' in w) w.requestIdleCallback(laden, { timeout: 3000 });
        else setTimeout(laden, 1500);
      }, 1500);
    };
    if (document.readyState === 'complete') spaeter();
    else w.addEventListener('load', spaeter, { once: true });
  }

  // Cookies von Google Analytics (_ga, _ga_<ID>) beim Widerruf entfernen – auf der Domain und ihrer Hauptdomain
  function cookiesLoeschen() {
    var domain = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^_ga(_|$)/.test(name)) return;
      var weg = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = weg;
      document.cookie = weg + '; domain=' + domain;
      document.cookie = weg + '; domain=.' + domain;
    });
  }

  w.dranzeitStatistik = {
    // true: hier nie messen und keinen Banner zeigen
    get aus() { return aus; },
    // „alle“, „notwendig“ oder null (noch nicht gefragt)
    wahl: wahl,
    setzen: function (erlaubt) {
      try { localStorage.setItem(SPEICHER, erlaubt ? 'alle' : 'notwendig'); } catch (e) { /* gilt dann nur jetzt */ }
      erteilt = !aus && !!erlaubt;
      // Nach einem Widerruf schickt ein schon geladenes gtag.js gar nichts mehr, auch keine cookielosen Pings
      w['ga-disable-' + ID] = !erteilt;
      gtag('consent', 'update', { analytics_storage: erteilt ? 'granted' : 'denied' });
      if (erteilt) starten(true);
      else cookiesLoeschen();
    },
    // Wartezimmer-Bildschirm, in der App erreicht (Gerät startet auf / und springt dorthin): ab jetzt nichts mehr
    abschalten: function () {
      aus = true;
      erteilt = false;
      w['ga-disable-' + ID] = true;
    },
    // Ereignis nur mit Einwilligung; Werte ohne personenbezogene Daten
    ereignis: function (name, werte) {
      if (!erteilt) return;
      gtag('event', name, werte || {});
    }
  };

  if (erteilt) {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    starten(false);
  }
})();
