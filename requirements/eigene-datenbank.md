# Anforderung: Eigene Datenbank und Anmeldung (ohne Firebase)

- **ID:** eigene-datenbank
- **Stand:** 04.11.2026
- **Status:** Entwurf zur Abstimmung mit Stefan. Entschieden am 04.11.2026: PostgreSQL auf dem vorhandenen Server
  `spielmacherei`, kein eigener Server; eigene Anmeldung statt Firebase Authentication. Offen: siehe „Offen“.
- **Fortschritt:**
  - Stufe 0 live seit 04.11.2026: Datenbank `q_me`, Alembic, nächtliche Sicherung, Workflow „Datenbank“. Anleitung in
    `deploy/README.md`, Abschnitt „Datenbank (PostgreSQL)“.
  - Stufe 1 live seit 04.11.2026: Speicher-Schicht `backend/app/store`, Wächter-Test und Vertrag gegen den
    Firestore-Emulator.
  - Stufe 2, Bereich 1 live seit 04.11.2026: Nummernseite, Wartezimmer-Bildschirm und das Hinweisband „Nummer noch
    offen“ holen ihre Daten über `/routes/live` (`backend/app/apis/live`, `backend/app/libs/live.py`) und hören per
    Server-Sent Events auf Änderungen (`frontend/src/utils/live.ts`). Sie fragen Firestore nicht mehr. Tests:
    `backend/tests/test_live.py`, `dev/e2e/live.cjs`, `dev/e2e/verbindung.cjs`.
  - Stufe 2, Bereich 2 live seit 04.11.2026: Tresen und Kalender (Tag und Woche) lesen die Termine über
    `/routes/team/termine` und hören auf den Kanal `laden:<Laden>`. Termine anlegen und ändern – auch aus Mein Tag –
    schreibt das Backend (`backend/app/libs/team_termine.py`): Belegung, Tagesnummer, Kurzfassung, Zeitpunkte und die
    Nachricht an den Kunden. Die Regelprüfung (Öffnungs- und Arbeitszeiten, Pausen) läuft noch im Browser
    (`utils/booking-rules.ts`, liest Firestore) und kommt mit dem Bereich Online-Buchung ins Backend. Tests:
    `backend/tests/test_team_termine.py`, `dev/e2e/team-termine.cjs`.
  - Stufe 2, Bereich 3 live seit 04.11.2026: Mein Tag liest die Termine der Person über `/routes/team/termine`
    (`utils/hooks/useAppointments.ts`) und lädt nach dem Anlegen gleich nach. Personendaten, Leistungen und Pausen
    liest Mein Tag noch aus Firestore; die kommen mit den Bereichen „Team und Leistungen“ und „Pausen“. Test:
    `dev/e2e/mein-tag.cjs`.
- **Geändert am 04.11.2026 (Stufe 1):** Das Backend nutzt nur einen kleinen Teil von Firestore. Statt jeden der rund
  200 Zugriffe in eigene fachliche Funktionen umzuschreiben, bekommt PostgreSQL in Stufe 3 genau diese Schnittstelle.
  Die Geschäftslogik bleibt dadurch unverändert und getestet. Tabellen, Stufe 1 und Stufe 3 sind entsprechend
  angepasst.

## Worum es geht

Dranzeit stammt aus einem Databutton-Export und nutzt deshalb Google Firebase für fast alles:

- **Firestore:** Datenbank für Läden, Termine, Nummern, Team, Kunden, Verzeichnis und Telefon-Assistent.
- **Firebase Authentication:** Konten mit E-Mail und Passwort. Eine Anmeldung „mit Google“ gibt es nicht.
- **Firebase Storage:** Ladenlogos und Fotos vom Team.
- **Firebase Cloud Messaging:** Push an die iPhone-App.

Ziel ist, dass alle Daten auf unserem Server in Deutschland liegen und Dranzeit ohne Google auskommt.

Gründe:

- **Einfachere Rechte.** Der Browser spricht heute direkt mit der Datenbank. Wer was sehen darf, regelt deshalb eine
  eigene Regeldatei. Dazu kommen Hilfs-Sammlungen, die es nur wegen dieser Regeln gibt (`public_appointments`,
  `members`, `staff_contacts`). Künftig spricht der Browser nur noch mit unserem Backend, und die Rechte stehen im
  Python-Code wie jede andere Prüfung.
- **Schneller.** Nummer ziehen dauert heute im Median etwa 1 Sekunde, bei Andrang deutlich länger. Fast die ganze Zeit
  wartet das Backend auf Firestore. Mit der Datenbank auf demselben Rechner sind es Millisekunden.
- **Zuverlässiger auf dem iPhone.** Die Verbindungsprobleme unter Safari lagen auf dem Weg zu Google. Diese Anfragen
  stehen in keinem unserer Logs. Künftig läuft alles über dranzeit.de.
- **Doppelbuchungen schließt die Datenbank selbst aus.** Das bauen wir heute mit Tagesdokumenten und Transaktionen nach.
- **Datenschutz.** Ein Auftragsverarbeiter mit US-Mutterkonzern weniger. „Alle Daten auf Servern in Deutschland“ lässt
  sich gegenüber Läden sauber zusagen.
- **Eigene Testumgebung.** Tests laufen nicht mehr gegen die echte Datenbank.

## Was sich für Nutzer ändert

Möglichst nichts:

- **Konten:** Alle bestehenden Konten melden sich mit ihrem bisherigen Passwort an. Niemand muss ein neues setzen.
- **Angemeldete Geräte:** Sie bleiben angemeldet, vor allem Bildschirm und Tresen im Laden (siehe „Übergang“ unter
  Stufe 4).
- **Alte Links:** Alle Links aus QR-Codes, Mails, Briefen und Lesezeichen funktionieren weiter, zum Beispiel Nummer mit
  Schlüssel, Einladung, Kunden-Link, Übernahme-Code oder Eintrag entfernen. Dafür behalten alle Einträge ihre
  bisherigen IDs.
- **Spürbar:** Nummer ziehen und buchen gehen schneller, und das iPhone hat keine Verbindungsprobleme mehr.
- **Wartungspause:** Eine kurze Pause beim Umschalten (Stufe 3), angekündigt und nachts.

## Zielbild

- **Datenbank:**
  - PostgreSQL 16, läuft schon auf `spielmacherei`. Eigene Datenbank `q_me`, Rolle `q-me`.
  - Anmeldung über den lokalen Socket ohne Passwort, wie bei den anderen Projekten auf dem Server (peer).
  - An der gemeinsamen PostgreSQL-Einstellung ändern wir nichts.
- **Backend:**
  - SQLAlchemy 2 (Core) mit psycopg 3, Schema-Änderungen über Alembic.
  - `deploy/update.sh` spielt Schema-Änderungen bei jedem Ausrollen selbst ein.
  - Aller Datenzugriff läuft über die Speicher-Schicht `backend/app/store/`. Ihre Schnittstelle ist der kleine Teil von
    Firestore, den das Backend nutzt (beschrieben in `app/store/__init__.py`, festgehalten in
    `tests/test_speicher_vertrag.py`). In Stufe 3 bekommt sie eine zweite Umsetzung auf PostgreSQL.
- **Frontend:**
  - Kein Firebase-SDK mehr. Die Datenschicht `frontend/src/utils/firestore/` ruft das Backend auf, ihre Funktionen
    behalten ihre Namen.
  - Zeitangaben kommen als ISO-Zeit. Die Datenschicht wandelt sie in einen kleinen Zeitpunkt-Typ mit `toDate()`,
    `seconds` und `toMillis()` um. So müssen die rund 30 Dateien mit `Timestamp` nicht auf einmal geändert werden.
- **Live-Aktualisierung:**
  - Das Backend schickt nach jeder Änderung per PostgreSQL `NOTIFY` einen kurzen Hinweis, welcher Kanal sich geändert
    hat. Kanäle sind zum Beispiel ein Laden an einem Tag, eine einzelne Nummer oder die Laden-Daten.
  - Eine Aufgabe im Backend verteilt diese Hinweise per Server-Sent Events an die offenen Seiten. Die Seite lädt dann
    über die normale Schnittstelle neu, mit allen Rechteprüfungen.
  - Über die Kanäle gehen also keine Daten, nur der Hinweis.
  - Nach einem Verbindungsabbruch verbindet sich der Browser selbst neu. Zur Sicherheit lädt die Seite zusätzlich alle
    60 Sekunden neu.
  - Betroffen sind: Bildschirm, Nummer, Tresen, Kalender, Mein Tag und Tarif.
- **Doppelbuchungen:**
  - Bis zum Umzug schützt wie heute die Belegung je Person und Tag (`schedules`, `shop_days`) in Transaktionen.
    PostgreSQL führt diese Transaktionen streng nacheinander aus (SERIALIZABLE) und wiederholt sie bei Konflikten.
  - Später zusätzlich ein Ausschluss-Constraint auf den Terminen: gleiche Person und überlappende belegte Zeit
    (einschließlich Puffer) lehnt die Datenbank selbst ab, solange der Termin nicht abgesagt ist. Die Probe dafür
    steht schon in `tests/test_datenbank.py`.
  - Das geht erst, wenn alte, sich überschneidende Termine aus der Zeit vor der Belegung (vor dem 20.10.2026)
    bereinigt sind. Sonst scheitert der Umzug an ihnen.
- **Anmeldung:**
  - Konten, Sitzungen und Einmal-Links liegen in PostgreSQL. Passwörter werden mit Argon2id gehasht.
  - Die Sitzung steckt in einem Cookie: HttpOnly, Secure, SameSite=Lax.
  - Bestätigungs-, Passwort- und Einladungs-Links verschickt das Backend wie heute über Resend.
- **Dateien:** Logos und Fotos liegen auf dem Server unter `/var/lib/q-me/dateien`, Caddy liefert sie aus.
- **Push:**
  - Web-Push bleibt wie er ist (Browser, Android-App).
  - Die iPhone-App bekommt Push direkt von Apple (APNs) statt über FCM. Das wird noch vor der Veröffentlichung im
    App Store umgestellt.
- **Ein Prozess:** Das Backend bleibt bei einem uvicorn-Prozess, denn Sperren, Zwischenspeicher und Hintergrundaufgaben
  setzen das voraus. Die Live-Endpunkte sind `async`, damit offene Verbindungen keine Threads belegen.

### Speichern in PostgreSQL

- **Dokumente:** Jedes Firestore-Dokument wird eine Zeile in der Tabelle `dokumente`. Sie hat diese Spalten:
  - `sammlung`: Pfad der Sammlung, auch für Unter-Sammlungen, z. B. `shops/<id>/members`.
  - `id`: die bisherige Firestore-ID.
  - `daten`: der Inhalt als `jsonb`.
  - `geaendert`: Zeitpunkt der letzten Änderung.
- **Zeitpunkte:** Sie stehen als UTC-Zeit im festen Format im `jsonb`. So sortieren und vergleichen sie sich richtig,
  und eine Text-Zeit wie `"10:00"` bleibt davon getrennt, genau wie in Firestore.
- **Indizes:** Ausdrucks-Indizes nur für die häufigen Abfragen, z. B. Termine nach Laden oder Person und Startzeit.
- **IDs:** Alle IDs bleiben, neue entstehen im selben Format (20 Zeichen). Alte Links funktionieren deshalb weiter.
- **Feinschliff:** Eigene Tabellen und Spalten für einzelne Bereiche, wo es sich lohnt, kommen später und Schritt für
  Schritt. Zuerst wohl Termine mit dem Ausschluss-Constraint. Der Code merkt davon nichts, solange die Verträge
  grün bleiben.
- **Was mit der Zeit wegfallen kann:** `public_appointments`, `members` und `staff_contacts` gibt es nur wegen der
  Firestore-Regeln. Sobald der Browser nicht mehr direkt liest (Stufe 2), braucht sie niemand mehr. Weg können auch die
  alten Sammlungen `queue` und `staff-invitations`.

`.local_data` bleibt vorerst, wie es ist: Zwischenspeicher der freien Zeiten, Betreiber-Protokoll, Sicherungen.

## Umsetzung in Stufen

Jede Stufe geht einzeln live. Bis Stufe 3 bleibt Firestore die Quelle aller Daten.

Warum nicht alles auf einmal? Ein Zweig, der wochenlang neben den anderen Sitzungen herläuft, gerät ständig in
Konflikte. Und ein großer Umschalttag ließe sich kaum zurücknehmen.

### Stufe 0 – Vorbereitung (etwa 1 Tag)

- **Auf dem Server:**
  - Datenbank `q_me`, Rolle `q-me` und die Erweiterung `btree_gist` anlegen.
  - `QME_DATABASE_URL=postgresql:///q_me` in `/etc/q-me.env` eintragen. Das ist kein Geheimnis.
- **Im Backend:** Alembic mit einer leeren Ausgangsfassung, und `update.sh` spielt die Schema-Änderungen ein.
- **Sicherung:**
  - Jede Nacht `pg_dump` nach `/var/backups/q-me`, 14 Tage aufbewahren.
  - Die Hetzner-Sicherung des Servers (täglich, 7 Tage) nimmt diese Dateien mit.
  - Einmal zur Probe wiederherstellen und das in `deploy/README.md` beschreiben.
- **Tests:**
  - PostgreSQL in GitHub Actions (Service-Container) für die Backend-Tests (`.github/workflows/datenbank.yml`).
  - PostgreSQL 16 auf Stefans Rechner erst, wenn Stufe 1 es für schnelle Tests braucht. Dafür gibt es dann einen
    fertigen Befehl. Bis dahin laufen die Datenbank-Tests auf GitHub.

### Stufe 1 – Datenzugriff im Backend bündeln (erledigt 04.11.2026)

- **Speicher-Schicht `backend/app/store/`:**
  - Sie liefert den Client (`store.db()`) und alles, was der Code sonst direkt aus Firestore holte: `SERVER_TIMESTAMP`,
    `DELETE_FIELD`, `Increment`, `FieldFilter`, `transactional`, `DESCENDING` und die Fehler `Conflict`, `Aborted`,
    `NotFound`.
  - 20 Dateien holen das jetzt von dort, ohne dass sich ihr Verhalten ändert.
- **Wächter** `tests/test_speicher_gebuendelt.py`: Kein Code greift an der Schicht vorbei auf Firestore zu.
  Ausgenommen sind Anmeldung und Push, die erst Stufe 4 und 5 ersetzen.
- **Vertrag** `tests/test_speicher_vertrag.py`:
  - 23 Prüfungen halten fest, wie sich der genutzte Teil von Firestore verhält: Lesen, Schreiben, Zusammenführen,
    Punkt-Pfade, Sonderwerte, Abfragen, Sortierung, Transaktionen (auch gleichzeitig), Sammel-Schreiben und
    Live-Abfragen.
  - Sie laufen auf GitHub gegen den Firestore-Emulator. In Stufe 3 muss PostgreSQL sie genauso bestehen.
- **Warum so statt fachlicher Einzelfunktionen:** Das Backend nutzt nur einen kleinen, klar umrissenen Teil von
  Firestore. Ihn einmal auf PostgreSQL nachzubauen ist weniger Arbeit und weniger Risiko, als rund 200 Zugriffe
  einzeln umzuschreiben.

### Stufe 2 – Browser nur noch über das Backend (5–7 Tage, in Teilen ausrollbar)

- **Neue Endpunkte:** Für alles, was das Frontend heute selbst liest und schreibt. Die Rechte aus `firestore.rules`
  wandern nach `app/auth/access.py`.
- **Termine im Team anlegen und ändern** (Tresen, Kalender, Mein Tag) gehen dann über das Backend, wie es Buchen und
  Nummer ziehen schon tun.
- **Live-Kanäle** per Server-Sent Events, gespeist vorerst aus den Firestore-Listenern im Backend. Damit entfallen im
  Browser `onSnapshot`, Long-Polling und die Sonderwege in `utils/connection.ts`.
- **Reihenfolge nach Bereichen**, je ein PR:
  1. Nummer und Bildschirm
  2. Tresen und Kalender
  3. Mein Tag
  4. Team und Leistungen
  5. Pausen
  6. Einrichtung und Laden
  7. Kunden
  8. Profil
  9. Tarif und Betreiber
- **Logos und Fotos** gehen als Upload ans Backend. Das Backend legt sie vorerst weiter in Firebase Storage ab.
- **Am Ende:**
  - Die Firestore-Regeln werden auf „kein Zugriff aus dem Browser“ gestellt. Stefan spielt sie ein.
  - Die Anmeldung läuft in dieser Stufe noch über Firebase.

### Stufe 3 – Umzug auf PostgreSQL (3–4 Tage)

- **Speicher-Schicht auf PostgreSQL:**
  - Die Tabelle `dokumente` entsteht per Alembic.
  - Ein Client mit derselben Schnittstelle wie der genutzte Teil von Firestore besteht alle Verträge aus Stufe 1.
  - Transaktionen laufen als SERIALIZABLE und werden bei Konflikten wiederholt.
- **Ersatz für die Firestore-Listener:** `on_snapshot` meldet Änderungen über `NOTIFY`. Davon leben die Live-Kanäle, der
  Wecker im notify_worker und der Termin-Zwischenspeicher (`appointment_window`).
- **Umzugsskript** `deploy/datenumzug.py`:
  - Liest alle Sammlungen samt Unter-Sammlungen und schreibt sie unverändert in einer einzigen Transaktion nach
    PostgreSQL.
  - Vergleicht danach Anzahlen und Stichproben.
  - Kann beliebig oft wiederholt werden und hat einen Probelauf gegen eine Kopie.
- **Umschalten:**
  - Ein Schalter `QME_SPEICHER=firestore|postgres` legt fest, welche Umsetzung gilt.
  - Für den Umzug gibt es einen Wartungsmodus: Schreibende Endpunkte antworten mit „Kurze Wartung“, das Frontend zeigt
    einen Hinweis. Das geht erst ab Stufe 2, weil vorher der Browser selbst schreibt.
- **Ablauf im Wartungsfenster** (etwa 30 Minuten, nachts):
  1. Wartungsmodus an.
  2. Stefan startet den Umzug mit einem fertigen Block, denn das Skript liest die Produktionsdaten.
  3. Der Vergleich ist grün.
  4. Schalter auf `postgres`, Backend neu starten.
  5. Prüfungen laufen: e2e lesend und Buchen im Testladen.
  6. Wartungsmodus aus.
- **Zurück:** Bis zum Ende der Wartung reicht es, den Schalter zurückzustellen, denn Firestore war eingefroren. Danach
  wird nur noch vorwärts korrigiert. Firestore bleibt als Archiv stehen und wird nicht mehr beschrieben.

### Stufe 4 – Eigene Anmeldung (3–4 Tage)

- **Endpunkte:** Anmelden, Abmelden, Registrieren, Adresse bestätigen, Passwort vergessen, Passwort neu, Passwort
  ändern, „ich“.
- **Schutz:**
  - Sperre nach Fehlversuchen, je Adresse und je IP.
  - Schreibende Anfragen werden auf ihren Ursprung geprüft (Origin).
  - Einmal-Links liegen nur als Hash in der Datenbank, wie bei Einladungen schon üblich.
- **Backend:**
  - `databutton_app/mw/auth_mw.py` liest künftig die Sitzung statt eines Google-Tokens.
  - `AuthorizedUser` und `user.sub` bleiben, `sub` ist weiter die bisherige Konto-ID. Damit bleiben alle Verweise in
    den Daten gültig.
  - Die Betreiber-Funktionen (sperren, entsperren, Adresse ändern, löschen, Kontenliste) arbeiten auf `users` und
    `sessions`.
- **Passwörter übernehmen:**
  - Firebase gibt die Konten samt Passwort-Hashes heraus. Das Verfahren (scrypt in Firebase-Variante) ist offengelegt.
  - Das Backend prüft bei der ersten Anmeldung den alten Hash und speichert das Passwort danach mit Argon2id.
  - Die Hash-Parameter sind ein Geheimnis. Stefan holt sie aus der Firebase-Konsole und trägt sie per Block ein.
  - Wo das nicht klappt, bekommt der Nutzer eine Mail „Passwort neu setzen“.
- **Übergang für angemeldete Geräte:**
  - Ein Endpunkt tauscht ein noch gültiges Firebase-Anmeldetoken einmalig gegen eine Sitzung. Das Frontend macht das
    beim ersten Aufruf von selbst.
  - So bleiben Bildschirm, Tresen und Handys angemeldet.
  - Nach der Übergangszeit fliegt das Firebase-SDK ganz heraus.
- **Frontend:**
  - Betroffen sind `app/auth/*`, Anmelden, Registrieren (Kunde, Inhaber, Team), Passwort neu, Adresse bestätigen,
    Passwort ändern und Abmelden.
  - Die Fehlertexte aus `auth-errors.ts` werden auf die neuen Codes umgestellt, in allen Sprachen (de, en, tr, ar).
  - Die iPhone-App (WKWebView) und die Android-App (Chrome) laden dranzeit.de. Das Cookie gilt dort ohne Weiteres.

### Stufe 5 – Dateien, iPhone-Push, Aufräumen (2–3 Tage)

- **Dateien:** Logos und Fotos ziehen aus Firebase Storage auf den Server um. Das Umzugsskript schreibt die Adressen in
  der Datenbank um.
- **iPhone-Push:**
  - `mobile/` meldet das APNs-Token statt des FCM-Tokens, und das Backend sendet direkt an Apple.
  - Den APNs-Schlüssel braucht es ohnehin. Stefan trägt ihn per Block ein.
- **Ausbauen:**
  - Pakete: `firebase-admin`, `google-cloud-firestore` und das Firebase-SDK.
  - Dateien und Abläufe: `firestore.rules`, `storage.rules`, die Regel-Tests mit Workflow, `deploy/firebase-domains.py`
    und die Firebase-Teile in `setup-server.sh` und `q-me.service`.
- **Testskripte umstellen:**
  - `dev/fixtures.py`, `dev/daten.py`, `dev/e2e/lib.cjs` (Anmelden, Testladen) und `lasttest.cjs`.
  - `regeln-live.cjs` wird zum Rechte-Test gegen die Schnittstelle.
  - Dazu die übrigen e2e-Skripte, die anmelden (rund 30), sowie die Backend-Tests mit FakeDb/FakeAuth.
- **Datenschutzerklärung:** Google Firebase entfällt, in allen Sprachen.
- **Firebase-Projekt:**
  - Eine letzte Sicherung ziehen und für die vereinbarte Frist aufbewahren.
  - Danach das Projekt löschen (Stefan).

## Was nicht mit `git pull` kommt

| Was | Wer | Stufe |
|---|---|---|
| Datenbank, Rolle, Erweiterung anlegen; `QME_DATABASE_URL` setzen | Claude per ssh | 0 |
| Nächtliche Sicherung (cron) und Probe-Wiederherstellung | Claude per ssh | 0 |
| PostgreSQL auf Stefans Rechner (für Tests) | Stefan, fertiger Befehl | 1 |
| Firestore-Regeln „kein Zugriff aus dem Browser“ einspielen | Stefan, wie bisher | 2 |
| Datenumzug im Wartungsfenster (liest Produktionsdaten) | Stefan, fertiger Block | 3 |
| Firebase-Hash-Parameter (Geheimnis) | Stefan, Block mit `Read-Host -AsSecureString` | 4 |
| Umzug der Dateien aus Firebase Storage | Stefan, fertiger Block | 5 |
| APNs-Schlüssel (Geheimnis), neue Fassung der iPhone-App | Stefan | 5 |

Schema-Änderungen spielt ab Stufe 0 `update.sh` beim Ausrollen selbst ein.

## Acceptance – Abnahme

- **Kein Google mehr im Browser:** Im Netzwerkprotokoll von dranzeit.de gibt es keine Anfragen an `googleapis.com`,
  `firebaseio.com`, `firebasestorage.app` oder `firebaseapp.com`. Ausgenommen ist der Push-Dienst des Browsers.
- **Kein Firebase im Backend:** Weder `firebase-admin` noch `google-cloud-firestore` werden geladen.
- **Doppelbuchungen sind ausgeschlossen:**
  - `gleichzeitig.cjs` (viele ziehen gleichzeitig) vergibt keine Nummer doppelt.
  - Der Vertrag „gleichzeitige Transaktionen verlieren nichts“ ist auch gegen PostgreSQL grün.
  - Den Ausschluss-Constraint in der Datenbank gibt es erst nach der Bereinigung alter Termine (siehe Zielbild).
- **Schnell genug:**
  - `/routes/nummer/ziehen` hat im Caddy-Log ein p90 unter 300 ms, auch im Lasttest.
  - Bildschirm und Nummer zeigen Änderungen innerhalb von 2 Sekunden, auch auf dem iPhone unter Safari.
- **Konten:**
  - Ein bestehendes Konto meldet sich mit dem alten Passwort an.
  - Ein vor dem Umstieg angemeldetes Gerät bleibt angemeldet.
- **Alte Links funktionieren:** Nummer mit Schlüssel, Einladung, Kunden-Link, Übernahme-Code und Eintrag entfernen.
- **Tests grün:** `fruehester-platz.cjs`, `schlange-tresen.cjs`, `seiten.cjs`, der neue Rechte-Test (statt
  `regeln.cjs`) und `node --experimental-strip-types dev/schlange.test.mjs`.
- **Sicherung:** Sie läuft jede Nacht, und eine Wiederherstellung ist einmal geprobt.
- **Datenschutz:** Die Datenschutzerklärung nennt Google Firebase in keiner Sprache mehr.

## Nicht Teil dieses Vorhabens

- Ein eigener Server für Dranzeit. Am 04.11.2026 entschieden: Dranzeit bleibt auf `spielmacherei`. Ein späterer Umzug
  bleibt einfach: Datenbank sichern, einspielen, DNS umstellen.
- Ordulo.
- Passkeys und Zwei-Faktor-Anmeldung. Beides lässt sich auf Stufe 4 aufsetzen.
- Ersatz für Resend und Stripe.

## Offen

1. **Start:** Erst nach Stufe 5 oder schon nach Stufe 2?
   - Ab Stufe 2 schreibt nur noch das Backend. Dann lässt sich der Umzug auch im laufenden Betrieb mit kurzer
     Wartungspause machen.
   - Neue Konten aus der Startzeit werden in Stufe 4 mit übernommen.
2. **Sicherung außer Haus:** Zusätzlich eine Hetzner Storage Box? Oder genügt die Hetzner-Sicherung des Servers?
3. **Wartungsfenster:** Wann (Vorschlag: werktags ab 22 Uhr), und werden die Läden vorher benachrichtigt?
4. **Übergangszeit für angemeldete Geräte:** Vorschlag 8 Wochen. Danach melden sich Geräte, die so lange nicht offen
   waren, neu an.
5. **Firebase-Projekt:** Wie lange bleibt die letzte Sicherung, bevor es gelöscht wird? Vorschlag 3 Monate, passend zu
   den Löschfristen.

## Aufwand

Ursprünglich etwa 17 bis 24 Arbeitstage. Durch den geänderten Weg (Stufe 1 an einem Tag erledigt, Stufe 3 statt 4–6 nur
noch 3–4 Tage) sind es noch etwa 13 bis 19 Arbeitstage. Den größten Teil macht jetzt Stufe 2 aus.

Stufe 4 berührt andere Dateien als Stufe 2 (Anmeldung statt Datenschicht). Sie kann deshalb in einer eigenen Sitzung
parallel entstehen und direkt nach Stufe 3 live gehen.
