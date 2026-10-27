import { merke } from '@/i18n';

/**
 * Typische Leistungen je Branche (IDs aus industries.ts) für den Einrichtungsassistenten.
 * Dauer in Minuten, Preise als übliche Richtwerte – der Betrieb passt sie beim Antippen an.
 * "common" ist vorausgewählt: das, was fast jeder Betrieb der Branche anbietet.
 * Name und Kategorie sind deutsche Schlüssel (merke). Übersetzt werden sie beim Bereitlegen (withTemplates in
 * shop-setup.ts) und so gespeichert – auf Deutsch bleibt also alles wie bisher.
 */
export interface ServiceTemplate {
  name: string;
  category: string;
  duration: number;
  price: number;
  common?: boolean;
}

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate[]> = {
  barbershop: [
    { name: merke('Herrenhaarschnitt'), category: merke('Herren'), duration: 30, price: 28, common: true },
    { name: merke('Maschinenschnitt'), category: merke('Herren'), duration: 20, price: 18 },
    { name: merke('Bart trimmen'), category: merke('Herren'), duration: 15, price: 15, common: true },
    { name: merke('Haarschnitt und Bart'), category: merke('Herren'), duration: 45, price: 40, common: true },
    { name: merke('Kinderhaarschnitt'), category: merke('Kinder'), duration: 20, price: 16, common: true },
    { name: merke('Waschen, Schneiden, Föhnen'), category: merke('Damen'), duration: 60, price: 52, common: true },
    { name: merke('Schneiden und Föhnen (kurz)'), category: merke('Damen'), duration: 45, price: 42 },
    { name: merke('Föhnen / Styling'), category: merke('Damen'), duration: 30, price: 28 },
    { name: merke('Ansatzfarbe'), category: merke('Farbe'), duration: 90, price: 55, common: true },
    { name: merke('Strähnen / Balayage'), category: merke('Farbe'), duration: 150, price: 110 },
    { name: merke('Hochsteckfrisur'), category: merke('Anlass'), duration: 60, price: 55 },
  ],
  nailstudio: [
    { name: merke('Maniküre'), category: merke('Hände'), duration: 45, price: 30, common: true },
    { name: merke('Maniküre mit Lack'), category: merke('Hände'), duration: 60, price: 38 },
    { name: merke('Shellac / Gel-Lack'), category: merke('Hände'), duration: 60, price: 38, common: true },
    { name: merke('Neumodellage Gel'), category: merke('Nägel'), duration: 120, price: 60, common: true },
    { name: merke('Auffüllen Gel'), category: merke('Nägel'), duration: 90, price: 45, common: true },
    { name: merke('Ablösen'), category: merke('Nägel'), duration: 30, price: 15 },
    { name: merke('Pediküre'), category: merke('Füße'), duration: 60, price: 38, common: true },
    { name: merke('Pediküre mit Lack'), category: merke('Füße'), duration: 75, price: 45 },
  ],
  beautysalon: [
    { name: merke('Klassische Gesichtsbehandlung'), category: merke('Gesicht'), duration: 75, price: 65, common: true },
    { name: merke('Augenbrauen zupfen und formen'), category: merke('Augen'), duration: 15, price: 12, common: true },
    { name: merke('Wimpern färben'), category: merke('Augen'), duration: 15, price: 14, common: true },
    { name: merke('Augenbrauen färben'), category: merke('Augen'), duration: 10, price: 10 },
    { name: merke('Wimpernlifting'), category: merke('Augen'), duration: 60, price: 55, common: true },
    { name: merke('Make-up'), category: merke('Gesicht'), duration: 45, price: 45 },
    { name: merke('Waxing Beine komplett'), category: merke('Haarentfernung'), duration: 45, price: 40 },
    { name: merke('Waxing Achseln'), category: merke('Haarentfernung'), duration: 15, price: 15 },
  ],
  physiotherapy: [
    { name: merke('Krankengymnastik'), category: merke('Therapie'), duration: 25, price: 30, common: true },
    { name: merke('Manuelle Therapie'), category: merke('Therapie'), duration: 25, price: 38, common: true },
    { name: merke('Manuelle Lymphdrainage (45 Min.)'), category: merke('Therapie'), duration: 45, price: 40, common: true },
    { name: merke('Klassische Massage'), category: merke('Massage'), duration: 30, price: 32, common: true },
    { name: merke('Krankengymnastik am Gerät'), category: merke('Therapie'), duration: 60, price: 40 },
    { name: merke('Wärmetherapie / Fango'), category: merke('Ergänzung'), duration: 20, price: 15 },
    { name: merke('Erstbefund'), category: merke('Therapie'), duration: 30, price: 35 },
  ],
  massage: [
    { name: merke('Rückenmassage'), category: merke('Massage'), duration: 30, price: 35, common: true },
    { name: merke('Ganzkörpermassage (60 Min.)'), category: merke('Massage'), duration: 60, price: 65, common: true },
    { name: merke('Ganzkörpermassage (90 Min.)'), category: merke('Massage'), duration: 90, price: 90 },
    { name: merke('Hot-Stone-Massage'), category: merke('Wellness'), duration: 75, price: 80, common: true },
    { name: merke('Fußreflexzonenmassage'), category: merke('Wellness'), duration: 45, price: 50, common: true },
    { name: merke('Kopf- und Nackenmassage'), category: merke('Massage'), duration: 20, price: 25 },
  ],
  automotive: [
    { name: merke('Ölwechsel'), category: merke('Wartung'), duration: 45, price: 79, common: true },
    { name: merke('Inspektion'), category: merke('Wartung'), duration: 120, price: 189, common: true },
    { name: merke('Räder wechseln'), category: merke('Reifen'), duration: 30, price: 35, common: true },
    { name: merke('Reifen montieren und wuchten'), category: merke('Reifen'), duration: 45, price: 60 },
    { name: merke('HU/AU'), category: merke('Prüfung'), duration: 60, price: 145, common: true },
    { name: merke('Klimaservice'), category: merke('Wartung'), duration: 60, price: 99 },
    { name: merke('Fehlerspeicher auslesen'), category: merke('Diagnose'), duration: 30, price: 40 },
    { name: merke('Bremsen prüfen'), category: merke('Diagnose'), duration: 30, price: 25 },
  ],
  coaching: [
    { name: merke('Erstgespräch'), category: merke('Beratung'), duration: 30, price: 0, common: true },
    { name: merke('Einzelsitzung (50 Min.)'), category: merke('Beratung'), duration: 50, price: 90, common: true },
    { name: merke('Einzelsitzung (90 Min.)'), category: merke('Beratung'), duration: 90, price: 150 },
    { name: merke('Online-Sitzung'), category: merke('Beratung'), duration: 50, price: 90 },
    { name: merke('Paarberatung'), category: merke('Beratung'), duration: 60, price: 120 },
  ],
};

/** Ohne Branche: ein neutraler Termin zum Umbenennen */
export const GENERIC_TEMPLATES: ServiceTemplate[] = [
  { name: merke('Termin (30 Min.)'), category: '', duration: 30, price: 0, common: true },
  { name: merke('Termin (60 Min.)'), category: '', duration: 60, price: 0 },
];

export const templatesFor = (industry?: string | null): ServiceTemplate[] =>
  (industry && SERVICE_TEMPLATES[industry]) || GENERIC_TEMPLATES;
