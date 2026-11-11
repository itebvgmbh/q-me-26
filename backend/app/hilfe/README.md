# Hilfe-Artikel schreiben

Die Hilfe unter `/hilfe` entsteht aus den Markdown-Dateien in `artikel/`. Der Dateiname ist die Adresse
(`artikel/plakat.md` → `/hilfe/plakat`). Neue Datei anlegen, ausrollen, fertig: Übersicht, Suche, Sitemap
und Verlinkung unter „Mehr zu …“ entstehen von selbst. Technik und erlaubtes Markdown: `__init__.py`.

## Kopf

```
---
titel: Plakat drucken und aufhängen
kurz: Ein Satz, der sagt, was man nach dem Lesen kann (Übersicht, Suche, Google; höchstens 155 Zeichen).
thema: loslegen
reihenfolge: 3
stichworte: qr, code, aushang, tür, drucken, a4
faq: ja        ← nur bei Frage-Antwort-Seiten: jede ###-Überschrift ist eine Frage
---
```

Themen: `loslegen`, `tresen`, `team`, `laden`, `tarif`, `konto`, `kunden`, `nachschlagen`.

## So schreiben wir

Vorbilder sind die Hilfe-Bereiche von Waitwhile, Shopify und Help Scout: Ein Artikel beantwortet genau eine
Frage. Er beginnt mit dem Ergebnis, dann folgen nummerierte Schritte und am Ende, was als Nächstes kommt.

- **Du-Form**, kurze Sätze, kein Fachjargon. Wer liest, steht gerade im Laden und hat zwei Minuten.
- **Erster Absatz = die Antwort.** Kein „In diesem Artikel erfährst du …“.
- **Schritte nummerieren**, je Schritt eine Handlung. Knöpfe und Menüpunkte **fett** und genau so
  geschrieben wie in der App, Wege mit Pfeil: **„Laden“ → „Plakat drucken“**.
- **Länge:** 150–400 Wörter. Was länger wird, ist ein zweiter Artikel.
- **Am Ende** ein Knopf in die App (`[Zum Tresen](/shop-dashboard){knopf}`) oder Links zu 1–3 passenden
  Artikeln.
- **Hinweiskästen sparsam:** `> **Tipp:** …` für Abkürzungen, `> **Achtung:** …` nur, wenn sonst etwas schiefgeht.
- **Nur was der Code wirklich tut.** Im Zweifel im Code nachsehen oder weglassen. Keine Versprechen zu
  Antwortzeiten, Verfügbarkeit oder Funktionen, die es nicht gibt.
- **Zahlen** (Preise, Fristen, Minuten) stehen in `frontend/src/utils/plans.ts`, `backend/app/libs/queue_notify.py`
  und `deploy/README.md`. Wenn sie sich dort ändern, die Artikel mit ändern (`grep -rn "19 €" artikel/`).

## Begriffe

Die Hilfe und die App verwenden dieselben Wörter. `begriffe.md` erklärt sie für Leser.

| So sagen wir | Nicht | Bedeutung |
|---|---|---|
| Laden | Shop, Betrieb, Salon, Geschäft | dein Geschäft bei Dranzeit; im Menü „Laden“ (`/shop-profile`) alles zum Verwalten |
| Nummer | Ticket, Walk-in, Warteschlangen-Eintrag | Platz in der Schlange ohne feste Uhrzeit |
| Termin | Buchung, Reservierung | feste Uhrzeit, online gebucht oder eingetragen |
| Schlange | Warteliste, Queue, Spur | alle, die heute bei einer Person warten |
| Tresen | Dashboard | die Ansicht im Laden, im Menü „Heute“ (`/shop-dashboard`) |
| Kalender | – | Tag oder Woche planen, je Person (`/kalender`), nur Inhaber |
| Mein Tag | – | Zeitleiste einer Person (`/employee-dashboard`), Inhaber unter „Laden“ → „Mein Tag“ |
| Person, Team | Mitarbeiter, Angestellte, Staff | wer Kunden bedient, du eingeschlossen |
| Leistung | Service, Dienstleistung | was du anbietest, mit Dauer und Preis |
| Vor- und Nachbereitung | Rüstzeit, Puffer | Minuten, die zu jeder Leistung dazukommen |
| Vorlaufzeit | Zeitpuffer | so weit im Voraus muss online gebucht werden |
| Kunde | Gast, Klient | wer eine Nummer oder einen Termin hat |
| aufrufen | rufen, dran nehmen | am Tresen „Nächste Nummer aufrufen“ |

Status am Tresen: **Wartet**, **Ist dran**, **Fertig**, **Abgesagt**.
Status beim Kunden („Meine Termine“): **Gebucht**, **Du bist dran**, **Fertig**, **Abgesagt**.

## Übersetzungen (Englisch, Türkisch, Arabisch)

Jeden Artikel gibt es auch unter `/en/hilfe/…`, `/tr/hilfe/…` und `/ar/hilfe/…` (Arabisch von rechts nach links).
Die Übersetzung liegt in `artikel/<sprache>/<adresse>.md`, gleiche Adresse wie der deutsche Artikel:

```
---
titel: Print and put up the poster
kurz: …                    ← höchstens 155 Zeichen
stichworte: …              ← Suchwörter in der Sprache
quelle: 3f2a9c1b7e04       ← Fingerabdruck des deutschen Artikels, aus dem übersetzt wurde
---
```

Thema, Reihenfolge und `faq` kommen vom deutschen Artikel. Links auf `/hilfe/…` bleiben so stehen, die Seite
zeigt sie in der Sprache der Übersetzung.

**Deutschen Artikel geändert oder neu angelegt? Dann die drei Übersetzungen im selben Zug nachziehen.**
`tests/test_hilfe.py` schlägt sonst an (fehlt / veraltet). So geht es:

1. `cd backend && python -m app.hilfe.stand` zeigt, was fehlt oder veraltet ist; was sich im Deutschen geändert hat,
   zeigt `git log -p app/hilfe/artikel/<adresse>.md`.
2. Übersetzungen anpassen: gleicher Aufbau wie im Deutschen – dieselben `##`/`###`-Überschriften, Bilder, Link-Ziele,
   Knöpfe `{knopf}` und Hinweiskästen (prüft der Test).
3. `python -m app.hilfe.stand --setzen <sprache> <adresse>` (je Sprache) hakt ab.

Regeln für die Übersetzung:

- **Knöpfe und Menüpunkte genau wie in der App:** die Übersetzung des deutschen Knopftexts aus
  `frontend/src/i18n/<sprache>/*.ts` (bzw. `backend/app/i18n/<sprache>.py` für Push und E-Mails).
- **Hinweiskästen:** en `**Tip:**` / `**Important:**`, tr `**İpucu:**` / `**Dikkat:**`, ar `**نصيحة:**` / `**تنبيه:**`.
- **Anführungszeichen:** en “…”, tr “…”, ar «…». **Ton:** en britisches Englisch, tr durchgehend „sen“,
  ar Hocharabisch mit westlichen Ziffern wie in der App.
- Die Bilder zeigen die deutsche App; die Seite sagt das dazu. Neue Bilder deshalb nicht übersetzen.
- Texte rundherum (Übersicht, Kopfzeile, Fußzeile) stehen in `backend/app/i18n/<sprache>.py`.
