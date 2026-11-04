# Task — Salons in Wellen anschreiben: Auswahl, Sperre, Sammel-PDF, Erinnerung (Stufe A)

- **Status:** In Review (Code fertig 04.11.2026; erste echte Welle steht aus)
- **Touches:** backend, frontend
- **Requirement:** briefversand · step 1/2
- **Related:** ADR likely — Datenmodell für Briefwellen, Brief-Historie je Salon und eine Sperrliste, die das Löschen
  eines Eintrags überlebt

## Context / Problem

Heute erzeugt der Betreiber Übernahme-Code und Brief für jeden Salon einzeln, druckt und verschickt selbst. Stefan
will hunderte Salons in Nordberlin in Wellen anschreiben und die Briefe von PIN eBrief drucken und verschicken lassen.
In der ersten Stufe lädt er dafür ein Sammel-PDF selbst bei PIN hoch, ein Versand per Schnittstelle folgt in
task-002.

Der Brief verspricht schon heute „Keine Post mehr von uns“ auf Zuruf, im System gibt es dafür aber nichts. Vor dem
ersten Massenversand muss das stehen.

## Proposed change

- **Sperre „Keine Post mehr“:**
  - Knopf am Eintrag im Betreiber-Bereich, mit Grund (E-Mail, Brief, Anruf, vor Ort).
  - Link „Keine Post mehr“ unten auf der öffentlichen Salonseite neben „Eintrag entfernen“. Ein Klick sperrt sofort,
    ohne Nachweis per E-Mail, mit einer Grenze je IP-Adresse und Tag. Die Seite bleibt online, der Betreiber bekommt
    eine Mail. Nicht auf Seiten echter Dranzeit-Läden.
  - Automatisch gesperrt, wenn der Salon seinen Eintrag entfernt.
  - Eine Sperrliste hält Place-ID (falls vorhanden) und einen Hash der normalisierten Anschrift, ohne Klartext. Sie
    greift auch, wenn der Eintrag gelöscht und derselbe Salon neu importiert wird.
- **Knopf „Unzustellbar“** am Eintrag: sperrt den Salon für weitere Briefe und zeigt „Anschrift prüfen“. Nach einer
  Korrektur der Anschrift ist er wieder auswählbar.
- **Regeln an einer Stelle:** Ein Salon bekommt nur einen Brief, wenn die Seite online ist, die Anschrift vollständig
  ist, er nicht mit einem Dranzeit-Laden verbunden ist, keine Sperre hat, nicht unzustellbar ist und bisher weniger als
  zwei Briefe bekam, der letzte mindestens 21 Tage alt. Alle Quellen der Anschrift zählen (Entscheidung Stefan).
- **Bereich „Briefe“ im Betreiber-Bereich:**
  - Filter nach Bezirk, Ortsteil, PLZ oder PLZ-Bereich und Kategorie.
  - Vorschau: Anzahl, voraussichtliche Kosten, Liste mit Name und Anschrift, einzelne Salons abwählbar.
  - Ausgeschlossene Salons in einer aufklappbaren Liste mit Grund.
- **Einstellungen im Betreiber-Bereich**, jede Änderung im Protokoll:
  - Obergrenze je Welle, Standard 200.
  - Kostengrenze je Kalendermonat, Standard 300 €.
  - Preis je Brief, Standard 0,77 €.
- **Welle:**
  - „Briefe erzeugen“ legt je Salon einen neuen Code an. Ein früherer Code verfällt.
  - Ergebnis ist ein PDF mit einer Seite je Brief, nach PLZ sortiert, farbig, nur in diesem Moment ladbar.
  - Status der Welle: „erzeugt“, nach dem Klick „Hochgeladen“ dann „verschickt“.
  - Eine erzeugte Welle lässt sich verwerfen. Ihre Codes verfallen, die Salons sind wieder auswählbar.
  - Keine Welle über der Obergrenze oder über der Kostengrenze des Monats.
  - Jede Welle steht im Protokoll.
- **Erinnerung:** 21 Tage nach dem ersten Brief erscheinen Salons, die nicht übernommen, nicht entfernt, nicht gesperrt
  und nicht unzustellbar sind, als „Erinnerung fällig“. Sie gehen als eigene Welle raus, mit kürzerem eigenem Text und
  neuem Code.
- **Brieftext:**
  - Wortlaut für den Erinnerungsbrief.
  - Hinweis auf den Link „Keine Post mehr“ im Widerspruchsabsatz.
  - Beides gibt Stefan vor dem Ausrollen frei.
- **Auswertung je Welle:** verschickt, unzustellbar, übernommen (Code aus dieser Welle eingelöst), entfernt, keine Post,
  Kosten, Kosten je Übernahme.
- **Datenschutzerklärung:**
  - Brief-Versand über PIN AG als Auftragsverarbeiter in allen Sprachen der Seite.
  - Dazu der Link „Keine Post mehr“ als Weg zum Widerspruch.

## Acceptance criteria

- Gesperrte, übernommene, entfernte, unzustellbare Salons und Salons ohne vollständige Anschrift sind nie auswählbar;
  die Liste der Ausgeschlossenen nennt den Grund.
- Das Sammel-PDF hat so viele Seiten wie Salons, sortiert nach PLZ. Jede Seite hat einen eigenen, einlösbaren Code. Ein
  früherer Code des Salons gilt nicht mehr.
- Nach einer Welle steht kein Code im Klartext in der Datenbank, im Protokoll oder im Server-Log (Test durchsucht den
  Speicher).
- Eine verworfene Welle macht ihre Codes ungültig, und die Salons sind wieder auswählbar.
- Obergrenze je Welle und Kostengrenze je Monat verhindern das Erzeugen einer zu großen Welle. Beide und der Preis je
  Brief lassen sich im Betreiber-Bereich ändern, mit Protokolleintrag.
- „Keine Post mehr“ per Knopf und per Link auf der Salonseite sperrt sofort. Der Betreiber bekommt eine Mail. Die Grenze
  gegen Massenklicks greift. Die Sperre überlebt Löschen und Neuimport desselben Salons.
- „Unzustellbar“ sperrt und zeigt „Anschrift prüfen“. Nach geänderter Anschrift ist der Salon wieder auswählbar.
- Erinnerungen erscheinen frühestens 21 Tage nach dem ersten Brief. Kein Salon bekommt mehr als zwei Briefe.
- Die Auswertung zählt eine Übernahme nur für die Welle, aus der der eingelöste Code stammt.
- Tests grün: `dev/e2e/brief.cjs` erweitert um Bereich „Briefe“, Sammel-PDF und Link auf der Salonseite.
  Backend-Tests für Regeln, Sperrliste, Grenzen und Verwerfen. `seiten.cjs` grün.
- Probedruck: Die ersten 10–20 Briefe gehen über PIN raus, einer an die eigene Adresse. Die Anschrift ist im
  DL-Fensterumschlag ganz sichtbar, der QR-Code lässt sich scannen.

## Files

Runtime-derived from the touched repos' `CLAUDE.md` (`Touches:` above). Not prescribed here.

## Order / risk

- Keine Abhängigkeit auf andere Tasks. Läuft parallel zur Anforderung `eigene-datenbank`. Neue Daten nur im Backend
  über die vorhandene Speicher-Schicht, damit der Umzug auf PostgreSQL sie ohne Zusatzarbeit mitnimmt.
- Vor der ersten echten Welle:
  - Stefan legt das PIN-Konto an, schließt den AVV und lädt Guthaben auf.
  - Stefan gibt die Brieftexte frei.
  - Die rechtliche Prüfung des Brieftexts ist erledigt.
- Risiko mittel: Echte Post an echte Salons lässt sich nicht zurückholen. Darum zuerst eine kleine Welle und alle Tests
  nur mit Testeinträgen, nie mit echten Salon-Adressen.
