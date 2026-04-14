export interface Industry {
  id: string;
  name: string;
  description: string;
}

// Industrie-Kategorien für Dienstleistungsbetriebe
export const INDUSTRIES: Industry[] = [
  {
    id: 'barbershop',
    name: 'Friseure/Barbiere',
    description: 'Haarschnitte, Bartpflege und Styling für Damen und Herren'
  },
  {
    id: 'physiotherapy',
    name: 'Physiotherapeuten',
    description: 'Physiotherapeutische Behandlungen und Massagen'
  },
  {
    id: 'automotive',
    name: 'Autowerkstätten',
    description: 'Reparatur und Wartung von Fahrzeugen'
  },
  {
    id: 'coaching',
    name: 'Therapeuten/Coaches',
    description: 'Psychologische Beratung, Coaching und Therapie'
  },
  {
    id: 'nailstudio',
    name: 'Nagelstudios',
    description: 'Maniküre, Pediküre und Nagelverlängerung'
  },
  {
    id: 'beautysalon',
    name: 'Kosmetiksalons',
    description: 'Gesichtsbehandlungen, Kosmetik und Hautpflege'
  },
  {
    id: 'massage',
    name: 'Massagepraxen',
    description: 'Entspannungs- und Wellnessmassagen'
  }
];

// Hilfsfunktion zum Abrufen einer Industry anhand der ID
export const getIndustryById = (id: string): Industry | undefined => {
  return INDUSTRIES.find(industry => industry.id === id);
};

// Hilfsfunktion zum Abrufen des Industry-Namens anhand der ID
export const getIndustryNameById = (id: string): string => {
  const industry = getIndustryById(id);
  return industry ? industry.name : 'Unbekannte Branche';
};
