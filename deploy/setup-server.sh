#!/usr/bin/env bash
# Q-ME auf dem vorhandenen Spielmacherei-Server einrichten (Ubuntu 24.04, Caddy
# und Node 22 sind dort schon installiert). Einmalig als root ausführen, nachdem
# das Repository nach /opt/q-me geklont wurde (siehe deploy/README.md):
#
#   bash /opt/q-me/deploy/setup-server.sh q-me.spielmacherei.de
#
# Q-ME läuft neben den anderen Projekten: eigener Dienst auf 127.0.0.1:$PORT und
# ein zusätzlicher Block in /etc/caddy/Caddyfile. Bestehendes wird nicht verändert.
set -euo pipefail

DOMAIN=${1:-q-me.spielmacherei.de}
PORT=${PORT:-8090}
APP_DIR=/opt/q-me
WEB_ROOT=/opt/q-me-web
ENV_FILE=/etc/q-me.env
SECRETS_DIR=/etc/q-me
CADDYFILE=/etc/caddy/Caddyfile
UV_VERSION=0.8.17

fail() { echo "FEHLER: $*" >&2; exit 1; }

echo "==> Voraussetzungen prüfen"
[ "$(id -u)" -eq 0 ] || fail "als root ausführen"
[ -d "$APP_DIR/.git" ] || fail "$APP_DIR ist kein Git-Checkout (erst klonen, siehe deploy/README.md)"
command -v caddy >/dev/null && [ -f "$CADDYFILE" ] || fail "Caddy mit $CADDYFILE erwartet"
command -v node >/dev/null || fail "Node.js fehlt"

echo "==> uv installieren (Python-Paketmanager)"
if ! command -v uv >/dev/null; then
	curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" \
		| env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi
uv --version

echo "==> Dienstkonto anlegen (ohne Login-Rechte)"
id -u q-me >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin q-me

echo "==> Konfiguration vorbereiten"
install -d -m 750 -o root -g q-me "$SECRETS_DIR"
if [ -f "$ENV_FILE" ]; then
	# Erneuter Aufruf: Port und übrige Werte bleiben, wie sie sind
	PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE")
else
	if ss -ltnH "sport = :$PORT" | grep -q .; then
		fail "Port $PORT ist belegt. Anderen Port wählen: PORT=8091 bash $0 $DOMAIN"
	fi
	cat > "$ENV_FILE" <<EOF
# Q-ME Backend. Liest der Dienst q-me beim Start.
PORT=$PORT
# Firebase-Projekt, dessen Anmelde-Tokens das Backend akzeptiert
FIREBASE_PROJECT_ID=qmedata-7c79e
# Dienstkonto-Schlüssel (JSON aus der Firebase-Konsole), Rechte 640 root:q-me
FIREBASE_SERVICE_ACCOUNT_KEY_FILE=$SECRETS_DIR/firebase-service-account.json
EOF
	chown root:q-me "$ENV_FILE"
	chmod 640 "$ENV_FILE"
fi

echo "==> Dienst einrichten"
cp "$APP_DIR/deploy/q-me.service" /etc/systemd/system/q-me.service
systemctl daemon-reload
systemctl enable --quiet q-me

echo "==> Bauen und starten"
SKIP_PULL=1 bash "$APP_DIR/deploy/update.sh"

echo "==> Caddy: Block für $DOMAIN"
if grep -qF "$DOMAIN {" "$CADDYFILE"; then
	echo "    $DOMAIN steht schon in $CADDYFILE und bleibt unverändert."
else
	backup="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
	cp "$CADDYFILE" "$backup"
	{
		echo
		sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" -e "s|__WEB_ROOT__|$WEB_ROOT|g" \
			"$APP_DIR/deploy/Caddyfile"
	} >> "$CADDYFILE"
	install -d -o caddy -g caddy /var/log/caddy
	# Logdatei vorab anlegen: sonst legt sie "caddy validate" als root an, und der
	# Caddy-Dienst (Konto caddy) könnte sie danach nicht mehr beschreiben.
	[ -f /var/log/caddy/q-me.log ] || install -m 644 -o caddy -g caddy /dev/null /var/log/caddy/q-me.log
	# Mit derselben Umgebung prüfen, die der Caddy-Dienst bekommt
	if ! (set -a; [ -f /etc/default/caddy ] && . /etc/default/caddy; set +a
		caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1); then
		cp "$backup" "$CADDYFILE"
		fail "Caddyfile ungültig, alte Fassung wiederhergestellt. Prüfen: caddy validate --config $CADDYFILE"
	fi
	# reload statt restart: die anderen Seiten laufen ohne Unterbrechung weiter
	systemctl reload caddy
	echo "    Block angehängt, Sicherung: $backup"
fi

echo
echo "Fertig. Noch offen:"
[ -f "$SECRETS_DIR/firebase-service-account.json" ] \
	|| echo "  - Firebase-Schlüssel nach $SECRETS_DIR/firebase-service-account.json legen (640 root:q-me), dann: systemctl restart q-me"
echo "  - DNS: A-Record $DOMAIN -> IPv4 dieses Servers (Caddy holt das Zertifikat dann selbst)"
echo "  - Firebase Console -> Authentication -> Autorisierte Domains: $DOMAIN"
