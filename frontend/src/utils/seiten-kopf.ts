// Titel, Beschreibung und Canonical der öffentlichen Seiten der App – für Suchmaschinen und Link-Vorschauen.
// Beim Bauen bekommt jede dieser Seiten eine eigene HTML-Datei mit fertigem Kopf (vite.config.ts, seitenKoepfe;
// Caddy liefert /preise als preise.html aus), in der App setzt <SeitenKopf /> dieselben Angaben beim Seitenwechsel.
// Alle übrigen Seiten der App (Konto, Tresen, Buchung, 404) kommen nicht in den Suchindex.
// Seiten vom Server (Hilfe, Salon-Verzeichnis, Stadtseiten, sitemap.xml): backend/app/seo.py.
// Nur reine Daten und DOM-Aufrufe: vite.config.ts lädt diese Datei beim Bauen.

export const SITE_URL = 'https://dranzeit.de';
export const OG_BILD = `${SITE_URL}/og-bild.png`;
const OG_BILD_ALT = 'Dranzeit: digitale Wartemarke mit Nummer 14, drei Personen vor dir, dran um ca. 11:52';

export interface Kopf {
  title: string;
  description: string;
}

export const STANDARD_KOPF: Kopf = {
  title: 'Dranzeit – Nummer ziehen beim Friseur, ohne Termin',
  description:
    'Beim Friseur oder Barbershop von unterwegs in die Schlange einreihen oder einen Termin buchen. Ohne App, ohne Konto – wir sagen Bescheid, wenn du dran bist.',
};

// Preise wie in utils/plans.ts (netto je Monat)
export const OEFFENTLICHE_SEITEN: Record<string, Kopf> = {
  '/': STANDARD_KOPF,
  '/features': {
    title: 'Friseur-Software für Laufkundschaft und Termine | Dranzeit',
    description:
      'Digitale Warteschlange für Friseure und Barbershops: Kunden ziehen per QR-Code eine Nummer und warten draußen. Termine und Schlange in einer Ansicht.',
  },
  '/preise': {
    title: 'Preise: fester Monatspreis, keine Provision | Dranzeit',
    description:
      'Gratis für eine Person, Solo 19 €, Laden 39 €, Team 59 € im Monat (netto). Monatlich kündbar, 30 Tage kostenlos testen, ohne Zahlungsdaten.',
  },
  '/shop-map': {
    title: 'Friseure und Barbershops in deiner Nähe finden | Dranzeit',
    description:
      'Läden auf der Karte finden, Öffnungszeiten und Preise ansehen und bei Dranzeit-Läden online eine Nummer ziehen.',
  },
  '/impressum': { title: 'Impressum | Dranzeit', description: 'Anbieter von Dranzeit: ITEBV GmbH, Berlin. Anschrift, Kontakt und Registerangaben.' },
  '/datenschutz': {
    title: 'Datenschutzerklärung | Dranzeit',
    description: 'Welche Daten Dranzeit verarbeitet, wofür, wie lange und welche Rechte du hast.',
  },
  '/agb': {
    title: 'Allgemeine Geschäftsbedingungen | Dranzeit',
    description: 'AGB von Dranzeit für Läden: Leistungen, Testphase, Preise und Zahlung, Laufzeit, Kündigung und Auftragsverarbeitung.',
  },
};

/** Ältere Schreibweisen der App, die auf dieselbe Seite führen */
export const ALIASE: Record<string, string> = { '/shopmap': '/shop-map' };

/** Seiten, die ihren Kopf selbst setzen (Name des Ladens, Canonical aufs Salon-Verzeichnis) */
export const EIGENER_KOPF = new Set(['/shop-details', '/shopdetails']);

export const normalisiere = (pfad: string) => (pfad.length > 1 ? pfad.replace(/\/+$/, '') : pfad).toLowerCase();

export const canonicalUrl = (pfad: string) => SITE_URL + pfad;

const JSON_LD_START = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organisation`,
    name: 'Dranzeit',
    legalName: 'ITEBV GmbH',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    email: 'hilfe@dranzeit.de',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Zehntwerderweg 201A',
      postalCode: '13469',
      addressLocality: 'Berlin',
      addressCountry: 'DE',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'Dranzeit',
    url: `${SITE_URL}/`,
    inLanguage: 'de-DE',
    publisher: { '@id': `${SITE_URL}/#organisation` },
  },
];

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kopf als HTML für die gebauten Dateien. pfad null = Rückfalldatei für alle übrigen Adressen (ohne Canonical). */
export function kopfHtml(pfad: string | null): string {
  const kopf = (pfad && OEFFENTLICHE_SEITEN[pfad]) || STANDARD_KOPF;
  const url = pfad ? canonicalUrl(pfad) : null;
  const zeilen = [
    `<title>${attr(kopf.title)}</title>`,
    `<meta name="description" content="${attr(kopf.description)}">`,
    url && `<link rel="canonical" href="${attr(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="de_DE">`,
    `<meta property="og:site_name" content="Dranzeit">`,
    `<meta property="og:title" content="${attr(kopf.title)}">`,
    `<meta property="og:description" content="${attr(kopf.description)}">`,
    url && `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:image" content="${OG_BILD}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${attr(OG_BILD_ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    pfad === '/' &&
      `<script type="application/ld+json">${JSON.stringify(JSON_LD_START).replace(/</g, '\\u003c')}</script>`,
  ];
  return zeilen.filter(Boolean).join('\n  ');
}

function setzeMeta(art: 'name' | 'property', schluessel: string, wert: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${art}="${schluessel}"]`);
  if (wert === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(art, schluessel);
    document.head.appendChild(el);
  }
  el.setAttribute('content', wert);
}

/** Kopf in der laufenden App setzen. canonical null = keiner; robots z. B. "noindex" */
export function setzeKopf({ title, description, canonical, robots }: Kopf & { canonical: string | null; robots: string | null }) {
  document.title = title;
  setzeMeta('name', 'description', description);
  setzeMeta('property', 'og:title', title);
  setzeMeta('property', 'og:description', description);
  setzeMeta('property', 'og:url', canonical);
  setzeMeta('name', 'robots', robots);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = canonical;
}
