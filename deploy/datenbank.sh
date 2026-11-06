#!/usr/bin/env bash
# PostgreSQL für Dranzeit (requirements/eigene-datenbank.md). Als root auf dem Server:
#
#   bash /opt/q-me/deploy/datenbank.sh einrichten  # Rolle, Datenbank, Erweiterung, QME_DATABASE_URL, nächtliche Sicherung
#   bash /opt/q-me/deploy/datenbank.sh migrieren   # Schema auf den Stand des Codes bringen (Alembic), als Benutzer q-me
#   bash /opt/q-me/deploy/datenbank.sh sichern     # Sicherung nach /var/backups/q-me (läuft jede Nacht per cron)
#   bash /opt/q-me/deploy/datenbank.sh probe       # frische Sicherung in eine Wegwerf-Datenbank einspielen und vergleichen
#
# einrichten und migrieren ruft deploy/update.sh bei jedem Ausrollen auf; beides ändert nichts, wenn schon alles stimmt.
# Anmeldung über den lokalen Socket ohne Passwort (peer): Systembenutzer q-me = Datenbank-Rolle q-me.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/q-me}
ENV_FILE=${ENV_FILE:-/etc/q-me.env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/q-me}
CRON_FILE=${CRON_FILE:-/etc/cron.d/q-me-datenbank}
DATEIEN_DIR=${DATEIEN_DIR:-/var/lib/q-me/dateien}
DB=q_me
ROLE=q-me
KEEP_DAYS=14
# Das mitgelieferte libpq von psycopg sucht den Socket sonst unter /tmp, Ubuntu legt ihn hierhin
URL="postgresql:///$DB?host=/var/run/postgresql"

fail() { echo "FEHLER: $*" >&2; exit 1; }
# Als Datenbank-Administrator; -A -t: nur die Werte, eine Zeile je Ergebnis
als_admin() { runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }

einrichten() {
	command -v psql >/dev/null || fail "PostgreSQL fehlt (apt install postgresql)"
	id "$ROLE" >/dev/null 2>&1 || fail "Systembenutzer $ROLE fehlt (deploy/setup-server.sh)"
	if [ "$(als_admin -d postgres -c "select 1 from pg_roles where rolname = '$ROLE'")" != 1 ]; then
		als_admin -d postgres -c "create role \"$ROLE\" login"
		echo "    Rolle $ROLE angelegt"
	fi
	if [ "$(als_admin -d postgres -c "select 1 from pg_database where datname = '$DB'")" != 1 ]; then
		als_admin -d postgres -c "create database $DB owner \"$ROLE\""
		echo "    Datenbank $DB angelegt"
	fi
	# Für den Ausschluss von Doppelbuchungen (gleiche Person, überlappende Zeit)
	if [ "$(als_admin -d "$DB" -c "select 1 from pg_extension where extname = 'btree_gist'")" != 1 ]; then
		als_admin -d "$DB" -c "create extension btree_gist"
		echo "    Erweiterung btree_gist angelegt"
	fi
	if ! grep -q '^QME_DATABASE_URL=' "$ENV_FILE"; then
		echo "QME_DATABASE_URL=$URL" >>"$ENV_FILE"
		echo "    QME_DATABASE_URL eingetragen"
	fi
	install -d -m 700 -o root -g root "$BACKUP_DIR"
	if ! cmp -s "$APP_DIR/deploy/q-me-datenbank.cron" "$CRON_FILE"; then
		install -m 644 "$APP_DIR/deploy/q-me-datenbank.cron" "$CRON_FILE"
		echo "    nächtliche Sicherung eingerichtet ($CRON_FILE)"
	fi
	echo "    Datenbank $DB bereit"
}

migrieren() {
	local url
	url=$(sed -n 's/^QME_DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)
	[ -n "$url" ] || fail "QME_DATABASE_URL fehlt in $ENV_FILE (erst: datenbank.sh einrichten)"
	cd "$APP_DIR/backend"
	# Der Code gehört root; der Dienstbenutzer liest ihn nur und schreibt keine .pyc daneben
	runuser -u "$ROLE" -- env PYTHONDONTWRITEBYTECODE=1 QME_DATABASE_URL="$url" \
		.venv/bin/python -m alembic upgrade head
	echo "    Schema: $(runuser -u "$ROLE" -- env PYTHONDONTWRITEBYTECODE=1 QME_DATABASE_URL="$url" \
		.venv/bin/python -m alembic current 2>/dev/null | tail -n 1)"
}

sichern() {
	install -d -m 700 -o root -g root "$BACKUP_DIR"
	local datei
	datei="$BACKUP_DIR/$DB-$(date -u +%Y-%m-%dT%H%M).dump"
	# Erst unter vorläufigem Namen, damit eine abgebrochene Sicherung nie als fertig gilt
	if ! runuser -u postgres -- pg_dump -Fc "$DB" >"$datei.teil"; then
		rm -f "$datei.teil"
		fail "pg_dump $DB fehlgeschlagen"
	fi
	chmod 600 "$datei.teil"
	mv "$datei.teil" "$datei"
	find "$BACKUP_DIR" -name "$DB-*.dump" -mtime +"$KEEP_DAYS" -delete
	echo "$(date -u +%FT%TZ) Sicherung $datei ($(du -h "$datei" | cut -f1))"
	# Logos und Fotos (app/libs/laeden.py) gleich mit
	if [ -d "$DATEIEN_DIR" ]; then
		local bilder
		bilder="$BACKUP_DIR/dateien-$(date -u +%Y-%m-%dT%H%M).tar.gz"
		tar -czf "$bilder.teil" -C "$DATEIEN_DIR" . && chmod 600 "$bilder.teil" && mv "$bilder.teil" "$bilder"
		find "$BACKUP_DIR" -name "dateien-*.tar.gz" -mtime +"$KEEP_DAYS" -delete
		echo "$(date -u +%FT%TZ) Bilder $bilder ($(du -h "$bilder" | cut -f1))"
	fi
}

# Tabellen mit Zeilenzahl, eine Zeile je Tabelle
zaehlen() {
	local tabelle
	als_admin -d "$1" -c "select tablename from pg_tables where schemaname = 'public' order by 1" |
		while read -r tabelle; do
			echo "$tabelle $(als_admin -d "$1" -c "select count(*) from public.\"$tabelle\"")"
		done
}

probe() {
	sichern
	local neueste probe_db="${DB}_probe" vorher nachher
	neueste=$(ls -1t "$BACKUP_DIR/$DB"-*.dump | head -n 1)
	als_admin -d postgres -c "drop database if exists $probe_db"
	als_admin -d postgres -c "create database $probe_db owner \"$ROLE\""
	trap 'als_admin -d postgres -c "drop database if exists '"$probe_db"'" || true' EXIT
	# root öffnet die Datei (Ordner nur für root), pg_restore liest sie von der Standardeingabe
	runuser -u postgres -- pg_restore --exit-on-error -d "$probe_db" <"$neueste"
	vorher=$(zaehlen "$DB")
	nachher=$(zaehlen "$probe_db")
	echo "    eingespielt: $neueste"
	echo "$nachher" | sed 's/^/    /'
	if [ "$vorher" != "$nachher" ]; then
		echo "Abweichung zwischen $DB und der Sicherung:" >&2
		diff <(echo "$vorher") <(echo "$nachher") >&2 || true
		fail "Wiederherstellung weicht ab (bei laufendem Betrieb kann sich zwischendurch etwas ändern – dann wiederholen)"
	fi
	echo "    Wiederherstellung stimmt mit $DB überein ($(echo "$nachher" | grep -c . || true) Tabellen)"
}

case "${1:-}" in
	einrichten) einrichten ;;
	migrieren) migrieren ;;
	sichern) sichern ;;
	probe) probe ;;
	*) fail "Aufruf: datenbank.sh einrichten|migrieren|sichern|probe" ;;
esac
