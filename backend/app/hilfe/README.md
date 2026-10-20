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
  geschrieben wie in der App, Wege mit Pfeil: **„…“ → „QR-Plakat drucken“**.
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
| Laden | Shop, Betrieb, Salon, Geschäft | dein Geschäft bei Dranzeit |
| Nummer | Ticket, Walk-in, Warteschlangen-Eintrag | Platz in der Schlange ohne feste Uhrzeit |
| Termin | Buchung, Reservierung | feste Uhrzeit, online gebucht oder eingetragen |
| Schlange | Warteliste, Queue, Spur | alle, die heute bei einer Person warten |
| Tresen | Dashboard | die Ansicht im Laden (`/shop-dashboard`) |
| Mein Tag | Kalender | Zeitleiste je Person (`/employee-dashboard`) |
| Person, Team | Mitarbeiter, Angestellte, Staff | wer Kunden bedient, du eingeschlossen |
| Leistung | Service, Dienstleistung | was du anbietest, mit Dauer und Preis |
| Vor- und Nachbereitung | Rüstzeit, Puffer | Minuten, die zu jeder Leistung dazukommen |
| Kunde | Gast, Klient | wer eine Nummer oder einen Termin hat |
| aufrufen | rufen, dran nehmen | am Tresen „Nächste Nummer aufrufen“ |

Status am Tresen: **Wartet**, **Ist dran**, **Fertig**, **Abgesagt**.
Status beim Kunden („Meine Termine“): **Gebucht**, **Du bist dran**, **Fertig**, **Abgesagt**.
