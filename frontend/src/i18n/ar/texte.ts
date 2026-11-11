import type { Texte } from "../typen.ts";
import allgemein from "./allgemein.ts";
import buchung from "./buchung.ts";
import einrichtung from "./einrichtung.ts";
import konto from "./konto.ts";
import schnittstelle from "./schnittstelle.ts";
import start from "./start.ts";
import suche from "./suche.ts";
import team from "./team.ts";
import tresen from "./tresen.ts";
import warteschlange from "./warteschlange.ts";

// Je Bereich eine Datei; derselbe Schlüssel darf in mehreren stehen, dann gilt der spätere
const texte: Texte = { ...allgemein, ...buchung, ...einrichtung, ...konto, ...schnittstelle, ...start, ...suche, ...team, ...tresen, ...warteschlange };

export default texte;
