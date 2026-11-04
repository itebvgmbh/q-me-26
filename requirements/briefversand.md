# Anforderung: Briefe an Salons in Serie über einen Versanddienstleister

- **ID:** briefversand
- **Stand:** 04.11.2026
- **Status:** Abgestimmt mit Stefan am 04.11.2026 (siehe „Entschieden“). Statt jeden Brief einzeln zu erzeugen,
  schreibt Dranzeit viele Salons auf einmal an und übergibt die Briefe einem Druck- und Versanddienstleister.
- **Fortschritt:** Stufe A gebaut am 04.11.2026 (task-001): Reiter „Briefe“, Sperre und Link „Keine Post mehr“,
  Unzustellbar, Einstellungen, Sammel-PDF, Erinnerung, Auswertung. Tests: `backend/tests/test_briefe.py`,
  `dev/e2e/briefe.cjs`.
- **Grundlage:** Recherche der Anbieter vom 04.11.2026 (Abschnitt „Dienstleister“), Brief aus PR #86
  (`backend/app/libs/brief.py`), Übernahme-Code aus PR #67 (`backend/app/libs/uebernahme.py`).

## Worum es geht

Heute erzeugt der Betreiber im Reiter Verzeichnis für einen Salon einen Übernahme-Code und lädt gleich danach den
Brief als PDF. Den druckt er selbst, kuvertiert ihn und bringt ihn zur Post oder wirft ihn ein. Für die ersten Salons
ist das richtig. Für hunderte Salons in Nordberlin ist es zu viel Handarbeit.

Ziel:

- Der Betreiber wählt Salons aus, zum Beispiel nach Bezirk oder PLZ. Er sieht, wie viele Briefe es werden und was sie
  kosten, und bestätigt.
- Dranzeit erzeugt für jeden Salon einen Code und den Brief. Die Briefe gehen an einen Dienstleister, der sie druckt,
  kuvertiert und einliefert.
- Nach einigen Wochen bekommen die Salons, die nicht reagiert haben, einen Erinnerungsbrief.
- Je Welle ist zu sehen, was daraus wurde: verschickt, unzustellbar, übernommen, Eintrag entfernt, keine Post
  gewünscht.

Der persönliche Code steht weiter nur im Brief im Klartext. Dranzeit speichert ihn wie bisher nur als Hash.

## Dienstleister (Recherche 04.11.2026)

Preise netto, 1 Blatt A4 einseitig, inklusive Porto, Standardbrief Inland:

| Anbieter | Farbe (s/w) | Schnittstelle | Passt das heutige Layout? | AVV |
|---|---|---|---|---|
| PIN eBrief (PIN AG, Berlin) | 0,77 € (0,74 €), ab 250/Monat 0,72 € | REST, Staging-Umgebung, Webhooks, liest die Anschrift aus dem PDF, teilt Sammel-PDFs nach Seitenzahl | ja, deren Abstandsvorlage hat die Anschrift wie wir bei 63 mm und 25 mm | online nicht gefunden, anfordern |
| onlinebrief24 | 0,81 € (0,75 €) | REST, Test nur über den Warenkorb, keine Webhooks | ja | ja, zum Download |
| LetterXpress | 0,92 € (0,81 €) | wie onlinebrief24 (gleiche Firmengruppe) | ja | ja |
| Binect | 0,89 € (0,83 €) | REST, Testumgebung, keine Webhooks | nein, Anschrift müsste tiefer | nicht gefunden |
| E-POST (Deutsche Post) | 0,83 € (0,80 €) | nur mit Partnervertrag | nein | – |
| Pingen (Zürich) | 1,13 € unter 500/Monat | beste Schnittstelle, Python-SDK | nein, Rücksendezeile im Adressfeld | nicht öffentlich |

- **Entschieden:** PIN eBrief, farbig. Günstigster Farbpreis, stellt in Berlin selbst zu, Staging und Webhooks, löscht
  die PDFs spätestens nach 28 Tagen. Das ist wichtig, weil der Code im PDF im Klartext steht. Ersatz, falls PIN nicht
  klappt: onlinebrief24.
- **Porto 2027:** Die Deutsche Post will den Standardbrief zum 01.01.2027 von 0,95 € auf 1,15 € verteuern. Die
  Bundesnetzagentur hat noch nicht zugestimmt. Die Preise der Anbieter werden mitsteigen.
- **Werbebrief-Tarif (Dialogpost):** 0,38 € Porto, aber erst ab 200 Briefen je Leitregion (Berlin: 10, 12, 13, 14)
  oder 500 bundesweit. Kein Anbieter mit PDF-Schnittstelle bietet das an. Der Mailing-Dienst der Post kostet mit Druck
  0,98 € je Brief bei 1.000 Stück. Lohnt sich erst ab etwa 1.000 Briefen je Welle, nicht Teil dieses Vorhabens.
- **Austauschbar:** Der Anbieter steckt im Backend hinter einer kleinen Schnittstelle. Ein Wechsel heißt: ein neuer
  Adapter, sonst nichts.

## Ablauf für den Betreiber

### Auswählen

Im Betreiber-Bereich, Reiter Verzeichnis, gibt es einen Bereich „Briefe“:

- **Filter:** Bezirk, Ortsteil, PLZ oder PLZ-Bereich, Kategorie (Friseur, Barbershop).
- **Nur, wer einen Brief bekommen darf** (Regeln siehe unten). Wer aus welchem Grund herausfällt, steht in einer
  aufklappbaren Liste, zum Beispiel „12 ohne Anschrift, 3 keine Post gewünscht, 5 schon übernommen“.
- **Vorschau:** Anzahl Briefe, voraussichtliche Kosten (Preis je Brief aus der Einstellung), Liste mit Name und
  Anschrift. Einzelne Salons lassen sich abwählen.
- **Obergrenze je Welle.** Mehr lässt sich nicht auswählen.

### Einstellungen

Im Betreiber-Bereich einstellbar, jede Änderung steht im Protokoll:

- Obergrenze je Welle, Standard 200 Briefe.
- Kostengrenze je Kalendermonat, Standard 300 €.
- Preis je Brief für die Kostenvorschau, Standard 0,77 € (PIN, farbig). Die Preise steigen voraussichtlich im Januar
  2027.

### Welle erzeugen und verschicken

Stufe A (Sammel-PDF):

- „Briefe erzeugen“ legt für jeden Salon einen neuen Code an und baut **ein PDF mit einer Seite je Brief**, sortiert
  nach PLZ. Das PDF lässt sich nur in diesem Moment laden, wie heute der einzelne Brief.
- Der Betreiber lädt das PDF beim Dienstleister hoch und lässt es nach je einer Seite aufteilen.
- Danach klickt er „Hochgeladen“. Erst dann gelten die Briefe als verschickt. Ohne diesen Klick steht die Welle auf
  „erzeugt“ und lässt sich verwerfen. Die Codes verfallen dann, und die Salons sind wieder auswählbar.
- **Unzustellbar:** PIN zeigt unzustellbare Briefe in Stufe A nur im eigenen Portal. Der Betreiber markiert diese
  Salons im Betreiber-Bereich mit dem Knopf „Unzustellbar“. Ab Stufe B kommt das automatisch.
- **Erste Welle:** 10–20 Briefe, einer davon an die eigene Adresse (siehe „Probedruck“). Danach Stufe B.

Stufe B (Versand per Schnittstelle):

- „Welle verschicken“ erzeugt Code und Brief je Salon und übergibt den Brief **sofort** dem Dienstleister. Ein
  Sammel-PDF gibt es dann nicht mehr.
- Je Brief merkt sich Dranzeit die Auftragsnummer des Anbieters, den Status und den Preis.
- Status kommt per Webhook. Wo es keine Webhooks gibt, fragt der vorhandene Hintergrund-Thread
  (`app/apis/schedulers`) regelmäßig nach.
- Status: angenommen, gedruckt, eingeliefert, unzustellbar, Fehler.
- Scheitert die Übergabe, bekommt der Salon in dieser Welle keinen Brief. Sein Code verfällt, und der Grund steht in der
  Liste. Ein zweiter Versuch erzeugt einen neuen Code.

### Erinnerungsbrief

- 21 Tage nach dem ersten Brief erscheinen Salons aus einer Welle als „Erinnerung fällig“. Voraussetzung:
  nicht übernommen, nicht entfernt, keine Sperre, nicht unzustellbar.
- Der Betreiber verschickt die Erinnerungen als eigene Welle, mit demselben Ablauf.
- Eigener, kürzerer Text („Vor drei Wochen haben wir dir geschrieben …“) mit neuem Code. Der alte verfällt.
- Höchstens zwei Briefe je Salon. Danach ist der Salon nicht mehr auswählbar.
- In der ersten Fassung geht nichts ohne Bestätigung des Betreibers raus. Kein Nachtlauf.

### Auswertung

Je Welle: Anzahl verschickt, unzustellbar, übernommen (Code eingelöst), Eintrag entfernt, keine Post gewünscht, Kosten,
Kosten je Übernahme. Übernommen zählt, wenn ein Code aus dieser Welle eingelöst wurde (`uebernahme.eingeloestAm`).

## Regeln: Wer bekommt einen Brief?

Ein Salon ist nur auswählbar, wenn alles davon zutrifft:

- Seite veröffentlicht (`status` = `online`), wie heute in `brief.hindernis()`.
- Straße, PLZ und Ort vollständig.
- Noch nicht mit einem Dranzeit-Laden verbunden (`shopId` leer).
- Keine Sperre „keine Post“ (siehe unten), auch nicht auf der Sperrliste.
- Nicht als unzustellbar markiert.
- Weniger als zwei Briefe bisher, und der letzte ist mindestens 21 Tage alt.

Diese Regeln stehen an einer Stelle im Backend (Erweiterung von `brief.hindernis()`). Die Auswahl im Betreiber-Bereich
und der Versand prüfen dieselben Regeln. Der Versand prüft sie unmittelbar vor jedem einzelnen Brief noch einmal.

## Keine Post mehr

Der Brief verspricht heute: „Keine Post mehr von uns: kurz an hilfe@dranzeit.de oder an die Absenderadresse
schreiben.“ Dafür gibt es noch kein Feld. Neu:

- **Knopf „Keine Post mehr“** am Eintrag im Betreiber-Bereich, mit Grund (E-Mail, Brief, Anruf, vor Ort).
  Ins Protokoll kommt der Eintrag „Verzeichnis: keine Post“.
- **Link „Keine Post mehr“ auf der Salonseite**, unten neben „Eintrag entfernen“. Ein Klick sperrt sofort, ohne
  Nachweis per E-Mail: Missbrauch kostet uns nur einen Brief, und ein Widerspruch soll einfach sein. Eine Grenze je
  IP-Adresse und Tag verhindert Massenklicks. Die Seite bleibt online. Der Betreiber bekommt eine Mail. Auf Seiten
  echter Dranzeit-Läden gibt es den Link nicht.
- **Brieftext:** Der Hinweis im Brief nennt den Link zusätzlich zu Mail und Absenderadresse. Stefan gibt den Wortlaut
  frei.
- **Automatisch gesperrt:** wenn der Salon seinen Eintrag entfernt und wenn ein Brief unzustellbar zurückkommt (dann mit
  Hinweis „Anschrift prüfen“; nach einer Korrektur der Anschrift ist die Sperre aufgehoben).
- **Sperrliste, die das Löschen überlebt:** Wird ein Eintrag gelöscht und derselbe Salon später neu importiert, darf er
  trotzdem keine Post bekommen. Die Sperrliste hält deshalb nur Google-Place-ID (falls vorhanden), einen Hash der
  normalisierten Anschrift (Straße, Hausnummer, PLZ) und das Datum, aber keinen Namen und keine Anschrift im Klartext.

## Datenschutz und Recht

- **Briefwerbung an Gewerbetreibende** ist nach § 7 UWG ohne Einwilligung zulässig, solange der Empfänger nicht
  erkennbar widersprochen hat. Darum die Sperre oben.
- **Quelle der Anschrift.** Die Orientierungshilfe Direktwerbung der Datenschutzkonferenz (Februar 2022, Ziffer 4.2)
  hält es für regelmäßig unzulässig, Daten aus einem Online-Impressum für Werbung zu nutzen. Der Import
  (`verzeichnis_import.py`) liest Startseite, Impressum, Kontaktseite und Preisseiten zusammen und merkt sich nicht, wo
  die Anschrift stand.
  - **Entschieden am 04.11.2026 (Stefan):** Alle Quellen zählen, auch das Impressum. Dranzeit merkt sich die Quelle
    nicht je Eintrag. Das Risiko trägt Stefan bewusst.
  - Für uns spricht: Der Brief geht an die Ladenadresse, die am Laden und meist auch auf der Kontaktseite steht. Er
    nennt keinen Namen aus dem Impressum, sondern „Inhaberin oder Inhaber“.
  - Schließt die rechtliche Prüfung Impressum-Adressen aus, müssen die Webseiten aller Einträge erneut gelesen werden.
    Das ist dann eine eigene Aufgabe.
- **Informationspflicht (Art. 14 DSGVO):** Der Brief nennt schon die Quelle („von deiner Webseite“) und verweist auf
  die Datenschutzerklärung. Stammt die Anschrift nicht von der Webseite, passt sich der Satz an.
- **Widerspruch (Art. 21 DSGVO):** Die Datenschutzkonferenz empfiehlt, den Hinweis deutlich abgesetzt auf jede
  Werbesendung zu drucken. Heute steht er klein und grau unten. Ob das reicht, gehört zur rechtlichen Prüfung.
- **Auftragsverarbeitung (Art. 28 DSGVO):** Der Dienstleister verarbeitet Anschriften und Codes in unserem Auftrag.
  Es braucht einen AVV. Die Datenschutzerklärung nennt den Dienstleister in allen Sprachen.
- **Fristen:** Die Brief-Historie bleibt, solange es den Eintrag gibt. Die Sperrliste ist unbefristet, weil sie nur so
  ihren Zweck erfüllt.

## Der Brief

- **Sammel-PDF:** `brief.pdf()` bekommt eine Variante für viele Salons: eine Seite je Brief, nach PLZ sortiert.
- **Erinnerung:** `texte()` bekommt eine zweite Fassung mit eigenem Betreff und kürzerem Einstieg. Stefan gibt den
  Wortlaut frei.
- **Layout:** Vor dem ersten echten Versand mit einem Testauftrag in der Staging-Umgebung des Anbieters prüfen:
  - Wird die Anschrift erkannt, auch bei langen Namen, Umlauten und Namen wie „Kuaför Şahin“?
  - Stört die Rücksendezeile (60,5 mm von oben) die Codes, die PIN selbst bei 54–55 mm ins Fenster druckt?
- **Probedruck:** Die ersten 5–10 echten Briefe gehen mit einer Welle raus, einer davon an die eigene Adresse. Prüfen,
  ob die Anschrift im DL-Fensterumschlag ganz sichtbar ist, die Farben stimmen und sich der QR-Code scannen lässt.

## Testmodus und Grenzen

- **Testmodus:** Eine Einstellung schaltet zwischen der Staging-Umgebung des Anbieters und dem echten Versand. Im
  Testmodus zeigt der Bereich „Briefe“ einen deutlichen Hinweis, und Wellen sind als Test markiert. Sie zählen in keiner
  Auswertung und sperren keinen Salon.
- **Kostengrenze:** Neben der Obergrenze je Welle gibt es eine Grenze je Kalendermonat in Euro (siehe
  „Einstellungen“). In Stufe A lässt sich keine Welle erzeugen, die zusammen mit den Wellen des Monats darüber läge.
  In Stufe B hört der Versand auf, sobald sie erreicht ist, und meldet das.
- **Nie doppelt:** Ein zweiter Klick, ein Neustart des Backends oder ein Netzwerkfehler dürfen keinen Brief doppelt
  auslösen. Vor jedem Brief merkt sich Dranzeit „wird verschickt“. Nach einem Abbruch fragt es den Anbieter, bevor es
  neu versucht.

## Was nicht mit `git pull` kommt

| Was | Wer | Stufe |
|---|---|---|
| Rechtliche Prüfung: Brieftext, Widerspruchshinweis, zulässige Quellen der Anschrift | Stefan mit Anwalt | vor dem ersten Versand |
| Konto beim Dienstleister anlegen, AVV abschließen | Stefan | A |
| Guthaben aufladen bzw. Zahlart hinterlegen | Stefan | A |
| API-Zugang anfordern (bei PIN über den Support), Webhook-Adresse eintragen lassen | Stefan | B |
| API-Schlüssel und Webhook-Geheimnis in `/etc/q-me.env` | Stefan, Block mit `Read-Host -AsSecureString` | B |
| Testmodus einschalten und Staging-Zugang hinterlegen | Claude per ssh (ohne Geheimnisse), Schlüssel Stefan | B |
| Wortlaut von Erinnerungsbrief und Hinweis „Keine Post mehr“ freigeben | Stefan | A |

## Acceptance – Abnahme

- **Auswahl:** Gesperrte, übernommene, entfernte, unzustellbare Salons und Salons ohne vollständige Anschrift sind nie
  auswählbar. Die Liste der Ausgeschlossenen nennt den Grund.
- **Einstellungen:** Obergrenze je Welle, Kostengrenze je Monat und Preis je Brief lassen sich im Betreiber-Bereich
  ändern. Jede Änderung steht im Protokoll.
- **Sammel-PDF:** Es hat so viele Seiten wie Salons, sortiert nach PLZ. Jede Seite hat einen eigenen Code, jeder Code
  ist einlösbar, ein früherer Code des Salons gilt nicht mehr.
- **Kein Klartext:** Nach einer Welle steht kein Code im Klartext in der Datenbank, im Protokoll oder im Server-Log
  (Test durchsucht den Speicher).
- **Verwerfen:** Eine erzeugte, nicht hochgeladene Welle lässt sich verwerfen. Danach sind ihre Codes ungültig und die
  Salons wieder auswählbar.
- **Versand per Schnittstelle:** In der Staging-Umgebung werden alle Testbriefe angenommen und die Anschrift erkannt,
  auch bei langen Namen und Sonderzeichen. Doppelklick und Neustart während einer Welle lösen keinen Brief doppelt aus.
- **Status:** „unzustellbar“ sperrt den Salon und zeigt „Anschrift prüfen“.
- **Keine Post:** Knopf im Betreiber-Bereich und Link auf der Salonseite sperren sofort, der Betreiber bekommt eine
  Mail. Die Sperre überlebt Löschen und Neuimport desselben Salons.
- **Unzustellbar:** Der Knopf im Betreiber-Bereich sperrt den Salon für weitere Briefe und zeigt „Anschrift prüfen“.
- **Erinnerung:** frühestens nach der Frist, höchstens zwei Briefe je Salon.
- **Grenzen:** Obergrenze je Welle und Kostengrenze je Monat greifen.
- **Testmodus:** Im Testmodus geht kein Auftrag an den echten Versand.
- **Probedruck:** Anschrift im Fenster ganz sichtbar, QR-Code scannbar.
- **Tests grün:** `dev/e2e/brief.cjs` (erweitert um Sammel-PDF und Bereich „Briefe“), Backend-Tests für Regeln,
  Sperrliste und Versand gegen eine Attrappe des Anbieters.

## Nicht Teil dieses Vorhabens

- Dialogpost, Lettershop und Mailing-Dienst der Post (erst ab etwa 1.000 Briefen je Welle sinnvoll).
- Postkarten. Der Code wäre für jeden lesbar.
- Automatischer Versand ohne Bestätigung (Nachtlauf).
- Plakat per Post, Empfehlungen, Wochenbericht aus der Kundengewinnungs-Strategie.
- E-Mail- oder Telefon-Akquise. Beides scheidet nach § 7 UWG aus.
- Briefe ins Ausland.

## Entschieden (Stefan, 04.11.2026)

1. **Dienstleister:** PIN eBrief. Ersatz onlinebrief24.
2. **Reihenfolge:** Erst Stufe A mit einer ersten Welle von 10–20 Briefen, dann Stufe B.
3. **Quelle der Anschrift:** Alle Quellen, auch das Impressum. Die Quelle wird nicht je Eintrag festgehalten.
4. **Erinnerung:** 21 Tage nach dem ersten Brief, höchstens zwei Briefe je Salon.
5. **Grenzen:** Im Betreiber-Bereich einstellbar. Standard 200 Briefe je Welle und 300 € je Monat.
6. **Druck:** farbig.
7. **Rückläufer:** In Stufe A markiert der Betreiber sie mit dem Knopf „Unzustellbar“. Ab Stufe B kommen sie per Status.
8. **Keine Post:** Zusätzlich zu Mail und Brief ein Link auf der Salonseite. Er sperrt sofort, ohne Nachweis per
   E-Mail.
9. **Aufgaben:** Stufe A ist eine Aufgabe, Stufe B eine zweite.

Weiter offen und nicht durch Code zu lösen: die rechtliche Prüfung des Brieftexts.

## Vorschlag zur Umsetzung (nicht Teil der Anforderung)

- **Anbieter:** `backend/app/libs/briefdienst/` mit einer kleinen Schnittstelle (`senden(pdf, referenz)`,
  `status(auftrag)`, `preis()`), einem Adapter je Anbieter und einer Attrappe für Tests.
- **Regeln und Wellen:** `backend/app/libs/briefaktion.py`. Wellen in einer neuen Sammlung `briefwellen`, die Brief-
  Historie am Eintrag (`post: [{welle, art, am, status, auftrag, preis}]`), Sperrliste in `briefsperren`. Alles über
  die Speicher-Schicht, nur das Backend liest und schreibt. So landen die neuen Sammlungen beim Umzug auf PostgreSQL
  (Anforderung `eigene-datenbank`, Stufe 3) ohne Zusatzarbeit in der Tabelle `dokumente`, und Firestore-Regeln braucht
  es dafür nicht.
- **Schnittstelle:** neue Routen unter `/betreiber/briefe`, Webhook unter `/briefdienst/webhook` mit Geheimnis.
- **Oberfläche:** neuer Bereich in `frontend/src/components/betreiber/Verzeichnis.tsx` oder eigener Reiter „Briefe“.
- **Aufwand:** Stufe A etwa 3 Tage (Regeln, Sperre samt Link auf der Salonseite, Einstellungen, Sammel-PDF, Welle,
  Erinnerung, Auswertung, Oberfläche, Tests). Stufe B etwa 2–3 Tage (Adapter, Status, Schutz vor Doppelversand,
  Testmodus).

## Generated tasks

- `tasks/task-001-briefwellen-sammel-pdf.md` – Stufe A: Sperre „Keine Post mehr“, Unzustellbar, Einstellungen,
  Bereich „Briefe“, Sammel-PDF, Erinnerung, Auswertung, Datenschutzerklärung.
- `tasks/task-002-briefversand-pin-schnittstelle.md` – Stufe B: Versand per Schnittstelle von PIN eBrief mit Status,
  Schutz vor Doppelversand und Testmodus.
