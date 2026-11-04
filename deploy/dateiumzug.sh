#!/usr/bin/env bash
# Ältere Logos und Fotos aus Firebase Storage auf den eigenen Server holen (requirements/eigene-datenbank.md, Stufe 5).
# Als root auf dem Server:
#
#   bash /opt/q-me/deploy/dateiumzug.sh probe   # nur zählen: wie viele Dokumente und Bilder stehen noch auf Firebase
#   bash /opt/q-me/deploy/dateiumzug.sh umzug   # Bilder holen, unter /var/lib/q-me/dateien ablegen, Adressen ersetzen
#
# Der Dienst läuft dabei weiter. Beliebig oft wiederholbar; was sich nicht holen lässt, bleibt und wird gemeldet.
# Das eigentliche Skript ist deploy/dateiumzug.py (Test: backend/tests/test_dateiumzug.py).
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/q-me}
ENV_FILE=${ENV_FILE:-/etc/q-me.env}

fail() { echo "FEHLER: $*" >&2; exit 1; }

# Python mit der Umgebung des Dienstes (Datenbank) als Benutzer q-me; die Werte bleiben im Dienst
dateien_py() {
	systemd-run --quiet --wait --pipe --collect --uid=q-me --gid=q-me \
		-p EnvironmentFile="$ENV_FILE" -p WorkingDirectory="$APP_DIR/backend" \
		-E PYTHONDONTWRITEBYTECODE=1 -E TZ=Europe/Berlin -E PYTHONUNBUFFERED=1 \
		"$APP_DIR/backend/.venv/bin/python" "$APP_DIR/deploy/dateiumzug.py" "$@"
}

[ "$(id -u)" -eq 0 ] || fail "Bitte als root starten."
[ -f "$ENV_FILE" ] || fail "$ENV_FILE fehlt."

case "${1:-}" in
	probe) dateien_py --probe ;;
	umzug) dateien_py ;;
	*) fail "Aufruf: dateiumzug.sh probe|umzug" ;;
esac
