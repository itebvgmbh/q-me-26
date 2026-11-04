#!/usr/bin/env bash
# Umzug von Firestore nach PostgreSQL (requirements/eigene-datenbank.md, Stufe 3). Als root auf dem Server:
#
#   bash /opt/q-me/deploy/datenumzug.sh lesen    # nur lesen und zählen (Dienst läuft weiter)
#   bash /opt/q-me/deploy/datenumzug.sh probe    # Probelauf in eine Wegwerf-Datenbank q_me_probe (Dienst läuft weiter)
#   bash /opt/q-me/deploy/datenumzug.sh umzug    # Dienst anhalten, umziehen, vergleichen, auf PostgreSQL umschalten
#   bash /opt/q-me/deploy/datenumzug.sh zurueck  # wieder Firestore (nur direkt nach dem Umzug sinnvoll, siehe unten)
#   bash /opt/q-me/deploy/datenumzug.sh stand    # welche Umsetzung gilt, wie viele Zeilen in dokumente
#
# Der Umzug selbst (deploy/datenumzug.py) liest alle Produktionsdaten aus Firestore und läuft deshalb nur, wenn Stefan
# ihn startet. Während des Umzugs ist der Dienst aus (ein paar Minuten, nachts): So schreibt niemand dazwischen, auch
# keine Hintergrundaufgabe. Klappt der Vergleich nicht, startet der Dienst unverändert mit Firestore.
#
# Zurück: Bis jemand in PostgreSQL etwas ändert, reicht `zurueck` – Firestore war eingefroren. Danach fehlt in Firestore,
# was seit dem Umzug geschrieben wurde; dann nur noch vorwärts korrigieren.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/q-me}
ENV_FILE=${ENV_FILE:-/etc/q-me.env}
PROBE_DB=q_me_probe
PROBE_URL="postgresql:///$PROBE_DB?host=/var/run/postgresql"

fail() { echo "FEHLER: $*" >&2; exit 1; }
als_admin() { runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }
wert() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

speicher() { [ "$(wert QME_SPEICHER)" = postgres ] && echo postgres || echo firestore; }

setzen() {
	sed -i '/^QME_SPEICHER=/d' "$ENV_FILE"
	echo "QME_SPEICHER=$1" >>"$ENV_FILE"
}

# Python mit der Umgebung des Dienstes (Firebase-Dienstkonto, Datenbank) als Benutzer q-me; die Werte bleiben im Dienst
umzug_py() {
	systemd-run --quiet --wait --pipe --collect --uid=q-me --gid=q-me \
		-p EnvironmentFile="$ENV_FILE" -p WorkingDirectory="$APP_DIR/backend" \
		-E PYTHONDONTWRITEBYTECODE=1 -E TZ=Europe/Berlin -E PYTHONUNBUFFERED=1 \
		"$APP_DIR/backend/.venv/bin/python" "$APP_DIR/deploy/datenumzug.py" "$@"
}

laeuft() {
	local port
	port=$(wert PORT)
	for _ in $(seq 30); do
		curl -fsS -o /dev/null "http://127.0.0.1:$port/openapi.json" 2>/dev/null && return 0
		sleep 1
	done
	return 1
}

pruefen_nach_start() {
	local port
	port=$(wert PORT)
	laeuft || { journalctl -u q-me -n 30 --no-pager; fail "Backend antwortet nicht"; }
	curl -fsS -o /dev/null "http://127.0.0.1:$port/routes/live/laeden" || fail "/routes/live/laeden antwortet nicht"
	echo "    Backend läuft ($(speicher)), Läden lesbar"
}

lesen() {
	umzug_py --ziel "$(wert QME_DATABASE_URL)" --lesen
}

probe() {
	[ -n "$(wert QME_DATABASE_URL)" ] || fail "QME_DATABASE_URL fehlt (erst deploy/datenbank.sh einrichten)"
	als_admin -d postgres -c "drop database if exists $PROBE_DB"
	als_admin -d postgres -c "create database $PROBE_DB owner \"q-me\""
	trap 'als_admin -d postgres -c "drop database if exists '"$PROBE_DB"'" || true' EXIT
	als_admin -d "$PROBE_DB" -c "create extension if not exists btree_gist"
	(cd "$APP_DIR/backend" && runuser -u q-me -- env PYTHONDONTWRITEBYTECODE=1 QME_DATABASE_URL="$PROBE_URL" \
		.venv/bin/python -m alembic upgrade head >/dev/null)
	umzug_py --ziel "$PROBE_URL"
	echo "    Probelauf in $PROBE_DB stimmt (Datenbank wird wieder gelöscht)"
}

umzug() {
	[ "$(speicher)" = firestore ] || fail "Schon auf PostgreSQL. Ein zweiter Umzug überschriebe, was seitdem dazukam."
	[ -n "$(wert QME_DATABASE_URL)" ] || fail "QME_DATABASE_URL fehlt (erst deploy/datenbank.sh einrichten)"
	bash "$APP_DIR/deploy/datenbank.sh" migrieren
	bash "$APP_DIR/deploy/datenbank.sh" sichern
	echo "==> Dienst anhalten (Wartung)"
	systemctl stop q-me
	echo "==> Umzug"
	if ! umzug_py --ziel "$(wert QME_DATABASE_URL)"; then
		echo "Umzug oder Vergleich fehlgeschlagen. Dienst startet wieder mit Firestore." >&2
		systemctl start q-me
		pruefen_nach_start
		exit 1
	fi
	echo "==> Auf PostgreSQL umschalten"
	setzen postgres
	systemctl start q-me
	if ! laeuft; then
		echo "Backend startet mit PostgreSQL nicht. Zurück auf Firestore." >&2
		journalctl -u q-me -n 30 --no-pager
		setzen firestore
		systemctl restart q-me
		pruefen_nach_start
		exit 1
	fi
	pruefen_nach_start
	echo "Umzug fertig. Firestore bleibt als Archiv stehen und wird nicht mehr beschrieben."
}

zurueck() {
	echo "Achtung: Was seit dem Umzug in PostgreSQL geschrieben wurde, fehlt in Firestore."
	setzen firestore
	systemctl restart q-me
	pruefen_nach_start
}

stand() {
	echo "Speicher: $(speicher)"
	if [ -n "$(wert QME_DATABASE_URL)" ]; then
		echo "Zeilen in dokumente: $(als_admin -d q_me -c "select count(*) from dokumente" 2>/dev/null || echo 'Tabelle fehlt')"
	fi
}

case "${1:-}" in
	lesen) lesen ;;
	probe) probe ;;
	umzug) umzug ;;
	zurueck) zurueck ;;
	stand) stand ;;
	*) fail "Aufruf: datenumzug.sh lesen|probe|umzug|zurueck|stand" ;;
esac
