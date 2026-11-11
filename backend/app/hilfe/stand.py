"""Stand der Übersetzungen der Hilfe (app/hilfe/artikel/<sprache>/): was fehlt, was veraltet ist – und abhaken.

    cd backend && python -m app.hilfe.stand                          Liste: fehlt / veraltet
    cd backend && python -m app.hilfe.stand --setzen tr plakat        nach dem Nachziehen: quelle neu setzen
    cd backend && python -m app.hilfe.stand --setzen alle             alle Übersetzungen als aktuell markieren

Veraltet heißt: Der deutsche Artikel hat sich geändert, seit übersetzt wurde (quelle im Kopf der Übersetzung ist ein
anderer Fingerabdruck). Was sich geändert hat, zeigt git: git log -p backend/app/hilfe/artikel/<adresse>.md
Erst die Übersetzungen anpassen, dann abhaken – sonst stimmt die Hilfe in den Sprachen nicht mehr überein.
"""

import re
import sys

from app import hilfe

_QUELLE = re.compile(r"^quelle:.*$", re.M)


def setzen(sprache: str, slug: str) -> None:
    deutsch = (hilfe.ARTIKEL_DIR / f"{slug}.md").read_text(encoding="utf-8")
    datei = hilfe.ARTIKEL_DIR / sprache / f"{slug}.md"
    text = datei.read_text(encoding="utf-8").replace("\r\n", "\n")
    kopf_ende = text.index("\n---\n", 4)
    kopf, rest = text[:kopf_ende], text[kopf_ende:]
    zeile = f"quelle: {hilfe.quelle_von(deutsch)}"
    kopf = _QUELLE.sub(zeile, kopf) if _QUELLE.search(kopf) else f"{kopf}\n{zeile}"
    datei.write_text(kopf + rest, encoding="utf-8", newline="\n")


def main(args: list[str]) -> int:
    if args[:1] == ["--setzen"]:
        if args[1:2] == ["alle"]:
            ziele = [(s, slug) for s in hilfe.UEBERSETZT for slug in hilfe.alle_artikel(s)]
        elif len(args) == 3 and args[1] in hilfe.UEBERSETZT:
            ziele = [(args[1], args[2])]
        else:
            print(__doc__)
            return 2
        for sprache, slug in ziele:
            setzen(sprache, slug)
        print(f"{len(ziele)} Übersetzung(en) als aktuell markiert")
        return 0
    fehlt, alt = hilfe.fehlend(), hilfe.veraltet()
    for sprache, slug in fehlt:
        print(f"fehlt     {sprache}/{slug}")
    for sprache, slug in alt:
        print(f"veraltet  {sprache}/{slug}")
    if not fehlt and not alt:
        print("Alle Übersetzungen da und aktuell.")
    return 1 if fehlt or alt else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
