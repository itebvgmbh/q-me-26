import { t } from '@/i18n';

export interface Industry {
  id: string;
  name: string;
  description: string;
}

// Industrie-Kategorien für Dienstleistungsbetriebe. Gespeichert wird nur die id; Name und Beschreibung
// sind Getter, damit sie erst beim Anzeigen übersetzt werden (beim Laden der Datei steht die Sprache noch nicht fest)
export const INDUSTRIES: Industry[] = [
  {
    id: 'barbershop',
    get name() { return t('Friseure/Barbiere'); },
    get description() { return t('Haarschnitte, Bartpflege und Styling für Damen und Herren'); },
  },
  {
    id: 'physiotherapy',
    get name() { return t('Physiotherapeuten'); },
    get description() { return t('Physiotherapeutische Behandlungen und Massagen'); },
  },
  {
    id: 'automotive',
    get name() { return t('Autowerkstätten'); },
    get description() { return t('Reparatur und Wartung von Fahrzeugen'); },
  },
  {
    id: 'coaching',
    get name() { return t('Therapeuten/Coaches'); },
    get description() { return t('Psychologische Beratung, Coaching und Therapie'); },
  },
  {
    id: 'nailstudio',
    get name() { return t('Nagelstudios'); },
    get description() { return t('Maniküre, Pediküre und Nagelverlängerung'); },
  },
  {
    id: 'beautysalon',
    get name() { return t('Kosmetiksalons'); },
    get description() { return t('Gesichtsbehandlungen, Kosmetik und Hautpflege'); },
  },
  {
    id: 'massage',
    get name() { return t('Massagepraxen'); },
    get description() { return t('Entspannungs- und Wellnessmassagen'); },
  },
];

// Hilfsfunktion zum Abrufen einer Industry anhand der ID
export const getIndustryById = (id: string): Industry | undefined => {
  return INDUSTRIES.find(industry => industry.id === id);
};

// Hilfsfunktion zum Abrufen des Industry-Namens anhand der ID
export const getIndustryNameById = (id: string): string => {
  const industry = getIndustryById(id);
  return industry ? industry.name : t('Unbekannte Branche');
};
