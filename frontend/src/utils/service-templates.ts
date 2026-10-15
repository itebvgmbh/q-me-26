/**
 * Typische Leistungen je Branche (IDs aus industries.ts) für den Einrichtungsassistenten.
 * Dauer in Minuten, Preise als übliche Richtwerte – der Betrieb passt sie beim Antippen an.
 * "common" ist vorausgewählt: das, was fast jeder Betrieb der Branche anbietet.
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
    { name: 'Herrenhaarschnitt', category: 'Herren', duration: 30, price: 28, common: true },
    { name: 'Maschinenschnitt', category: 'Herren', duration: 20, price: 18 },
    { name: 'Bart trimmen', category: 'Herren', duration: 15, price: 15, common: true },
    { name: 'Haarschnitt und Bart', category: 'Herren', duration: 45, price: 40, common: true },
    { name: 'Kinderhaarschnitt', category: 'Kinder', duration: 20, price: 16, common: true },
    { name: 'Waschen, Schneiden, Föhnen', category: 'Damen', duration: 60, price: 52, common: true },
    { name: 'Schneiden und Föhnen (kurz)', category: 'Damen', duration: 45, price: 42 },
    { name: 'Föhnen / Styling', category: 'Damen', duration: 30, price: 28 },
    { name: 'Ansatzfarbe', category: 'Farbe', duration: 90, price: 55, common: true },
    { name: 'Strähnen / Balayage', category: 'Farbe', duration: 150, price: 110 },
    { name: 'Hochsteckfrisur', category: 'Anlass', duration: 60, price: 55 },
  ],
  nailstudio: [
    { name: 'Maniküre', category: 'Hände', duration: 45, price: 30, common: true },
    { name: 'Maniküre mit Lack', category: 'Hände', duration: 60, price: 38 },
    { name: 'Shellac / Gel-Lack', category: 'Hände', duration: 60, price: 38, common: true },
    { name: 'Neumodellage Gel', category: 'Nägel', duration: 120, price: 60, common: true },
    { name: 'Auffüllen Gel', category: 'Nägel', duration: 90, price: 45, common: true },
    { name: 'Ablösen', category: 'Nägel', duration: 30, price: 15 },
    { name: 'Pediküre', category: 'Füße', duration: 60, price: 38, common: true },
    { name: 'Pediküre mit Lack', category: 'Füße', duration: 75, price: 45 },
  ],
  beautysalon: [
    { name: 'Klassische Gesichtsbehandlung', category: 'Gesicht', duration: 75, price: 65, common: true },
    { name: 'Augenbrauen zupfen und formen', category: 'Augen', duration: 15, price: 12, common: true },
    { name: 'Wimpern färben', category: 'Augen', duration: 15, price: 14, common: true },
    { name: 'Augenbrauen färben', category: 'Augen', duration: 10, price: 10 },
    { name: 'Wimpernlifting', category: 'Augen', duration: 60, price: 55, common: true },
    { name: 'Make-up', category: 'Gesicht', duration: 45, price: 45 },
    { name: 'Waxing Beine komplett', category: 'Haarentfernung', duration: 45, price: 40 },
    { name: 'Waxing Achseln', category: 'Haarentfernung', duration: 15, price: 15 },
  ],
  physiotherapy: [
    { name: 'Krankengymnastik', category: 'Therapie', duration: 25, price: 30, common: true },
    { name: 'Manuelle Therapie', category: 'Therapie', duration: 25, price: 38, common: true },
    { name: 'Manuelle Lymphdrainage (45 Min.)', category: 'Therapie', duration: 45, price: 40, common: true },
    { name: 'Klassische Massage', category: 'Massage', duration: 30, price: 32, common: true },
    { name: 'Krankengymnastik am Gerät', category: 'Therapie', duration: 60, price: 40 },
    { name: 'Wärmetherapie / Fango', category: 'Ergänzung', duration: 20, price: 15 },
    { name: 'Erstbefund', category: 'Therapie', duration: 30, price: 35 },
  ],
  massage: [
    { name: 'Rückenmassage', category: 'Massage', duration: 30, price: 35, common: true },
    { name: 'Ganzkörpermassage (60 Min.)', category: 'Massage', duration: 60, price: 65, common: true },
    { name: 'Ganzkörpermassage (90 Min.)', category: 'Massage', duration: 90, price: 90 },
    { name: 'Hot-Stone-Massage', category: 'Wellness', duration: 75, price: 80, common: true },
    { name: 'Fußreflexzonenmassage', category: 'Wellness', duration: 45, price: 50, common: true },
    { name: 'Kopf- und Nackenmassage', category: 'Massage', duration: 20, price: 25 },
  ],
  automotive: [
    { name: 'Ölwechsel', category: 'Wartung', duration: 45, price: 79, common: true },
    { name: 'Inspektion', category: 'Wartung', duration: 120, price: 189, common: true },
    { name: 'Räder wechseln', category: 'Reifen', duration: 30, price: 35, common: true },
    { name: 'Reifen montieren und wuchten', category: 'Reifen', duration: 45, price: 60 },
    { name: 'HU/AU', category: 'Prüfung', duration: 60, price: 145, common: true },
    { name: 'Klimaservice', category: 'Wartung', duration: 60, price: 99 },
    { name: 'Fehlerspeicher auslesen', category: 'Diagnose', duration: 30, price: 40 },
    { name: 'Bremsen prüfen', category: 'Diagnose', duration: 30, price: 25 },
  ],
  coaching: [
    { name: 'Erstgespräch', category: 'Beratung', duration: 30, price: 0, common: true },
    { name: 'Einzelsitzung (50 Min.)', category: 'Beratung', duration: 50, price: 90, common: true },
    { name: 'Einzelsitzung (90 Min.)', category: 'Beratung', duration: 90, price: 150 },
    { name: 'Online-Sitzung', category: 'Beratung', duration: 50, price: 90 },
    { name: 'Paarberatung', category: 'Beratung', duration: 60, price: 120 },
  ],
};

/** Ohne Branche: ein neutraler Termin zum Umbenennen */
export const GENERIC_TEMPLATES: ServiceTemplate[] = [
  { name: 'Termin (30 Min.)', category: '', duration: 30, price: 0, common: true },
  { name: 'Termin (60 Min.)', category: '', duration: 60, price: 0 },
];

export const templatesFor = (industry?: string | null): ServiceTemplate[] =>
  (industry && SERVICE_TEMPLATES[industry]) || GENERIC_TEMPLATES;
