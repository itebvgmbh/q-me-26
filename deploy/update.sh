#!/usr/bin/env bash
# Neuen Stand von GitHub holen, bauen und ausrollen. Als root ausführen:
#   bash /opt/q-me/deploy/update.sh
#
# Schlägt der Web-Build fehl, bleibt die ausgelieferte Web-App unverändert,
# und das Backend wird nicht neu gestartet.
set -euo pipefail

APP_DIR=/opt/q-me
WEB_ROOT=/opt/q-me-web
ENV_FILE=/etc/q-me.env
BRANCH=${BRANCH:-main}
# Von uv verwaltetes Python außerhalb von /root, damit der Dienst es lesen darf
export UV_PYTHON_INSTALL_DIR=/usr/local/share/uv-python

# Der Code gehört root und wird nur von root aktualisiert; der Dienst liest ihn nur.
cd "$APP_DIR"

if [ "${SKIP_PULL:-0}" != 1 ]; then
	echo "==> Stand holen ($BRANCH)"
	git fetch --quiet origin "$BRANCH"
	git reset --hard --quiet "origin/$BRANCH"
fi
git log --oneline -1

# Bash führt dieses Skript aus der beim Start geöffneten (alten) Datei weiter aus. Damit neue
# Schritte aus dem gerade geholten Stand sofort gelten, einmal die frische Fassung starten.
if [ "${QME_UPDATE_REEXEC:-0}" != 1 ]; then
	QME_UPDATE_REEXEC=1 SKIP_PULL=1 exec bash "$APP_DIR/deploy/update.sh"
fi

echo "==> Backend-Abhängigkeiten"
cd "$APP_DIR/backend"
[ -x .venv/bin/python ] || uv venv --quiet --python 3.13 .venv
uv pip install --quiet --python .venv/bin/python -r requirements.txt
install -d -o q-me -g q-me .local_data

echo "==> Schlüssel für Benachrichtigungen"
# Einmalig auf dem Server erzeugt; der geheime Teil verlässt den Server nie (app/libs/webpush.py)
if ! grep -q '^VAPID_PRIVATE_KEY=' "$ENV_FILE"; then
	.venv/bin/python - >>"$ENV_FILE" <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())
b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
print(f"VAPID_PUBLIC_KEY={b64(public)}")
print(f"VAPID_PRIVATE_KEY={b64(key.private_numbers().private_value.to_bytes(32, 'big'))}")
PY
	echo "    neu erzeugt"
else
	echo "    vorhanden"
fi

echo "==> Web-App bauen"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund --loglevel=error
rm -rf "$WEB_ROOT.new"
npx vite build --outDir "$WEB_ROOT.new" --emptyOutDir --logLevel warn
# Erst nach erfolgreichem Build austauschen
rm -rf "$WEB_ROOT.old"
if [ -d "$WEB_ROOT" ]; then
	mv "$WEB_ROOT" "$WEB_ROOT.old"
fi
mv "$WEB_ROOT.new" "$WEB_ROOT"
rm -rf "$WEB_ROOT.old"

echo "==> Dienst neu starten"
# Geänderte Dienstdatei (z. B. Zeitzone) mitnehmen – sonst gälte nur die bei der Einrichtung kopierte
if ! cmp -s "$APP_DIR/deploy/q-me.service" /etc/systemd/system/q-me.service; then
	cp "$APP_DIR/deploy/q-me.service" /etc/systemd/system/q-me.service
	systemctl daemon-reload
	echo "    Dienstdatei aktualisiert"
fi
systemctl restart q-me
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE")
for _ in $(seq 20); do
	curl -fsS -o /dev/null "http://127.0.0.1:$PORT/openapi.json" 2>/dev/null && break
	sleep 1
done
if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT/openapi.json"; then
	echo "FEHLER: Backend antwortet nicht auf Port $PORT. Log:"
	journalctl -u q-me -n 30 --no-pager
	exit 1
fi
echo "Backend läuft auf 127.0.0.1:$PORT."
echo "Fertig."
