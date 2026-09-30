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

echo "==> Backend-Abhängigkeiten"
cd "$APP_DIR/backend"
[ -x .venv/bin/python ] || uv venv --quiet --python 3.13 .venv
uv pip install --quiet --python .venv/bin/python -r requirements.txt
install -d -o q-me -g q-me .local_data

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
