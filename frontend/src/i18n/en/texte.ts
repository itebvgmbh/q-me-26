import type { Texte } from "../typen.ts";
import allgemein from "./allgemein.ts";
import buchung from "./buchung.ts";
import einrichtung from "./einrichtung.ts";
import konto from "./konto.ts";
import start from "./start.ts";
import team from "./team.ts";
import tresen from "./tresen.ts";
import warteschlange from "./warteschlange.ts";

// Je Bereich eine Datei; derselbe Schlüssel darf in mehreren stehen, dann gilt der spätere
const texte: Texte = { ...allgemein, ...buchung, ...einrichtung, ...konto, ...start, ...team, ...tresen, ...warteschlange };

export default texte;
