# Task — Briefwellen direkt über die Schnittstelle von PIN eBrief verschicken (Stufe B)

- **Status:** In Review (Code fertig 04.11.2026; offen: Test gegen die Testumgebung von PIN, sobald der Zugang da ist)
- **Touches:** backend, frontend
- **Requirement:** briefversand · step 2/2
- **Related:** ADR likely — Anbindung eines Druck- und Versanddienstleisters (austauschbarer Anbieter, Statusmeldungen
  per Webhook)

## Context / Problem

Nach task-001 lädt Stefan das Sammel-PDF jeder Welle selbst bei PIN hoch und trägt unzustellbare Briefe von Hand ein.
Stufe B nimmt ihm beides ab: Dranzeit übergibt jeden Brief selbst an PIN und erfährt den Status. Der Anbieter soll
austauschbar bleiben. Ersatz wäre onlinebrief24.

## Proposed change

- **Versand:** „Welle verschicken“ erzeugt je Salon Code und Brief und übergibt den Brief sofort an PIN eBrief. Ein
  Sammel-PDF gibt es dann nicht mehr. Der Weg aus task-001 bleibt als Rückfall nutzbar.
- **Je Brief merkt sich Dranzeit** die Auftragsnummer von PIN, den Status (angenommen, gedruckt, eingeliefert,
  unzustellbar, Fehler) und den Preis.
- **Status:**
  - Statusmeldungen von PIN kommen per Webhook, abgesichert mit einem Geheimnis.
  - Wo eine Meldung fehlt, fragt Dranzeit regelmäßig selbst nach.
  - „Unzustellbar“ setzt dieselbe Sperre wie der Knopf aus task-001.
- **Fehler:** Scheitert die Übergabe, bekommt der Salon in dieser Welle keinen Brief. Sein Code verfällt, und der Grund
  steht in der Liste der Welle.
- **Nie doppelt:** Doppelklick, Neustart des Backends oder Netzwerkfehler lösen keinen Brief doppelt aus. Nach einem
  Abbruch fragt Dranzeit bei PIN nach, bevor es neu versucht.
- **Grenzen:** Die Kostengrenze je Monat aus den Einstellungen gilt auch während des Versands. Ist sie erreicht, hört er
  auf und meldet das.
- **Testmodus:**
  - Eine Einstellung schaltet zwischen der Staging-Umgebung von PIN und dem echten Versand.
  - Im Testmodus zeigt der Bereich „Briefe“ einen deutlichen Hinweis.
  - Testwellen zählen in keiner Auswertung und sperren keinen Salon.
- **Layout:** Mit Testaufträgen in der Staging-Umgebung prüfen, ob PIN die Anschrift erkennt, auch bei langen Namen und
  Sonderzeichen. Außerdem prüfen, ob die Rücksendezeile die Codes stört, die PIN selbst ins Fenster druckt.

## Acceptance criteria

- In der Staging-Umgebung nimmt PIN alle Testbriefe an und erkennt die Anschrift, auch bei langen Namen und Namen wie
  „Kuaför Şahin“.
- Doppelklick und Neustart während einer Welle lösen keinen Brief doppelt aus (Test gegen eine Attrappe des Anbieters).
- Eine Statusmeldung „unzustellbar“ sperrt den Salon und zeigt „Anschrift prüfen“. Eine Meldung ohne gültiges
  Geheimnis wird abgewiesen.
- Ist die Kostengrenze des Monats erreicht, bricht der Versand ab und meldet, wie viele Briefe rausgingen.
- Im Testmodus geht kein Auftrag an den echten Versand. Der Hinweis ist sichtbar, und die Auswertung zählt Testwellen
  nicht.
- Kein Code im Klartext in Datenbank, Protokoll oder Server-Log, auch nicht in Fehlermeldungen des Anbieters.
- Tests grün: Backend-Tests für Versand, Status und Doppelversand gegen die Attrappe, `dev/e2e/brief.cjs` mit dem Weg
  „Welle verschicken“.

## Files

Runtime-derived from the touched repos' `CLAUDE.md` (`Touches:` above). Not prescribed here.

## Order / risk

- Nach task-001.
- Braucht den API-Zugang von PIN (über den Support) und eine eingetragene Webhook-Adresse. Den API-Schlüssel und das
  Webhook-Geheimnis setzt Stefan selbst auf dem Server, mit einem Block, der sie per `Read-Host -AsSecureString`
  abfragt.
- Risiko mittel: Ein Fehler kostet echtes Porto oder schickt Briefe doppelt. Darum zuerst nur im Testmodus, dann eine
  kleine echte Welle.
