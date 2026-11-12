/**
 * Logo von der Webseite (components/setup/LogoVonWebseite.tsx) im Browser zu PNG machen: Der Bild-Upload nimmt nur
 * PNG, JPEG und WebP, und SVG soll nie auf den Server. Längste Seite höchstens 400 px, Transparenz bleibt.
 */

export const LOGO_MAX_SEITE = 400;

const base64ZuBytes = (base64: string) => {
  const binaer = atob(base64);
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i);
  return bytes;
};

const bytesZuBase64 = (bytes: Uint8Array): string => {
  let binaer = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binaer);
};

/** Ein SVG ohne feste Größe (nur viewBox) hat im <img> keine natürliche Größe – Breite und Höhe passend setzen */
const svgMitGroesse = (dataUrl: string, maxSeite: number): string => {
  const text = new TextDecoder().decode(base64ZuBytes(dataUrl.split(',')[1] ?? ''));
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('Logo: kein lesbares SVG');
  const zahl = (wert: string | null) => (wert && /^\s*[\d.]+\s*(px)?\s*$/.test(wert) ? parseFloat(wert) : NaN);
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let breite = zahl(svg.getAttribute('width'));
  let hoehe = zahl(svg.getAttribute('height'));
  if (!(breite > 0 && hoehe > 0)) {
    const mitBox = box.length === 4 && box[2] > 0 && box[3] > 0;
    breite = mitBox ? box[2] : maxSeite;
    hoehe = mitBox ? box[3] : maxSeite;
  }
  // Vektor: immer auf die volle Größe bringen, sonst wird ein 100-px-SVG unscharf
  const faktor = maxSeite / Math.max(breite, hoehe);
  svg.setAttribute('width', String(Math.max(1, Math.round(breite * faktor))));
  svg.setAttribute('height', String(Math.max(1, Math.round(hoehe * faktor))));
  const neu = new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
  return `data:image/svg+xml;base64,${bytesZuBase64(neu)}`;
};

/**
 * Bild (data-URL, auch SVG) als PNG-data-URL, längste Seite höchstens maxSeite. Wirft, wenn der Browser das Bild
 * nicht lesen kann oder die Zeichenfläche sperrt (SecurityError) – die Oberfläche sagt das dann freundlich.
 */
export const alsPng = async (dataUrl: string, maxSeite = LOGO_MAX_SEITE): Promise<string> => {
  const src = dataUrl.startsWith('data:image/svg+xml') ? svgMitGroesse(dataUrl, maxSeite) : dataUrl;
  const bild = new Image();
  await new Promise<void>((resolve, reject) => {
    bild.onload = () => resolve();
    bild.onerror = () => reject(new Error('Logo: Bild lässt sich nicht laden'));
    bild.src = src;
  });
  const breite = bild.naturalWidth;
  const hoehe = bild.naturalHeight;
  if (!breite || !hoehe) throw new Error('Logo: Bild ohne Größe');
  const faktor = Math.min(1, maxSeite / Math.max(breite, hoehe));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(breite * faktor));
  canvas.height = Math.max(1, Math.round(hoehe * faktor));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Logo: keine Zeichenfläche');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bild, 0, 0, canvas.width, canvas.height); // Zeichenfläche ist durchsichtig, PNG behält das
  return canvas.toDataURL('image/png');
};

/** data-URL als Datei für den Bild-Upload (utils/firestore/storage.ts) */
export const dataUrlAlsDatei = (dataUrl: string, name: string): File => {
  const [kopf, daten = ''] = dataUrl.split(',');
  const typ = /^data:([^;,]+)/.exec(kopf)?.[1] || 'image/png';
  return new File([base64ZuBytes(daten)], name, { type: typ });
};
