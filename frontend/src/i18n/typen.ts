// Typen der Übersetzungen – eigene Datei, damit die Kataloge sie ohne React einbinden (dev/i18n-pruefen.mjs lädt sie in Node)

export type Sprache = "de" | "en" | "tr" | "ar";

/** Mehrzahlformen nach Intl.PluralRules; Arabisch kennt zero, one, two, few, many, other */
export type Mehrzahl = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Schlüssel ist der deutsche Text, so wie er im Code steht */
export type Texte = Record<string, string | Mehrzahl>;
